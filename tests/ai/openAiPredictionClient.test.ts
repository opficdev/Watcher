import test from "node:test"
import assert from "node:assert/strict"
import {
  createDefaultAiPredictionClient,
  DEFAULT_OPENAI_PREDICTION_MODEL,
  OPENAI_API_KEY_ENV_NAME,
  OpenAiPredictionClient,
  type AiPredictionPrompt
} from "../../src/index.js"

// OPENAI_API_KEY가 없으면 provider 호출 전에 명확한 설정 오류가 발생하는지 확인
test("requires OpenAI API key", () => {
  const originalApiKey = process.env[OPENAI_API_KEY_ENV_NAME]
  delete process.env[OPENAI_API_KEY_ENV_NAME]

  try {
    assert.throws(
      () => new OpenAiPredictionClient({
        fetch: fetchSpy(validOpenAiResponse())
      }),
      new RegExp(OPENAI_API_KEY_ENV_NAME)
    )
  } finally {
    if (originalApiKey === undefined) {
      delete process.env[OPENAI_API_KEY_ENV_NAME]
    } else {
      process.env[OPENAI_API_KEY_ENV_NAME] = originalApiKey
    }
  }
})

// Watcher 기본 AI provider factory가 OpenAI client를 반환하는지 확인
test("creates OpenAI client as default AI prediction client", async () => {
  const client = createDefaultAiPredictionClient({
    apiKey: "openai-key",
    fetch: fetchSpy(validOpenAiResponse())
  })

  const response = await client.predict(prompt())

  assert.deepEqual(response, validConfirmedConflictResponse())
})

// Watcher prompt가 OpenAI Responses API payload로 변환되는지 확인
test("sends prompt to OpenAI responses endpoint", async () => {
  const fetcher = fetchSpy(validOpenAiResponse())
  const client = new OpenAiPredictionClient({
    apiKey: "openai-key",
    fetch: fetcher
  })

  await client.predict(prompt())

  assert.equal(fetcher.requests.length, 1)
  const request = fetcher.requests[0]
  assert.equal(request?.url, "https://api.openai.com/v1/responses")
  assert.equal(request?.init.headers["Authorization"], "Bearer openai-key")

  const body = JSON.parse(request?.init.body as string) as {
    model: string
    input: Array<{
      role: string
      content: string
    }>
    text: {
      format: {
        type: string
        name: string
        strict: boolean
      }
    }
  }

  assert.equal(body.model, DEFAULT_OPENAI_PREDICTION_MODEL)
  assert.equal(body.input[0]?.role, "developer")
  assert.equal(body.input[0]?.content, "Return JSON only.")
  assert.equal(body.input[1]?.role, "user")
  assert.equal(body.input[1]?.content, "{\"pair\":{\"leftBranchName\":\"feature/a\",\"rightBranchName\":\"feature/b\"}}")
  assert.equal(body.text.format.type, "json_schema")
  assert.equal(body.text.format.name, "ai_prediction_pair_confirmed_conflict")
  assert.equal(body.text.format.strict, true)
})

// 확정 conflict 요청이 patch 전용 schema를 사용하는지 확인
test("sends confirmed conflict pair response schema to OpenAI", async () => {
  const spy = fetchSpy(validOpenAiResponse())
  const client = new OpenAiPredictionClient({
    apiKey: "openai-key",
    fetch: spy
  })

  await client.predict(prompt())

  const body = JSON.parse(String(spy.requests[0]?.init.body)) as PairRequestBody
  const schema = body.text.format.schema

  assert.equal(body.text.format.name, "ai_prediction_pair_confirmed_conflict")
  assert.equal(schema.additionalProperties, false)
  assert.notEqual(schema.properties.conflictCause, undefined)
  assert.notEqual(schema.properties.patches, undefined)
  assert.equal(schema.properties.overlapCause, undefined)
  assert.equal(schema.properties.preventiveActions, undefined)
  assert.equal(schema.properties.patches?.minItems, 1)
})

