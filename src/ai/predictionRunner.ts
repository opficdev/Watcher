import { build as buildPrompt } from "./predictionPromptBuilder.js"
import { select as selectTargets } from "./predictionTargetSelector.js"
import { validate as validateResponse } from "./predictionResponseValidator.js"
import type {
  AiPredictionClient,
  AiPredictionEvidencePayload,
  AiPredictionResult,
  AiPredictionRunOptions
} from "./types.js"

// 대상 선택, prompt 생성, provider 호출, 응답 검증을 branch별 AI prediction 결과로 연결
export async function predict(
  payloads: AiPredictionEvidencePayload[],
  client: AiPredictionClient,
  options: AiPredictionRunOptions = {}
): Promise<AiPredictionResult[]> {
  const targets = new Set(selectTargets(payloads, options))

  return Promise.all(payloads.map(async (payload): Promise<AiPredictionResult> => {
    if (!targets.has(payload)) {
      return {
        status: "skipped",
        branchName: payload.branch.name,
        baseBranch: payload.branch.baseBranch,
        reason: "below_threshold"
      }
    }

    return predictedResultFor(payload, client, options)
  }))
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
