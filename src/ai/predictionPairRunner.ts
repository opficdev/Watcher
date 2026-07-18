import { build as buildPrompt } from "./predictionPairPromptBuilder.js"
import { validate as validateResponse } from "./predictionPairResponseValidator.js"
import type {
  AiPredictionClient,
  AiPredictionPairDebugObserver,
  AiPredictionPairEvidencePayload,
  AiPredictionPairResult,
  AiPredictionPairRunOptions
} from "./types.js"

// branch 조합을 입력 순서대로 실행하고 provider와 validation 실패를 조합별로 격리
export async function predict(
  payloads: AiPredictionPairEvidencePayload[],
  client: AiPredictionClient,
  options: AiPredictionPairRunOptions = {}
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
  options: AiPredictionPairRunOptions
): Promise<AiPredictionPairResult> {
  try {
    const prompt = buildPrompt(payload, options)
    await notifyDebugObserver(
      "onPromptBuilt",
      () => options.debugObserver?.onPromptBuilt?.({
        targetPair: targetPairFor(payload),
        prompt
      })
    )
    const response = await client.predict(prompt)
    await notifyDebugObserver(
      "onResponseReceived",
      () => options.debugObserver?.onResponseReceived?.({
        targetPair: targetPairFor(payload),
        response
      })
    )

    return {
      status: "predicted",
      pair: payload.pair,
      response: validateResponse(response, payload)
    }
  } catch (error) {
    const errorMessage = errorMessageFor(error)
    await notifyDebugObserver(
      "onPredictionFailed",
      () => options.debugObserver?.onPredictionFailed?.({
        targetPair: targetPairFor(payload),
        errorMessage
      })
    )

    return {
      status: "failed",
      pair: payload.pair,
      errorMessage
    }
  }
}

// debug observer 실패가 branch 조합 prediction을 중단하지 않도록 격리
async function notifyDebugObserver(
  eventName: keyof AiPredictionPairDebugObserver,
  action: () => Promise<void> | void | undefined
): Promise<void> {
  try {
    await action()
  } catch (error) {
    console.warn(
      `Failed to notify pair debug observer (${eventName}): ${errorMessageFor(error)}`
    )
  }
}

// observer가 입력 payload를 변경하지 못하도록 ordered pair metadata를 복사
function targetPairFor(
  payload: AiPredictionPairEvidencePayload
): AiPredictionPairEvidencePayload["pair"] {
  return {
    leftBranchName: payload.pair.leftBranchName,
    rightBranchName: payload.pair.rightBranchName
  }
}

// unknown provider 또는 validation 오류를 report 가능한 문자열로 변환
function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
