import {
  DEFAULT_AI_CLEAN_OVERLAP_SYSTEM_PROMPT,
  DEFAULT_AI_CONFIRMED_CONFLICT_SYSTEM_PROMPT
} from "./predictionPairPromptTemplates.js"
import type {
  AiPredictionPairEvidencePayload,
  AiPredictionPrompt,
  AiPredictionPromptBuildOptions
} from "./types.js"

// branch 조합의 deterministic 상태에 맞는 전용 prompt 구성
export function build(
  payload: AiPredictionPairEvidencePayload,
  options: AiPredictionPromptBuildOptions = {}
): AiPredictionPrompt {
  const confirmedConflict = payload.targetStatus === "confirmed_conflict"

  return {
    systemPrompt: options.systemPrompt ?? (confirmedConflict
      ? DEFAULT_AI_CONFIRMED_CONFLICT_SYSTEM_PROMPT
      : DEFAULT_AI_CLEAN_OVERLAP_SYSTEM_PROMPT),
    userPrompt: JSON.stringify(payload, null, 2),
    responseShape: confirmedConflict
      ? "predictionPairConfirmedConflict"
      : "predictionPairCleanOverlap"
  }
}
