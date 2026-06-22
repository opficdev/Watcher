import type {
  AiPredictionClient,
  AiPredictionPrompt
} from "./types.js"

// workflow log가 과도하게 커지지 않도록 Gemini 실패 응답 본문을 제한
const MAX_GEMINI_ERROR_DETAIL_LENGTH = 1000

// Watcher가 Gemini prediction에 기본으로 사용할 model 이름
export const DEFAULT_GEMINI_PREDICTION_MODEL = "gemini-3.5-flash"

// consumer repository에서 Gemini API key를 주입할 environment variable 이름
export const GEMINI_API_KEY_ENV_NAME = "GEMINI_API_KEY"

// 테스트와 운영 환경에서 Gemini 연결값을 바꿔 끼우기 위한 설정
export type GeminiPredictionClientOptions = {
  apiKey?: string
  model?: string
  endpoint?: string
  fetch?: typeof fetch
}

// Watcher가 사용하는 Gemini generateContent 응답 중 JSON text 추출에 필요한 최소 shape
type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
  }>
}

// Gemini generateContent REST API를 Watcher의 AiPredictionClient interface에 맞게 감쌈
export class GeminiPredictionClient implements AiPredictionClient {
  // Gemini API 인증에 사용할 key
  private readonly apiKey: string

  // generateContent endpoint에 포함할 Gemini model 이름
  private readonly model: string

  // 테스트와 API version 교체를 위해 분리한 Gemini REST base URL
  private readonly endpoint: string

  // 테스트에서 network 없이 검증할 수 있도록 주입 가능한 fetch 구현
  private readonly fetcher: typeof fetch

  // 명시 options 또는 GEMINI_API_KEY 환경 변수로 Gemini client를 구성
  constructor(options: GeminiPredictionClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env[GEMINI_API_KEY_ENV_NAME]

    if (!apiKey) {
      throw new Error(`${GEMINI_API_KEY_ENV_NAME} is required to call Gemini prediction`)
    }

    this.apiKey = apiKey
    this.model = options.model ?? DEFAULT_GEMINI_PREDICTION_MODEL
    this.endpoint = options.endpoint ?? "https://generativelanguage.googleapis.com/v1beta"
    this.fetcher = options.fetch ?? fetch
  }

  // system/user prompt를 Gemini JSON 응답 요청으로 변환하고 parsed JSON을 반환
  async predict(prompt: AiPredictionPrompt): Promise<unknown> {
    const response = await this.fetcher(this.url(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey
      },
      body: JSON.stringify(geminiRequestBodyFor(prompt))
    })

    if (!response.ok) {
      throw new Error(await geminiRequestErrorMessageFor(response))
    }

    const value = await response.json() as GeminiGenerateContentResponse
    return JSON.parse(geminiTextFor(value))
  }

  // Gemini model별 generateContent 호출 URL을 구성
  private url(): string {
    return `${this.endpoint}/models/${this.model}:generateContent`
  }
}

// Watcher 기본 AI provider를 Gemini client로 조립
export function createDefaultAiPredictionClient(
  options: GeminiPredictionClientOptions = {}
): AiPredictionClient {
  return new GeminiPredictionClient(options)
}

// Watcher가 검증할 AiPrediction shape를 Gemini structured output schema로 전달
function geminiRequestBodyFor(prompt: AiPredictionPrompt): Record<string, unknown> {
  return {
    systemInstruction: {
      parts: [{ text: prompt.systemPrompt }]
    },
    contents: [{
      role: "user",
      parts: [{ text: prompt.userPrompt }]
    }],
    generationConfig: {
      responseFormat: {
        text: {
          mimeType: "application/json",
          schema: aiPredictionSchema()
        }
      }
    }
  }
}

// Gemini API가 반환한 HTTP 실패 원문을 보존해 workflow log에서 원인을 확인
async function geminiRequestErrorMessageFor(response: Response): Promise<string> {
  const detail = await geminiErrorDetailFor(response)
  const message = `Gemini prediction request failed with status ${response.status}`

  return detail ? `${message}: ${detail}` : message
}

// 실패 응답 body를 읽을 수 없거나 비어 있으면 기존 status 기반 오류만 사용
async function geminiErrorDetailFor(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text()
    const trimmed = text.trim()

    if (MAX_GEMINI_ERROR_DETAIL_LENGTH < trimmed.length) {
      return trimmed.slice(0, MAX_GEMINI_ERROR_DETAIL_LENGTH) + "... (1000자 제한)"
    }

    return trimmed || undefined
  } catch {
    return undefined
  }
}

// Gemini 응답 part가 여러 개로 나뉘어도 하나의 JSON 문자열로 합침
function geminiTextFor(response: GeminiGenerateContentResponse): string {
  const text = response.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? "")
    .join("")

  if (!text) {
    throw new Error("Gemini prediction response text is empty")
  }

  return text
}

// Gemini가 Watcher prediction contract에 맞는 JSON을 반환하도록 요청하는 schema
function aiPredictionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      branchName: { type: "string" },
      baseBranch: { type: "string" },
      prediction: { type: "string" },
      confidence: { type: "number" },
      recommendedActions: {
        type: "array",
        items: recommendedActionSchema()
      },
      falsePositiveNotes: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: [
      "branchName",
      "baseBranch",
      "prediction",
      "confidence"
    ]
  }
}

// AI recommended action 하나의 JSON 구조를 Gemini structured output schema로 표현
function recommendedActionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      priority: {
        type: "string",
        enum: ["low", "medium", "high"]
      },
      files: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: [
      "title",
      "description",
      "priority"
    ]
  }
}
