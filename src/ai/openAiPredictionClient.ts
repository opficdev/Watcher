import type {
  AiPredictionClient,
  AiPredictionPrompt,
  AiPredictionPromptResponseShape
} from "./types.js"

// workflow log가 과도하게 커지지 않도록 OpenAI 실패 응답 본문을 제한
const MAX_OPENAI_ERROR_DETAIL_LENGTH = 1000

// Watcher가 OpenAI prediction에 기본으로 사용할 model 이름
export const DEFAULT_OPENAI_PREDICTION_MODEL = "gpt-5.4-mini"

// consumer repository에서 OpenAI API key를 주입할 environment variable 이름
export const OPENAI_API_KEY_ENV_NAME = "OPENAI_API_KEY"

// 호출 환경에 맞게 OpenAI 연결값을 바꿔 끼우기 위한 설정
export type OpenAiPredictionClientOptions = {
  apiKey?: string
  model?: string
  endpoint?: string
  fetch?: typeof fetch
}

// Watcher가 사용하는 OpenAI Responses API 응답 중 JSON text 추출에 필요한 최소 shape
type OpenAiResponsesApiResponse = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      text?: string
    }>
  }>
}

// OpenAI Responses API를 Watcher의 AiPredictionClient interface에 맞게 감쌈
export class OpenAiPredictionClient implements AiPredictionClient {
  // OpenAI API 인증에 사용할 key
  private readonly apiKey: string

  // Responses API request body에 포함할 OpenAI model 이름
  private readonly model: string

  // API version 교체와 proxy 구성을 위해 분리한 OpenAI REST base URL
  private readonly endpoint: string

  // 실행 환경별 HTTP 호출 구현을 바꿔 끼우기 위한 fetch 구현
  private readonly fetcher: typeof fetch

  // 명시 options 또는 OPENAI_API_KEY 환경 변수로 OpenAI client를 구성
  constructor(options: OpenAiPredictionClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env[OPENAI_API_KEY_ENV_NAME]

    if (!apiKey) {
      throw new Error(`${OPENAI_API_KEY_ENV_NAME} is required to call OpenAI prediction`)
    }

    this.apiKey = apiKey
    this.model = options.model ?? DEFAULT_OPENAI_PREDICTION_MODEL
    this.endpoint = options.endpoint ?? "https://api.openai.com/v1"
    this.fetcher = options.fetch ?? fetch
  }

  // system/user prompt를 OpenAI structured output 요청으로 변환하고 parsed JSON을 반환
  async predict(prompt: AiPredictionPrompt): Promise<unknown> {
    const response = await this.fetcher(this.url(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(openAiRequestBodyFor(prompt, this.model))
    })

    if (!response.ok) {
      throw new Error(await openAiRequestErrorMessageFor(response))
    }

    const value = await response.json() as OpenAiResponsesApiResponse
    return JSON.parse(openAiTextFor(value))
  }

  // OpenAI Responses API 호출 URL을 구성
  private url(): string {
    return `${this.endpoint}/responses`
  }
}

// Watcher 기본 AI provider를 OpenAI client로 조립
export function createDefaultAiPredictionClient(
  options: OpenAiPredictionClientOptions = {}
): AiPredictionClient {
  return new OpenAiPredictionClient(options)
}

// Watcher가 검증할 branch 조합 응답 shape를 OpenAI structured output schema로 전달
function openAiRequestBodyFor(
  prompt: AiPredictionPrompt,
  model: string
): Record<string, unknown> {
  const responseFormat = responseFormatFor(prompt.responseShape)

  return {
    model,
    input: [
      {
        role: "developer",
        content: prompt.systemPrompt
      },
      {
        role: "user",
        content: prompt.userPrompt
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: responseFormat.name,
        strict: true,
        schema: responseFormat.schema
      }
    }
  }
}

// prompt가 요청한 응답 형태를 OpenAI schema 이름과 구조에 매핑
function responseFormatFor(
  responseShape: AiPredictionPromptResponseShape
): {
  name: string
  schema: Record<string, unknown>
} {
  switch (responseShape) {
    case "predictionPairConfirmedConflict":
      return {
        name: "ai_prediction_pair_confirmed_conflict",
        schema: aiConfirmedConflictSchema()
      }
    case "predictionPairCleanOverlap":
      return {
        name: "ai_prediction_pair_clean_overlap",
        schema: aiCleanOverlapSchema()
      }
  }
}

