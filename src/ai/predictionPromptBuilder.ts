import { DEFAULT_AI_PREDICTION_SYSTEM_PROMPT } from "./promptTemplates.js"
import type {
  AiPredictionEvidencePayload,
  AiPredictionPrompt,
  AiPredictionPromptBuildOptions
} from "./types.js"

// deterministic evidence만 사용해 AI prediction prompt를 구성
export function buildAiPredictionPrompt(
  payload: AiPredictionEvidencePayload,
  options: AiPredictionPromptBuildOptions = {}
): AiPredictionPrompt {
  return {
    systemPrompt: options.systemPrompt ?? DEFAULT_AI_PREDICTION_SYSTEM_PROMPT,
    userPrompt: JSON.stringify(promptEvidenceFor(payload), null, 2)
  }
}

// prompt에 필요한 branch metadata와 deterministic evidence만 정제
function promptEvidenceFor(payload: AiPredictionEvidencePayload): Record<string, unknown> {
  return {
    branch: {
      name: payload.branch.name,
      baseBranch: payload.branch.baseBranch,
      headSha: payload.branch.headSha,
      author: payload.branch.author,
      updatedAt: payload.branch.updatedAt?.toISOString(),
      pullRequest: payload.branch.pullRequest,
      checks: payload.branch.checks
    },
    deterministicPossibility: payload.possibility,
    gitSignal: payload.gitSignal,
    changedHunks: payload.changedHunks
  }
}
