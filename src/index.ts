export const watcherRuntimeName = "Watcher"

// Watcher 실행 구성의 설명 문자열을 반환
export function watcherRuntimeDescription(): string {
  return `${watcherRuntimeName} merge conflict probability automation`
}

export { collectBranchContexts } from "./branches/branchCollector.js"
export {
  ACTIVE_BRANCH_WINDOW_DAYS,
  select as selectWatchedBranches
} from "./branches/branchSelector.js"
export {
  createDefaultAiPredictionClient,
  DEFAULT_OPENAI_PREDICTION_MODEL,
  OPENAI_API_KEY_ENV_NAME,
  OpenAiPredictionClient
} from "./ai/openAiPredictionClient.js"
export {
  build as buildAiPredictionPairPrompt
} from "./ai/predictionPairPromptBuilder.js"
export {
  DEFAULT_AI_CLEAN_OVERLAP_SYSTEM_PROMPT,
  DEFAULT_AI_CONFIRMED_CONFLICT_SYSTEM_PROMPT
} from "./ai/predictionPairPromptTemplates.js"
export { predict as predictBranchPairsWithAi } from "./ai/predictionPairRunner.js"
export {
  validate as validateAiPredictionPairResponse
} from "./ai/predictionPairResponseValidator.js"
export { send as sendMergeRiskReport } from "./reportChannels/reportChannel.js"
export {
  build as buildBranchPairMergeRiskReport
} from "./reports/branchPairReportBuilder.js"
export {
  format as formatBranchPairMergeRiskReportMarkdown
} from "./reports/branchPairMarkdownFormatter.js"
export type { BranchSource } from "./branches/branchCollector.js"

export type {
  OpenAiPredictionClientOptions
} from "./ai/openAiPredictionClient.js"

export type {
  AiPredictionClient,
  AiPredictionPairBranchMetadata,
  AiPredictionPairCodeContext,
  AiPredictionPairCodeContextStatus,
  AiPredictionPairDebugObserver,
  AiPredictionPairEvidencePayload,
  AiPredictionPairFailedResult,
  AiPredictionPairFailureDebugEvent,
  AiPredictionPairIntegrationOrder,
  AiPredictionPairMergeStatus,
  AiPredictionPairPatch,
  AiPredictionPairPredictedResult,
  AiPredictionPairPreventiveAction,
  AiPredictionPairPromptDebugEvent,
  AiPredictionPairResponse,
  AiPredictionPairResponseDebugEvent,
  AiPredictionPairResult,
  AiPredictionPairRunOptions,
  AiPredictionPairTargetStatus,
  AiPredictionPrompt,
  AiPredictionPromptBuildOptions,
  AiPredictionPromptResponseShape,
  AiCleanOverlapResponse,
  AiConfirmedConflictResponse
} from "./ai/types.js"

export type {
  BranchComparisonPair,
  BranchContext,
  BranchCheckMetadata,
  BranchPullRequestMetadata,
  BranchSelectionResult,
  BranchSelectionOptions,
  ExcludedBranch,
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
  GitMergeSignalStatus,
  GitMergeTreePairResult
} from "./git/types.js"

export type {
  BranchConflictGraph,
  BranchConflictGraphEdge
} from "./risks/types.js"

export type {
  BranchPairMergeRiskReport,
  BranchPairMergeRiskReportActivePeriod,
  BranchPairMergeRiskReportAiAnalysis,
  BranchPairMergeRiskReportBranchImpact,
  BranchPairMergeRiskReportExcludedBranch,
  BranchPairMergeRiskReportInput,
  BranchPairMergeRiskReportMergeError,
  BranchPairMergeRiskReportPairItem
} from "./reports/branchPairTypes.js"
