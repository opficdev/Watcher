import type {
  AiPrediction,
  AiRecommendedAction,
  AiRecommendedActionPriority
} from "./types.js"

const actionPriorities = new Set<AiRecommendedActionPriority>([
  "low",
  "medium",
  "high"
])

// AI가 반환한 unknown JSON을 Watcher가 사용하는 prediction 모델로 검증
export function validateAiPredictionResponse(response: unknown): AiPrediction {
  const value = objectFor(response, "response")

  return {
    branchName: stringFor(value.branchName, "branchName"),
    baseBranch: stringFor(value.baseBranch, "baseBranch"),
    prediction: stringFor(value.prediction, "prediction"),
    confidence: confidenceFor(value.confidence),
    recommendedActions: arrayFor(value.recommendedActions, "recommendedActions")
      .map((action, index) => recommendedActionFor(action, index)),
    falsePositiveNotes: arrayFor(value.falsePositiveNotes, "falsePositiveNotes")
      .map((note, index) => stringFor(note, `falsePositiveNotes[${index}]`))
  }
}

// AI action 항목 하나가 report 가능한 shape인지 검증
function recommendedActionFor(
  action: unknown,
  index: number
): AiRecommendedAction {
  const value = objectFor(action, `recommendedActions[${index}]`)
  const priority = priorityFor(value.priority, `recommendedActions[${index}].priority`)
  const files = value.files === undefined
    ? undefined
    : arrayFor(value.files, `recommendedActions[${index}].files`)
      .map((file, fileIndex) => stringFor(file, `recommendedActions[${index}].files[${fileIndex}]`))

  return {
    title: stringFor(value.title, `recommendedActions[${index}].title`),
    description: stringFor(value.description, `recommendedActions[${index}].description`),
    priority,
    files
  }
}

// confidence는 report에서 비교할 수 있도록 0-100 범위의 숫자로 제한
function confidenceFor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || 100 < value) {
    throw new Error("AI prediction response confidence must be a number between 0 and 100")
  }

  return value
}

// action priority가 Watcher가 표시할 수 있는 허용 값인지 검증
function priorityFor(
  value: unknown,
  path: string
): AiRecommendedActionPriority {
  if (typeof value !== "string" || !actionPriorities.has(value as AiRecommendedActionPriority)) {
    throw new Error(`AI prediction response ${path} must be low, medium, or high`)
  }

  return value as AiRecommendedActionPriority
}

// unknown 값이 key 접근 가능한 plain object인지 검증
function objectFor(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`AI prediction response ${path} must be an object`)
  }

  return value as Record<string, unknown>
}

// unknown 값이 배열 field인지 검증
function arrayFor(
  value: unknown,
  path: string
): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`AI prediction response ${path} must be an array`)
  }

  return value
}

// unknown 값이 비어 있지 않은 문자열 field인지 검증
function stringFor(
  value: unknown,
  path: string
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`AI prediction response ${path} must be a non-empty string`)
  }

  return value
}
