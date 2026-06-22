import { buildAiPredictionPrompt } from "./predictionPromptBuilder.js"
import { selectAiPredictionTargets } from "./predictionTargetSelector.js"
import { validateAiPredictionResponse } from "./predictionResponseValidator.js"
import type {
  AiPredictionClient,
  AiPredictionEvidencePayload,
  AiPredictionResult,
  AiPredictionRunOptions
} from "./types.js"

// 대상 선택, prompt 생성, provider 호출, 응답 검증을 branch별 AI prediction 결과로 연결
export async function predictMergeRisksWithAi(
  payloads: AiPredictionEvidencePayload[],
  client: AiPredictionClient,
  options: AiPredictionRunOptions = {}
): Promise<AiPredictionResult[]> {
  const targets = new Set(selectAiPredictionTargets(payloads, options))
  const results: AiPredictionResult[] = []

  for (const payload of payloads) {
    if (!targets.has(payload)) {
      results.push(skippedResultFor(payload))
      continue
    }

    results.push(await predictedResultFor(payload, client, options))
  }

  return results
}

// deterministic threshold 미만 branch는 AI 호출 없이 skipped로 기록
function skippedResultFor(payload: AiPredictionEvidencePayload): AiPredictionResult {
  return {
    status: "skipped",
    branchName: payload.branch.name,
    baseBranch: payload.branch.baseBranch,
    reason: "below_threshold"
  }
}

// provider 호출과 schema 검증 실패를 branch 단위 failed 결과로 격리
async function predictedResultFor(
  payload: AiPredictionEvidencePayload,
  client: AiPredictionClient,
  options: AiPredictionRunOptions
): Promise<AiPredictionResult> {
  try {
    const prompt = buildAiPredictionPrompt(payload, options)
    const response = await client.predict(prompt)
    const prediction = validateAiPredictionResponse(response)

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
