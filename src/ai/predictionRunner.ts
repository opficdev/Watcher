import { buildBatch as buildBatchPrompt } from "./predictionPromptBuilder.js"
import { select as selectTargets } from "./predictionTargetSelector.js"
import { validateBatch as validateBatchResponse } from "./predictionResponseValidator.js"
import type {
  AiPrediction,
  AiPredictionDebugObserver,
  AiPredictionDebugTarget,
  AiPredictionClient,
  AiPredictionEvidencePayload,
  AiPredictionResult,
  AiPredictionRunOptions
} from "./types.js"

// 대상 선택, batch prompt 생성, provider 호출, 응답 검증을 branch별 AI prediction 결과로 연결
export async function predict(
  payloads: AiPredictionEvidencePayload[],
  client: AiPredictionClient,
  options: AiPredictionRunOptions = {}
): Promise<AiPredictionResult[]> {
  const targets = selectTargets(payloads)
  const targetSet = new Set(targets)

  if (targets.length === 0) {
    return payloads.map(skippedResultFor)
  }

  const predictedResults = await predictedResultsFor(targets, client, options)

  return payloads.map(payload => targetSet.has(payload)
    ? predictedResults.get(payload) ?? failedResultFor(payload, "AI prediction response is missing")
    : skippedResultFor(payload)
  )
}

// provider 호출과 schema 검증 실패를 선택된 branch 단위 failed 결과로 격리
async function predictedResultsFor(
  targets: AiPredictionEvidencePayload[],
  client: AiPredictionClient,
  options: AiPredictionRunOptions
): Promise<Map<AiPredictionEvidencePayload, AiPredictionResult>> {
  const targetBranches = targets.map(debugTargetFor)
  const prompt = buildBatchPrompt(targets, options)
  await notifyDebugObserver("onPromptBuilt", () => options.debugObserver?.onPromptBuilt?.({
    targetBranches,
    prompt
  }))

  let response: unknown

  try {
    response = await client.predict(prompt)
  } catch (error) {
    const errorMessage = errorMessageFor(error)
    await notifyDebugObserver("onPredictionFailed", () => options.debugObserver?.onPredictionFailed?.({
      targetBranches,
      errorMessage
    }))

    return new Map(targets.map(target => [
      target,
      failedResultFor(target, errorMessage)
    ]))
  }

  await notifyDebugObserver("onResponseReceived", () => options.debugObserver?.onResponseReceived?.({
    targetBranches,
    response
  }))

  try {
    const predictions = validateBatchResponse(response)

    return resultsByPayloadFor(targets, predictions)
  } catch (error) {
    const errorMessage = errorMessageFor(error)
    await notifyDebugObserver("onPredictionFailed", () => options.debugObserver?.onPredictionFailed?.({
      targetBranches,
      errorMessage
    }))

    return new Map(targets.map(target => [
      target,
      failedResultFor(target, errorMessage)
    ]))
  }
}

// debug observer 실패가 prediction 흐름을 중단하지 않도록 격리
async function notifyDebugObserver(
  eventName: keyof AiPredictionDebugObserver,
  action: () => Promise<void> | void | undefined
): Promise<void> {
  try {
    await action()
  } catch (error) {
    console.warn(`Failed to notify debug observer (${eventName}): ${errorMessageFor(error)}`)
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

// AI prediction 대상이 아닌 branch를 skipped 결과로 변환
function skippedResultFor(payload: AiPredictionEvidencePayload): AiPredictionResult {
  return {
    status: "skipped",
    branchName: payload.branch.name,
    baseBranch: payload.branch.baseBranch,
    reason: skippedReasonFor(payload)
  }
}

// provider 실패나 응답 누락을 branch별 failed 결과로 변환
function failedResultFor(
  payload: AiPredictionEvidencePayload,
  errorMessage: string
): AiPredictionResult {
  return {
    status: "failed",
    branchName: payload.branch.name,
    baseBranch: payload.branch.baseBranch,
    errorMessage
  }
}

// batch 응답을 원래 target payload와 매칭해 branch별 결과로 복원
function resultsByPayloadFor(
  targets: AiPredictionEvidencePayload[],
  predictions: AiPrediction[]
): Map<AiPredictionEvidencePayload, AiPredictionResult> {
  const predictionsByBranch = new Map(predictions.map(prediction => [
    predictionKeyFor(prediction.branchName, prediction.baseBranch),
    prediction
  ]))

  return new Map(targets.map(target => {
    const prediction = predictionsByBranch.get(predictionKeyFor(
      target.branch.name,
      target.branch.baseBranch
    ))

    return [
      target,
      prediction
        ? {
          status: "predicted",
          branchName: target.branch.name,
          baseBranch: target.branch.baseBranch,
          prediction
        }
        : failedResultFor(target, "AI prediction response is missing")
    ]
  }))
}

// branch 이름만 같은 다른 base branch와 섞이지 않도록 base branch까지 포함해 매칭
function predictionKeyFor(
  branchName: string,
  baseBranch: string
): string {
  return `${baseBranch}\u0000${branchName}`
}

// debug artifact에서 branch를 식별할 최소 metadata를 구성
function debugTargetFor(payload: AiPredictionEvidencePayload): AiPredictionDebugTarget {
  return {
    branchName: payload.branch.name,
    baseBranch: payload.branch.baseBranch
  }
}
