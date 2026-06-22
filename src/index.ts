export const watcherRuntimeName = "Watcher"

export function watcherRuntimeDescription(): string {
  return `${watcherRuntimeName} merge conflict probability automation`
}

export { collectBranchContexts } from "./branches/branchCollector.js"
export { selectWatchedBranches } from "./branches/branchSelector.js"
export { buildAiPredictionEvidencePayload } from "./ai/evidenceBuilder.js"
export { buildAiPredictionPrompt } from "./ai/predictionPromptBuilder.js"
export { DEFAULT_AI_PREDICTION_SYSTEM_PROMPT } from "./ai/promptTemplates.js"
export {
  DEFAULT_AI_PREDICTION_MINIMUM_SCORE,
  selectAiPredictionTargets
} from "./ai/predictionTargetSelector.js"
export { validateAiPredictionResponse } from "./ai/predictionResponseValidator.js"
export { collectGitMergeSignal } from "./git/gitMergeSignalCollector.js"
export { analyzeBranchMergeRisks } from "./risks/riskAnalyzer.js"

export type { BranchSource } from "./branches/branchCollector.js"

export type {
  AiPrediction,
  AiPredictionEvidencePayload,
  AiPredictionPrompt,
  AiPredictionPromptBuildOptions,
  AiPredictionTargetSelectionOptions,
  AiRecommendedAction,
  AiRecommendedActionPriority
} from "./ai/types.js"

export type {
  BranchContext,
  BranchCheckMetadata,
  BranchPullRequestMetadata,
  BranchSelectionOptions,
  RepositoryBranch
} from "./branches/types.js"

export type {
  GitMergeSignal,
  GitMergeSignalCollectionOptions,
  GitMergeSignalStatus
} from "./git/types.js"

export type {
  BranchChangedHunk,
  BranchRisk,
  BranchRiskAnalysisInput,
  BranchRiskAnalysisOptions,
  BranchRiskReason,
  BranchRiskReasonCode,
  BranchRiskStatus
} from "./risks/types.js"
