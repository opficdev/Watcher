import { build as buildPrompt } from "./predictionPairPromptBuilder.js"
import { validate as validateResponse } from "./predictionPairResponseValidator.js"
import type {
  AiPredictionClient,
  AiPredictionPairEvidencePayload,
  AiPredictionPairResult,
  AiPredictionPromptBuildOptions
} from "./types.js"

// branch 조합을 입력 순서대로 실행하고 provider와 validation 실패를 조합별로 격리
export async function predict(
  payloads: AiPredictionPairEvidencePayload[],
  client: AiPredictionClient,
  options: AiPredictionPromptBuildOptions = {}
): Promise<AiPredictionPairResult[]> {
  const results: AiPredictionPairResult[] = []

  for (const payload of payloads) {
    results.push(await resultFor(payload, client, options))
  }

  return results
}

// branch 조합 하나의 prompt 생성, provider 호출, 응답 검증 실행
async function resultFor(
  payload: AiPredictionPairEvidencePayload,
  client: AiPredictionClient,
  options: AiPredictionPromptBuildOptions
): Promise<AiPredictionPairResult> {
  try {
    const prompt = buildPrompt(payload, options)
    const response = await client.predict(prompt)

    return {
      status: "predicted",
      pair: payload.pair,
      response: validateResponse(response, payload)
    }
  } catch (error) {
    return {
      status: "failed",
      pair: payload.pair,
      errorMessage: errorMessageFor(error)
    }
  }
}

// unknown provider 또는 validation 오류를 report 가능한 문자열로 변환
function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
