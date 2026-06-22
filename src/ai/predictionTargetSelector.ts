import type {
  AiPredictionEvidencePayload,
  AiPredictionTargetSelectionOptions
} from "./types.js"

// medium 이상 possibility를 기본 AI prediction 대상으로 삼기 위한 최소 score
export const DEFAULT_AI_PREDICTION_MINIMUM_SCORE = 25

// deterministic possibility score 기준으로 AI prediction 대상 evidence만 선택
export function selectAiPredictionTargets(
  payloads: AiPredictionEvidencePayload[],
  options: AiPredictionTargetSelectionOptions = {}
): AiPredictionEvidencePayload[] {
  const minimumScore = options.minimumScore ?? DEFAULT_AI_PREDICTION_MINIMUM_SCORE

  return payloads.filter(payload => minimumScore <= payload.possibility.score)
}
