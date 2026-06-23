import test from "node:test"
import assert from "node:assert/strict"
import {
  createDefaultAiPredictionClient,
  DEFAULT_GEMINI_PREDICTION_MODEL,
  GEMINI_API_KEY_ENV_NAME,
  GeminiPredictionClient,
  type AiPredictionPrompt
} from "../../src/index.js"

// GEMINI_API_KEY가 없으면 provider 호출 전에 명확한 설정 오류가 발생하는지 확인
test("requires Gemini API key", () => {
  const originalApiKey = process.env[GEMINI_API_KEY_ENV_NAME]
  delete process.env[GEMINI_API_KEY_ENV_NAME]

  try {
    assert.throws(
      () => new GeminiPredictionClient({
        fetch: fetchSpy(validGeminiResponse())
      }),
      new RegExp(GEMINI_API_KEY_ENV_NAME)
    )
  } finally {
    if (originalApiKey === undefined) {
      delete process.env[GEMINI_API_KEY_ENV_NAME]
    } else {
      process.env[GEMINI_API_KEY_ENV_NAME] = originalApiKey
    }
  }
})

// Watcher 기본 AI provider factory가 Gemini client를 반환하는지 확인
test("creates Gemini client as default AI prediction client", async () => {
  const client = createDefaultAiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetchSpy(validGeminiResponse())
  })

  const response = await client.predict(prompt())

  assert.deepEqual(response, validPrediction())
})

// Watcher prompt가 Gemini generateContent REST payload로 변환되는지 확인
test("sends prompt to Gemini generateContent endpoint", async () => {
  const fetcher = fetchSpy(validGeminiResponse())
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetcher
  })

  await client.predict(prompt())

  assert.equal(fetcher.requests.length, 1)
  const request = fetcher.requests[0]
  assert.equal(
    request?.url,
    `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_PREDICTION_MODEL}:generateContent`
  )
  assert.equal(request?.init.headers["x-goog-api-key"], "gemini-key")

  const body = JSON.parse(request?.init.body as string) as {
    systemInstruction: {
      parts: Array<{
        text: string
      }>
    }
    contents: Array<{
      parts: Array<{
        text: string
      }>
    }>
    generationConfig: {
      responseFormat: {
        text: {
          mimeType: string
        }
      }
    }
  }

  assert.equal(body.systemInstruction.parts[0]?.text, "Return JSON only.")
  assert.equal(body.contents[0]?.parts[0]?.text, "{\"branch\":\"feature/a\"}")
  assert.equal(body.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON")
})

// batch prompt는 Gemini structured output schema도 predictions 배열로 요청하는지 확인
test("sends batch response schema to Gemini", async () => {
  const fetcher = fetchSpy(validGeminiBatchResponse())
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetcher
  })

  await client.predict(batchPrompt())

  const request = fetcher.requests[0]
  const body = JSON.parse(request?.init.body as string) as {
    generationConfig: {
      responseFormat: {
        text: {
          schema: {
            properties: {
              predictions?: {
                items?: {
                  properties?: Record<string, unknown>
                }
              }
            }
          }
        }
      }
    }
  }

  assert.notEqual(body.generationConfig.responseFormat.text.schema.properties.predictions, undefined)
  const properties = body.generationConfig.responseFormat.text.schema.properties.predictions?.items?.properties
  assert.equal(properties?.confidence, undefined)
  assert.equal(properties?.falsePositiveNotes, undefined)
})

// Gemini 503 계열 일시 실패는 exponential backoff 후 재시도하는지 확인
test("retries Gemini high demand failures with exponential backoff", async () => {
  const fetcher = fetchSequenceSpy([
    {
      body: {},
      ok: false,
      status: 503,
      text: "high demand"
    },
    {
      body: {},
      ok: false,
      status: 503,
      text: "high demand"
    },
    {
      body: validGeminiResponse()
    }
  ])
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetcher,
    maxAttempts: 3,
    retryBaseDelayMs: 0,
    retryJitterMs: 0
  })

  const response = await client.predict(prompt())

  assert.deepEqual(response, validPrediction())
  assert.equal(fetcher.requests.length, 3)
})

// Gemini 429 rate limit은 일반 503보다 긴 대기 후 재시도하는지 확인
test("retries Gemini rate limit failures with longer delay", async () => {
  const fetcher = fetchSequenceSpy([
    {
      body: {},
      ok: false,
      status: 429,
      text: "rate limit"
    },
    {
      body: validGeminiResponse()
    }
  ])
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetcher,
    maxAttempts: 2,
    rateLimitDelayMs: 0,
    retryJitterMs: 0
  })

  const response = await client.predict(prompt())

  assert.deepEqual(response, validPrediction())
  assert.equal(fetcher.requests.length, 2)
})

// request body 오류처럼 non-retryable 실패는 retry 없이 즉시 실패하는지 확인
test("does not retry non-retryable Gemini request failure", async () => {
  const fetcher = fetchSequenceSpy([
    {
      body: {},
      ok: false,
      status: 400,
      text: "invalid request"
    },
    {
      body: validGeminiResponse()
    }
  ])
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetcher,
    maxAttempts: 5
  })

  await assert.rejects(
    client.predict(prompt()),
    /Gemini prediction request failed with status 400: invalid request/
  )
  assert.equal(fetcher.requests.length, 1)
})