// clean overlap 요청이 예방 조치 전용 schema를 사용하는지 확인
test("sends clean overlap pair response schema to OpenAI", async () => {
  const spy = fetchSpy(validOpenAiResponse())
  const client = new OpenAiPredictionClient({
    apiKey: "openai-key",
    fetch: spy
  })

  await client.predict(cleanOverlapPairPrompt())

  const body = JSON.parse(String(spy.requests[0]?.init.body)) as PairRequestBody
  const schema = body.text.format.schema

  assert.equal(body.text.format.name, "ai_prediction_pair_clean_overlap")
  assert.equal(schema.additionalProperties, false)
  assert.notEqual(schema.properties.overlapCause, undefined)
  assert.notEqual(schema.properties.preventiveActions, undefined)
  assert.equal(schema.properties.conflictCause, undefined)
  assert.equal(schema.properties.patches, undefined)
  assert.equal(schema.properties.preventiveActions?.minItems, 1)
})

// OpenAI HTTP 실패가 branch 조합 failed result로 격리될 수 있도록 Error로 노출되는지 확인
test("throws when OpenAI request fails", async () => {
  const client = new OpenAiPredictionClient({
    apiKey: "openai-key",
    fetch: fetchSpy({}, {
      ok: false,
      status: 429,
      text: JSON.stringify({
        error: {
          message: "rate limit exceeded"
        }
      })
    })
  })

  await assert.rejects(client.predict(prompt()), {
    message: "OpenAI prediction request failed with status 429: rate limit exceeded"
  })
})

// OpenAI HTTP 실패 응답이 너무 길면 workflow log를 보호하기 위해 일부만 노출하는지 확인
test("truncates long OpenAI error response", async () => {
  const client = new OpenAiPredictionClient({
    apiKey: "openai-key",
    fetch: fetchSpy({}, {
      ok: false,
      status: 400,
      text: "x".repeat(1200)
    })
  })

  await assert.rejects(
    client.predict(prompt()),
    /OpenAI prediction request failed with status 400: x{1000}\.\.\. \(1000자 제한\)/
  )
})

// OpenAI 응답에 JSON text가 없으면 schema validation 이전에 명확한 오류가 발생하는지 확인
test("throws when OpenAI response text is empty", async () => {
  const client = new OpenAiPredictionClient({
    apiKey: "openai-key",
    fetch: fetchSpy({
      output: [{
        content: []
      }]
    })
  })

  await assert.rejects(
    client.predict(prompt()),
    /response text is empty/
  )
})

// OpenAI client가 보낸 request를 테스트에서 검증하기 위한 fetch spy 타입
type FetchSpy = typeof fetch & {
  requests: Array<{
    url: string
    init: {
      headers: Record<string, string>
      body?: BodyInit | null
    }
  }>
}

type PairRequestBody = {
  text: {
    format: {
      name: string
      schema: {
        additionalProperties: boolean
        properties: Record<string, {
          minItems?: number
        } | undefined>
      }
    }
  }
}

// network 호출 없이 OpenAI response와 HTTP 상태를 주입하는 fetch 대역
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

// OpenAI client가 전송할 system/user prompt fixture
function prompt(): AiPredictionPrompt {
  return {
    systemPrompt: "Return JSON only.",
    userPrompt: "{\"pair\":{\"leftBranchName\":\"feature/a\",\"rightBranchName\":\"feature/b\"}}",
    responseShape: "predictionPairConfirmedConflict"
  }
}

function cleanOverlapPairPrompt(): AiPredictionPrompt {
  return {
    systemPrompt: "Return clean overlap JSON only.",
    userPrompt: "{\"pair\":{\"leftBranchName\":\"feature/a\",\"rightBranchName\":\"feature/b\"}}",
    responseShape: "predictionPairCleanOverlap"
  }
}

// OpenAI Responses API가 반환하는 JSON text 응답 fixture
function validOpenAiResponse(): unknown {
  return {
    output: [{
      content: [{
        text: JSON.stringify(validConfirmedConflictResponse())
      }]
    }]
  }
}

// Watcher branch 조합 prediction schema를 만족하는 parsed JSON fixture
function validConfirmedConflictResponse(): unknown {
  return {
    kind: "confirmed_conflict",
    pair: {
      leftBranchName: "feature/a",
      rightBranchName: "feature/b"
    },
    conflictCause: {
      summary: "shared file conflict",
      files: ["src/shared.ts"]
    },
    integrationOrder: {
      strategy: "merge",
      firstBranchName: "feature/a",
      secondBranchName: "feature/b",
      reason: "resolve shared changes",
      steps: ["merge feature/a", "merge feature/b"]
    },
    patches: [{
      filePath: "src/shared.ts",
      patch: "@@ -1 +1 @@",
      reason: "resolve conflict"
    }]
  }
}
