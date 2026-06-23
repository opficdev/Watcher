import type {
  AiPredictionClient,
  AiPredictionPrompt
} from "./types.js"

// workflow log가 과도하게 커지지 않도록 Gemini 실패 응답 본문을 제한
const MAX_GEMINI_ERROR_DETAIL_LENGTH = 1000

// Gemini 서버 capacity나 일시적 내부 오류는 backoff 후 재시도 가능
const RETRYABLE_GEMINI_STATUS_CODES = new Set([429, 500, 502, 503, 504])

// Gemini 일시 실패가 장기 장애인지 판단하기 전까지 허용할 총 요청 횟수
const DEFAULT_GEMINI_MAX_ATTEMPTS = 5

// 503 계열 일시 실패의 exponential backoff 시작 대기 시간
const DEFAULT_GEMINI_RETRY_BASE_DELAY_MS = 2000

// 429 rate limit은 서버 capacity와 별도로 더 길게 대기
const DEFAULT_GEMINI_RATE_LIMIT_DELAY_MS = 60000

// 같은 시점에 retry가 몰리지 않도록 추가할 최대 jitter
const DEFAULT_GEMINI_RETRY_JITTER_MS = 1000

// Watcher가 Gemini prediction에 기본으로 사용할 model 이름
export const DEFAULT_GEMINI_PREDICTION_MODEL = "gemini-3.5-flash"

// consumer repository에서 Gemini API key를 주입할 environment variable 이름
export const GEMINI_API_KEY_ENV_NAME = "GEMINI_API_KEY"

// 호출 환경에 맞게 Gemini 연결값을 바꿔 끼우기 위한 설정
export type GeminiPredictionClientOptions = {
  apiKey?: string
  model?: string
  endpoint?: string
  fetch?: typeof fetch
  maxAttempts?: number
  retryBaseDelayMs?: number
  rateLimitDelayMs?: number
  retryJitterMs?: number
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

  // API version 교체와 proxy 구성을 위해 분리한 Gemini REST base URL
  private readonly endpoint: string

  // 실행 환경별 HTTP 호출 구현을 바꿔 끼우기 위한 fetch 구현
  private readonly fetcher: typeof fetch

  // 일시 실패가 지속될 때 최대 몇 번까지 요청할지 결정
  private readonly maxAttempts: number

  // 503 계열 일시 실패의 exponential backoff 시작 대기 시간
  private readonly retryBaseDelayMs: number

  // 429 rate limit 응답 후 다음 요청까지 기다릴 시간
  private readonly rateLimitDelayMs: number

  // retry 요청이 동시에 몰리는 것을 피하기 위한 최대 jitter
  private readonly retryJitterMs: number

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
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_GEMINI_MAX_ATTEMPTS)
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_GEMINI_RETRY_BASE_DELAY_MS
    this.rateLimitDelayMs = options.rateLimitDelayMs ?? DEFAULT_GEMINI_RATE_LIMIT_DELAY_MS
    this.retryJitterMs = options.retryJitterMs ?? DEFAULT_GEMINI_RETRY_JITTER_MS
  }

  // system/user prompt를 Gemini JSON 응답 요청으로 변환하고 parsed JSON을 반환
  async predict(prompt: AiPredictionPrompt): Promise<unknown> {
    const body = JSON.stringify(geminiRequestBodyFor(prompt))
    let lastResponse: Response | undefined

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const response = await this.fetcher(this.url(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey
        },
        body
      })

      if (response.ok) {
        const value = await response.json() as GeminiGenerateContentResponse
        return JSON.parse(geminiTextFor(value))
      }

      lastResponse = response

      if (!this.shouldRetry(response.status, attempt)) {
        break
      }

      await delay(this.retryDelayFor(response.status, attempt))
    }

    if (!lastResponse) {
      throw new Error("Gemini prediction request failed without response")
    }

    throw new Error(await geminiRequestErrorMessageFor(lastResponse))
  }

  // Gemini model별 generateContent 호출 URL을 구성
  private url(): string {
    return `${this.endpoint}/models/${this.model}:generateContent`
  }

  // retry 가능한 status이고 다음 시도 횟수가 남아 있는지 확인
  private shouldRetry(status: number, attempt: number): boolean {
    return attempt + 1 < this.maxAttempts && RETRYABLE_GEMINI_STATUS_CODES.has(status)
  }

  // 429는 더 길게 대기하고 503 계열은 exponential backoff로 간격을 늘림
  private retryDelayFor(status: number, attempt: number): number {
    const jitter = Math.floor(Math.random() * this.retryJitterMs)

    if (status === 429) {
      return this.rateLimitDelayMs + jitter
    }

    return (2 ** attempt) * this.retryBaseDelayMs + jitter
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
          mimeType: "APPLICATION_JSON",
          schema: aiPredictionSchema()
        }
      }
    }
  }
}

// 운영 환경에서는 retry 사이에 실제로 대기
function delay(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs))
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
    const rateLimitDetail = response.status === 429
      ? geminiRateLimitDetailFor(trimmed)
      : undefined

    if (rateLimitDetail) {
      return rateLimitDetail
    }

    if (MAX_GEMINI_ERROR_DETAIL_LENGTH < trimmed.length) {
      return trimmed.slice(0, MAX_GEMINI_ERROR_DETAIL_LENGTH) + "... (1000자 제한)"
    }

    return trimmed || undefined
  } catch {
    return undefined
  }
}

// Gemini 429 quota 응답은 report에 긴 원문 대신 핵심 metric과 retry 시간만 표시
function geminiRateLimitDetailFor(text: string): string | undefined {
  const message = geminiErrorMessageFor(text) ?? text
  const metric = valueAfter(message, "Quota exceeded for metric:")
  const limit = valueAfter(message, "limit:")
  const model = valueAfter(message, "model:")
  const retry = retryDelayTextFor(message)

  if (!metric && !retry) {
    return message || undefined
  }

  return [
    "Gemini quota exceeded",
    metric ? `metric: ${metric}` : undefined,
    limit ? `limit: ${limit}` : undefined,
    model ? `model: ${model}` : undefined,
    retry ? `retry after: ${retry}` : undefined
  ].filter((value): value is string => value !== undefined).join(", ")
}

// JSON error body에서 Gemini가 제공한 message만 추출
function geminiErrorMessageFor(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as {
      error?: {
        message?: unknown
      }
    }

    return typeof value.error?.message === "string" ? value.error.message : undefined
  } catch {
    return undefined
  }
}

// "key: value" 형태의 Gemini quota message에서 한 항목만 추출
function valueAfter(message: string, key: string): string | undefined {
  const index = message.indexOf(key)

  if (index === -1) {
    return undefined
  }

  const value = message.slice(index + key.length).trim()
  const end = value.search(/[,\n]/)
  const trimmed = (end === -1 ? value : value.slice(0, end)).trim()

  return trimmed || undefined
}

// Gemini quota message의 retry 안내 시간을 추출
function retryDelayTextFor(message: string): string | undefined {
  const match = message.match(/Please retry in ([0-9]+(?:\.[0-9]+)?s)/)

  return match?.[1]
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