// Gemini quota 실패는 report가 길어지지 않도록 metric과 retry 시간만 요약하는지 확인
test("summarizes Gemini quota failure", async () => {
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    maxAttempts: 1,
    fetch: fetchSpy({}, {
      ok: false,
      status: 429,
      text: JSON.stringify({
        error: {
          code: 429,
          message: [
            "You exceeded your current quota.",
            "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.5-flash",
            "Please retry in 51.095224543s."
          ].join("\n"),
          status: "RESOURCE_EXHAUSTED"
        }
      })
    })
  })

  await assert.rejects(
    client.predict(prompt()),
    /Gemini prediction request failed with status 429: Gemini quota exceeded, metric: generativelanguage.googleapis.com\/generate_content_free_tier_requests, limit: 20, model: gemini-3.5-flash, retry after: 51.095224543s/
  )
})

// Gemini HTTP 실패가 branch 단위 failed result로 격리될 수 있도록 Error로 노출되는지 확인
test("throws when Gemini request fails", async () => {
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    maxAttempts: 1,
    fetch: fetchSpy({}, {
      ok: false,
      status: 429,
      text: JSON.stringify({
        error: {
          message: "model is overloaded"
        }
      })
    })
  })

  await assert.rejects(
    client.predict(prompt()),
    /Gemini prediction request failed with status 429: .*model is overloaded/
  )
})

// Gemini HTTP 실패 응답이 너무 길면 workflow log를 보호하기 위해 일부만 노출하는지 확인
test("truncates long Gemini error response", async () => {
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetchSpy({}, {
      ok: false,
      status: 400,
      text: "x".repeat(1200)
    })
  })

  await assert.rejects(
    client.predict(prompt()),
    /Gemini prediction request failed with status 400: x{1000}\.\.\. \(1000자 제한\)/
  )
})

// Gemini 응답에 JSON text가 없으면 schema validation 이전에 명확한 오류가 발생하는지 확인
test("throws when Gemini response text is empty", async () => {
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetchSpy({
      candidates: [{
        content: {
          parts: []
        }
      }]
    })
  })

  await assert.rejects(
    client.predict(prompt()),
    /response text is empty/
  )
})

// Gemini client가 보낸 request를 테스트에서 검증하기 위한 fetch spy 타입
type FetchSpy = typeof fetch & {
  requests: Array<{
    url: string
    init: {
      headers: Record<string, string>
      body?: BodyInit | null
    }
  }>
}

type FetchResponse = {
  body: unknown
  ok?: boolean
  status?: number
  text?: string
}

// network 호출 없이 Gemini response와 HTTP 상태를 주입하는 fetch 대역
function fetchSpy(
  body: unknown,
  options: {
    ok?: boolean
    status?: number
    text?: string
  } = {}
): FetchSpy {
  const requests: FetchSpy["requests"] = []
  const spy = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    requests.push({
      url: String(input),
      init: {
        headers: init?.headers as Record<string, string>,
        body: init?.body
      }
    })

    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      json: async () => body,
      text: async () => options.text ?? JSON.stringify(body)
    } as Response
  }) as FetchSpy

  spy.requests = requests
  return spy
}

// 여러 Gemini 응답을 순서대로 반환해 retry 흐름을 검증하는 fetch 대역
function fetchSequenceSpy(responses: FetchResponse[]): FetchSpy {
  const requests: FetchSpy["requests"] = []
  const spy = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    requests.push({
      url: String(input),
      init: {
        headers: init?.headers as Record<string, string>,
        body: init?.body
      }
    })

    const response = responses.shift()

    if (!response) {
      throw new Error("Unexpected Gemini request")
    }

    return responseFor(response)
  }) as FetchSpy

  spy.requests = requests
  return spy
}

// 테스트용 response 정의를 fetch Response 최소 구현으로 변환
function responseFor(response: FetchResponse): Response {
  return {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body,
    text: async () => response.text ?? JSON.stringify(response.body)
  } as Response
}

// Gemini client가 전송할 system/user prompt fixture
function prompt(): AiPredictionPrompt {
  return {
    systemPrompt: "Return JSON only.",
    userPrompt: "{\"branch\":\"feature/a\"}"
  }
}

function batchPrompt(): AiPredictionPrompt {
  return {
    systemPrompt: "Return JSON only.",
    userPrompt: "{\"branches\":[{\"branch\":\"feature/a\"}]}",
    responseShape: "predictionBatch"
  }
}

// Gemini generateContent가 반환하는 JSON text 응답 fixture
function validGeminiResponse(): unknown {
  return {
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify(validPrediction())
        }]
      }
    }]
  }
}

function validGeminiBatchResponse(): unknown {
  return {
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            predictions: [validPrediction()]
          })
        }]
      }
    }]
  }
}

// Watcher AI prediction schema를 만족하는 parsed JSON fixture
function validPrediction(): unknown {
  return {
    branchName: "feature/a",
    baseBranch: "main",
    prediction: "shared file 변경이 겹쳐 rebase 확인이 필요함",
    recommendedActions: [{
      title: "base branch rebase",
      description: "shared file 변경을 먼저 rebase해 실제 conflict 여부를 확인함",
      priority: "high",
      files: ["src/shared.ts"]
    }]
  }
}
