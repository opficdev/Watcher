import type {
  AiPredictionEvidencePayload
} from "./types.js"
import { BranchRiskStatus } from "../risks/types.js"

// OpenAI 호출량을 줄이기 위해 기본 AI prediction 대상은 critical possibility로 제한
export const DEFAULT_AI_PREDICTION_TARGET_STATUS = BranchRiskStatus.Critical

// deterministic possibility status 기준으로 AI prediction 대상 evidence만 선택
export function select(
  payloads: AiPredictionEvidencePayload[]
): AiPredictionEvidencePayload[] {
  return payloads.filter(payload =>
    payload.possibility.status === DEFAULT_AI_PREDICTION_TARGET_STATUS &&
    !payload.possibility.reasons.some(reason => reason.code === "confirmed_conflict")
  )
}
