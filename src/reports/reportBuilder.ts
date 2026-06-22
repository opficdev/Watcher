import { BranchRiskStatus } from "../risks/types.js"
import type { BranchRiskStatus as BranchRiskStatusType } from "../risks/types.js"
import type {
  MergeRiskReport,
  MergeRiskReportInput,
  MergeRiskReportItem,
  MergeRiskReportOptions,
  MergeRiskReportSection
} from "./types.js"

// report에서 risk가 높은 section부터 보여주기 위한 고정 정렬 순서
const statusOrder: BranchRiskStatusType[] = [
  BranchRiskStatus.Critical,
  BranchRiskStatus.High,
  BranchRiskStatus.Medium,
  BranchRiskStatus.Low
]

// 별도 title 설정이 없을 때 사용하는 기본 section title
const defaultSectionTitles: Record<BranchRiskStatusType, string> = {
  [BranchRiskStatus.Critical]: "Critical",
  [BranchRiskStatus.High]: "High",
  [BranchRiskStatus.Medium]: "Medium",
  [BranchRiskStatus.Low]: "Low"
}

// branch risk 목록을 status별 section으로 묶은 report 모델로 변환
export function build(
  inputs: MergeRiskReportInput[],
  baseBranch: string,
  options: MergeRiskReportOptions = {}
): MergeRiskReport {
  // 기본 title 위에 호출자가 넘긴 title만 덮어씀
  const titles = {
    ...defaultSectionTitles,
    ...options.sectionTitles
  }
  // 정해진 status 순서대로 section을 만들고 item이 없는 section은 제외
  const sections = statusOrder
    .map(status => buildSection(inputs, status, titles[status]))
    .filter((section): section is MergeRiskReportSection => 0 < (section?.items.length ?? 0))

  return {
    baseBranch,
    generatedAt: options.generatedAt ?? new Date(),
    sections,
    totalBranchCount: inputs.length
  }
}

// 하나의 risk status에 해당하는 branch item section을 생성
function buildSection(
  inputs: MergeRiskReportInput[],
  status: BranchRiskStatusType,
  title: string
): MergeRiskReportSection | undefined {
  // 같은 section 안에서는 score가 높은 branch를 먼저 보여주고 동점이면 이름으로 정렬
  const items = inputs
    .filter(input => input.risk.status === status)
    .map(toReportItem)
    .sort(compareReportItems)

  if (items.length === 0) {
    return undefined
  }

  return { status, title, items }
}

// risk 계산 결과와 branch metadata를 report item 형태로 평탄화
function toReportItem(input: MergeRiskReportInput): MergeRiskReportItem {
  return {
    branchName: input.risk.branchName,
    baseBranch: input.risk.baseBranch,
    score: input.risk.score,
    status: input.risk.status,
    reasons: input.risk.reasons,
    author: input.branch.author,
    updatedAt: input.branch.updatedAt,
    pullRequest: input.branch.pullRequest,
    aiPrediction: input.aiPrediction,
    branch: input.branch
  }
}

// report item 정렬 기준: score 내림차순, branch 이름 오름차순
function compareReportItems(
  item: MergeRiskReportItem,
  other: MergeRiskReportItem
): number {
  if (item.score !== other.score) {
    return other.score - item.score
  }

  if (item.branchName < other.branchName) {
    return -1
  }

  if (item.branchName > other.branchName) {
    return 1
  }

  return 0
}
