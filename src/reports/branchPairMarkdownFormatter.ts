import type {
  AiPredictionPairIntegrationOrder,
  AiPredictionPairPatch,
  AiPredictionPairPreventiveAction
} from "../ai/types.js"
import type { BranchComparisonPair } from "../branches/types.js"
import type { GitMergeTreeConflict } from "../git/types.js"
import type { BranchConflictGraphEdgeReason } from "../risks/types.js"
import type {
  BranchPairMergeRiskReport,
  BranchPairMergeRiskReportAiAnalysis,
  BranchPairMergeRiskReportBranchImpact,
  BranchPairMergeRiskReportExcludedBranch,
  BranchPairMergeRiskReportMergeError,
  BranchPairMergeRiskReportPairItem
} from "./branchPairTypes.js"

// branch 조합 report 모델을 전달 채널에서 사용할 Markdown 문자열로 변환
export function format(report: BranchPairMergeRiskReport): string {
  return [
    "## Merge Risk Report",
    "",
    "### Summary",
    ...summaryLinesFor(report),
    ...pairSectionLinesFor("Confirmed Conflicts", report.confirmedConflicts),
    ...pairSectionLinesFor("Potential Risks", report.potentialRisks),
    ...branchImpactSectionLinesFor(report.branchImpacts),
    ...excludedBranchSectionLinesFor(report.excludedBranches),
    ...mergeErrorSectionLinesFor(report.mergeErrors)
  ].join("\n")
}

// 활성 기간과 branch 및 조합 집계를 Summary line으로 구성
function summaryLinesFor(report: BranchPairMergeRiskReport): string[] {
  return [
    `- active period: ${code(report.activePeriod.since.toISOString())} - ` +
      `${code(report.activePeriod.until.toISOString())} ` +
      `(${code(`${report.activePeriod.dayCount.toString()} days`)})`,
    `- base branch: ${code(report.baseBranch)}`,
    `- discovered branches: ${report.discoveredBranchCount.toString()}`,
    `- watched branches: ${report.watchedBranchCount.toString()}`,
    `- compared pairs: ${report.comparisonPairCount.toString()}`,
    `- clean pairs: ${report.cleanPairCount.toString()}`
  ]
}

// 확정 conflict 또는 잠재 위험 section과 조합 상세를 구성
function pairSectionLinesFor(
  title: string,
  items: BranchPairMergeRiskReportPairItem[]
): string[] {
  return sectionLinesFor(title, itemBlocksFor(items))
}

// branch 조합 상세 항목 사이에 빈 line을 넣어 읽기 쉬운 block으로 구성
function itemBlocksFor(items: BranchPairMergeRiskReportPairItem[]): string[] {
  const lines: string[] = []

  for (const [index, item] of items.entries()) {
    if (index !== 0) {
      lines.push("")
    }

    lines.push(...linesForPairItem(item))
  }

  return lines
}

// 조합 하나의 상태, commit, deterministic 근거, conflict와 AI 결과를 표시
function linesForPairItem(item: BranchPairMergeRiskReportPairItem): string[] {
  return [
    `#### ${pairLabelFor(item.pair)}`,
    `- status: ${code(item.status)}`,
    "- commits:",
    `  - ${code(item.pair.leftBranchName)}: ${commitCode(item.leftCommitOid)}`,
    `  - ${code(item.pair.rightBranchName)}: ${commitCode(item.rightCommitOid)}`,
    "- reasons:",
    ...item.reasons.flatMap(reason => linesForReason(reason)),
    "- conflicts:",
    ...conflictLinesFor(item.conflicts),
    ...aiAnalysisLinesFor(item.aiAnalysis)
  ]
}

// commit OID가 없을 때도 branch별 수집 상태를 명시
function commitCode(commitOid: string | undefined): string {
  return code(commitOid ?? "unavailable")
}

// deterministic reason code와 관련 파일을 중첩 bullet로 구성
function linesForReason(reason: BranchConflictGraphEdgeReason): string[] {
  const lines = [`  - ${code(reason.code)}`]

  if (reason.files?.length) {
    lines.push(`    - files: ${reason.files.map(code).join(", ")}`)
  }

  return lines
}

// conflict type과 관련 path를 표시하고 없으면 없음 상태를 표시
function conflictLinesFor(conflicts: GitMergeTreeConflict[]): string[] {
  if (conflicts.length === 0) {
    return ["  - 없음"]
  }

  return conflicts.map(conflict =>
    `  - ${code(conflict.type)}: ${conflict.paths.map(code).join(", ")}`
  )
}

// AI predicted, skipped, failed 결과를 deterministic 상세 뒤에 추가
function aiAnalysisLinesFor(
  analysis: BranchPairMergeRiskReportAiAnalysis
): string[] {
  if (analysis.status === "skipped") {
    return [
      "- AI Analysis:",
      `  - status: ${code(analysis.status)}`,
      `  - reason: ${code(analysis.reason)}`
    ]
  }

  if (analysis.status === "failed") {
    return [
      "- AI Analysis:",
      `  - status: ${code(analysis.status)}`,
      `  - error: ${analysis.errorMessage}`
    ]
  }

  const response = analysis.response
  const cause = response.kind === "confirmed_conflict"
    ? response.conflictCause
    : response.overlapCause
  const lines = [
    "- AI Analysis:",
    `  - status: ${code(analysis.status)}`,
    `  - cause: ${cause.summary}`,
    `  - files: ${cause.files.map(code).join(", ")}`,
    ...recommendedResolutionLinesFor(response.integrationOrder)
  ]

  if (response.kind === "confirmed_conflict") {
    lines.push(...suggestedPatchLinesFor(response.patches))
  } else {
    lines.push(...preventiveActionLinesFor(response.preventiveActions))
  }

  return lines
}