// OpenAI API가 반환한 HTTP 실패 원문을 보존해 workflow log에서 원인을 확인
async function openAiRequestErrorMessageFor(response: Response): Promise<string> {
  const detail = await openAiErrorDetailFor(response)
  const message = `OpenAI prediction request failed with status ${response.status}`

  return detail ? `${message}: ${detail}` : message
}

// 실패 응답 body를 읽을 수 없거나 비어 있으면 기존 status 기반 오류만 사용
async function openAiErrorDetailFor(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text()
    const trimmed = text.trim()
    const detail = openAiErrorMessageFor(trimmed) ?? trimmed

    if (MAX_OPENAI_ERROR_DETAIL_LENGTH < detail.length) {
      return detail.slice(0, MAX_OPENAI_ERROR_DETAIL_LENGTH) + "... (1000자 제한)"
    }

    return detail || undefined
  } catch {
    return undefined
  }
}

// OpenAI JSON error body에서는 report에 필요한 message만 추출
function openAiErrorMessageFor(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as {
      error?: {
        message?: unknown
      }
    }

    return typeof value.error?.message === "string"
      ? value.error.message
      : undefined
  } catch {
    return undefined
  }
}

// OpenAI 응답 text shortcut 또는 output content에서 JSON 문자열을 추출
function openAiTextFor(response: OpenAiResponsesApiResponse): string {
  if (response.output_text?.trim()) {
    return response.output_text
  }

  const text = response.output
    ?.flatMap(item => item.content ?? [])
    .map(content => content.text ?? "")
    .join("")

  if (!text?.trim()) {
    throw new Error("OpenAI prediction response text is empty")
  }

  return text
}

// 확정 conflict 해결 응답을 위한 OpenAI structured output schema
function aiConfirmedConflictSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: {
        type: "string",
        enum: ["confirmed_conflict"]
      },
      pair: branchPairSchema(),
      conflictCause: causeSchema(),
      integrationOrder: integrationOrderSchema(),
      patches: {
        type: "array",
        minItems: 1,
        items: patchSchema()
      }
    },
    required: [
      "kind",
      "pair",
      "conflictCause",
      "integrationOrder",
      "patches"
    ]
  }
}

// clean overlap 예방 응답을 위한 OpenAI structured output schema
function aiCleanOverlapSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: {
        type: "string",
        enum: ["clean_overlap"]
      },
      pair: branchPairSchema(),
      overlapCause: causeSchema(),
      integrationOrder: integrationOrderSchema(),
      preventiveActions: {
        type: "array",
        minItems: 1,
        items: preventiveActionSchema()
      }
    },
    required: [
      "kind",
      "pair",
      "overlapCause",
      "integrationOrder",
      "preventiveActions"
    ]
  }
}

// 좌우 순서를 보존하는 branch 조합 식별 schema
function branchPairSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      leftBranchName: { type: "string" },
      rightBranchName: { type: "string" }
    },
    required: ["leftBranchName", "rightBranchName"]
  }
}

// conflict 또는 overlap 원인과 관련 파일 schema
function causeSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      files: stringArraySchema()
    },
    required: ["summary", "files"]
  }
}

// merge 또는 rebase 작업 순서 schema
function integrationOrderSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      strategy: {
        type: "string",
        enum: ["merge", "rebase"]
      },
      firstBranchName: { type: "string" },
      secondBranchName: { type: "string" },
      reason: { type: "string" },
      steps: {
        ...stringArraySchema(),
        minItems: 1
      }
    },
    required: [
      "strategy",
      "firstBranchName",
      "secondBranchName",
      "reason",
      "steps"
    ]
  }
}

// 확정 conflict의 파일별 patch schema
function patchSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      filePath: { type: "string" },
      patch: { type: "string" },
      reason: { type: "string" }
    },
    required: ["filePath", "patch", "reason"]
  }
}

// clean overlap의 예방 조치 schema
function preventiveActionSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      files: stringArraySchema()
    },
    required: ["title", "description", "files"]
  }
}

// 문자열 목록 field의 공통 schema
function stringArraySchema(): Record<string, unknown> {
  return {
    type: "array",
    items: { type: "string" }
  }
}
