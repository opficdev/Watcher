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

// Gemini JSON text 응답이 기존 AI prediction validator에 넘길 수 있는 object로 parse되는지 확인
test("parses Gemini JSON text response", async () => {
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
    fetch: fetchSpy(validGeminiResponse())
  })

  const response = await client.predict(prompt())

  assert.deepEqual(response, validPrediction())
})

// Gemini HTTP 실패가 branch 단위 failed result로 격리될 수 있도록 Error로 노출되는지 확인
test("throws when Gemini request fails", async () => {
  const client = new GeminiPredictionClient({
    apiKey: "gemini-key",
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

// Gemini client가 전송할 system/user prompt fixture
function prompt(): AiPredictionPrompt {
  return {
    systemPrompt: "Return JSON only.",
    userPrompt: "{\"branch\":\"feature/a\"}"
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

// Watcher AI prediction schema를 만족하는 parsed JSON fixture
function validPrediction(): unknown {
  return {
    branchName: "feature/a",
    baseBranch: "main",
    prediction: "shared file 변경이 겹쳐 rebase 확인이 필요함",
    confidence: 82,
    recommendedActions: [{
      title: "base branch rebase",
      description: "shared file 변경을 먼저 rebase해 실제 conflict 여부를 확인함",
      priority: "high",
      files: ["src/shared.ts"]
    }],
    falsePositiveNotes: []
  }
}