// AI가 제안한 merge 또는 rebase 순서와 수행 단계를 표시
function recommendedResolutionLinesFor(
  order: AiPredictionPairIntegrationOrder
): string[] {
  return [
    "- Recommended Resolution:",
    `  - strategy: ${code(order.strategy)}`,
    `  - order: ${code(order.firstBranchName)} → ${code(order.secondBranchName)}`,
    `  - reason: ${order.reason}`,
    "  - steps:",
    ...order.steps.map((step, index) => `    ${index + 1}. ${step}`)
  ]
}

// 확정 conflict의 파일별 patch와 제안 이유를 안전한 code fence로 표시
function suggestedPatchLinesFor(
  patches: AiPredictionPairPatch[]
): string[] {
  return [
    "- Suggested Patch:",
    ...patches.flatMap(linesForPatch)
  ]
}

// patch 원문 내부 backtick보다 긴 fence를 선택해 Markdown block으로 구성
function linesForPatch(patch: AiPredictionPairPatch): string[] {
  const fence = fenceFor(patch.patch)

  return [
    `  - ${code(patch.filePath)}: ${patch.reason}`,
    `    ${fence}diff`,
    ...patch.patch.split("\n").map(line => `    ${line}`),
    `    ${fence}`
  ]
}

// 잠재 위험을 줄이기 위한 예방 조치와 관련 파일을 표시
function preventiveActionLinesFor(
  actions: AiPredictionPairPreventiveAction[]
): string[] {
  return [
    "- Preventive Actions:",
    ...actions.flatMap(action => [
      `  - ${action.title}: ${action.description}`,
      `    - files: ${action.files.map(code).join(", ")}`
    ])
  ]
}

// 감시 branch별 확정 conflict와 잠재 위험 조합 집계 section을 구성
function branchImpactSectionLinesFor(
  impacts: BranchPairMergeRiskReportBranchImpact[]
): string[] {
  const lines = impacts.flatMap(impact => [
    `- ${code(impact.branchName)}`,
    impactLineFor("confirmed", impact.confirmedConflictPairs),
    impactLineFor("potential", impact.potentialRiskPairs)
  ])

  return sectionLinesFor("Branch Impact", lines)
}

// branch 영향 유형별 조합 개수와 조합 목록을 한 line으로 표시
function impactLineFor(
  label: "confirmed" | "potential",
  pairs: BranchComparisonPair[]
): string {
  const pairList = pairs.length === 0
    ? "없음"
    : pairs.map(pairLabelFor).join(", ")

  return `  - ${label} (${pairs.length.toString()}): ${pairList}`
}

// 활성 기간 또는 개수 제한으로 제외된 branch section을 구성
function excludedBranchSectionLinesFor(
  branches: BranchPairMergeRiskReportExcludedBranch[]
): string[] {
  return sectionLinesFor(
    "Excluded Branches",
    branches.map(branch => `- ${code(branch.name)}: ${code(branch.reason)}`)
  )
}

// 조합 분석 실패의 reason과 error message section을 구성
function mergeErrorSectionLinesFor(
  errors: BranchPairMergeRiskReportMergeError[]
): string[] {
  return sectionLinesFor(
    "Merge Errors",
    errors.flatMap(error => linesForMergeError(error))
  )
}

// merge error 하나를 조합, reason code, error message로 표시
function linesForMergeError(
  error: BranchPairMergeRiskReportMergeError
): string[] {
  const reasons = error.reasons.length === 0
    ? "없음"
    : error.reasons.map(reason => code(reason.code)).join(", ")

  return [
    `- ${pairLabelFor(error.pair)}`,
    `  - reasons: ${reasons}`,
    `  - error: ${error.errorMessage}`
  ]
}

// 제목과 내용을 Markdown section으로 묶고 내용이 없으면 없음 상태를 표시
function sectionLinesFor(title: string, content: string[]): string[] {
  return [
    "",
    `### ${title}`,
    "",
    ...(content.length === 0 ? ["없음"] : content)
  ]
}

// branch 조합을 두 개의 inline code와 방향 기호로 표시
function pairLabelFor(pair: BranchComparisonPair): string {
  return `${code(pair.leftBranchName)} ↔ ${code(pair.rightBranchName)}`
}

// patch 안의 연속 backtick보다 길고 최소 세 개인 code fence를 구성
function fenceFor(value: string): string {
  const matches = value.match(/`+/g) ?? []
  const maxBackticks = Math.max(0, ...matches.map(match => match.length))

  return "`".repeat(Math.max(3, maxBackticks + 1))
}

// Markdown inline code 안의 backtick보다 긴 delimiter를 사용해 code span을 구성
function code(value: string): string {
  const backtick = "`"

  if (!value.includes(backtick)) {
    return `${backtick}${value}${backtick}`
  }

  const matches = value.match(/`+/g) ?? []
  const maxBackticks = Math.max(...matches.map(match => match.length))
  const delimiter = backtick.repeat(maxBackticks + 1)

  return `${delimiter} ${value} ${delimiter}`
}
