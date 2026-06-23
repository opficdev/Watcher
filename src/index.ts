export const watcherRuntimeName = "Watcher"

export function watcherRuntimeDescription(): string {
  return `${watcherRuntimeName} merge conflict probability automation`
}

export { collectBranchContexts } from "./branches/branchCollector.js"
export { select as selectWatchedBranches } from "./branches/branchSelector.js"
export { build as buildAiPredictionEvidencePayload } from "./ai/evidenceBuilder.js"
export {
  createDefaultAiPredictionClient,
  DEFAULT_GEMINI_PREDICTION_MODEL,
  GEMINI_API_KEY_ENV_NAME,
  GeminiPredictionClient
} from "./ai/geminiPredictionClient.js"
export { build as buildAiPredictionPrompt } from "./ai/predictionPromptBuilder.js"
export { DEFAULT_AI_PREDICTION_SYSTEM_PROMPT } from "./ai/promptTemplates.js"
export { predict as predictMergeRisksWithAi } from "./ai/predictionRunner.js"
export {
  DEFAULT_AI_PREDICTION_TARGET_STATUS,
  select as selectAiPredictionTargets
} from "./ai/predictionTargetSelector.js"
export { validate as validateAiPredictionResponse } from "./ai/predictionResponseValidator.js"
export { collectGitMergeSignal } from "./git/gitMergeSignalCollector.js"
export { send as sendMergeRiskReport } from "./reportChannels/reportChannel.js"
export { analyze as analyzeBranchMergeRisks } from "./risks/riskAnalyzer.js"
export { build as buildMergeRiskReport } from "./reports/reportBuilder.js"
export { format as formatMergeRiskReportMarkdown } from "./reports/markdownFormatter.js"
export { BranchRiskStatus } from "./risks/types.js"

export type { BranchSource } from "./branches/branchCollector.js"

export type {
  GeminiPredictionClientOptions
} from "./ai/geminiPredictionClient.js"

export type {
  AiPrediction,
  AiPredictionClient,
  AiPredictionEvidencePayload,
  AiPredictionFailedResult,
  AiPredictionPrompt,
  AiPredictionPromptBuildOptions,
  AiPredictionPredictedResult,
  AiPredictionResult,
  AiPredictionRunOptions,
  AiPredictionSkippedResult,
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
  ReportChannelFailure,
  ReportChannelInput,
  ReportChannelOptions,
  ReportChannelResult,
  ReportChannelSuccess,
  ReportChannelTarget
} from "./reportChannels/types.js"

export {
  DISCORD_WEBHOOK_URL_ENV_NAME
} from "./reportChannels/types.js"

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
  BranchRiskReasonCode
} from "./risks/types.js"

export type {
  MergeRiskReport,
  MergeRiskReportInput,
  MergeRiskReportItem,
  MergeRiskReportOptions,
  MergeRiskReportSection
} from "./reports/types.js"
