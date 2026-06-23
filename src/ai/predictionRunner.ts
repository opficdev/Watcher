import { build as buildPrompt } from "./predictionPromptBuilder.js"
import { select as selectTargets } from "./predictionTargetSelector.js"
import { validate as validateResponse } from "./predictionResponseValidator.js"
import type {
  AiPredictionClient,
  AiPredictionEvidencePayload,
  AiPredictionResult,
  AiPredictionRunOptions
} from "./types.js"

// Gemini free tier rate limit을 줄이기 위해 선택된 AI 호출 사이에 둘 내부 대기 시간
const DEFAULT_AI_PREDICTION_DELAY_MS = 60000

// 대상 선택, prompt 생성, provider 호출, 응답 검증을 branch별 AI prediction 결과로 연결
export async function predict(
  payloads: AiPredictionEvidencePayload[],
  client: AiPredictionClient,
  options: AiPredictionRunOptions = {}
): Promise<AiPredictionResult[]> {
  const targets = new Set(selectTargets(payloads))
  const results: AiPredictionResult[] = []

  for (const payload of payloads) {
    if (!targets.has(payload)) {
      results.push({
        status: "skipped",
        branchName: payload.branch.name,
        baseBranch: payload.branch.baseBranch,
        reason: skippedReasonFor(payload)
      })
      continue
    }

    results.push(await predictedResultFor(payload, client, options))
    targets.delete(payload)

    if (0 < targets.size) {
      await delay(DEFAULT_AI_PREDICTION_DELAY_MS)
    }
  }

  return results
}

// provider 호출과 schema 검증 실패를 branch 단위 failed 결과로 격리
async function predictedResultFor(
  payload: AiPredictionEvidencePayload,
  client: AiPredictionClient,
  options: AiPredictionRunOptions
): Promise<AiPredictionResult> {
  try {
    const prompt = buildPrompt(payload, options)
    const response = await client.predict(prompt)
    const prediction = validateResponse(response)

    return {
      status: "predicted",
      branchName: payload.branch.name,
      baseBranch: payload.branch.baseBranch,
      prediction
    }
  } catch (error) {
    return {
      status: "failed",
      branchName: payload.branch.name,
      baseBranch: payload.branch.baseBranch,
      errorMessage: errorMessageFor(error)
    }
  }
}

// unknown error를 report 가능한 문자열로 변환
function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// AI prediction 대상이 아닌 branch의 생략 사유를 report 가능한 값으로 변환
function skippedReasonFor(payload: AiPredictionEvidencePayload): "not_target" | "confirmed_conflict" {
  return payload.possibility.reasons.some(reason => reason.code === "confirmed_conflict")
    ? "confirmed_conflict"
    : "not_target"
}

// 선택된 AI provider 호출 사이에 간격을 두어 rate limit 진입 가능성을 낮춤
function delay(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve()
  }

  return new Promise(resolve => setTimeout(resolve, delayMs))
}
