import type { BranchContext, BranchPullRequestMetadata } from "../branches/types.js"
import type { BranchRisk, BranchRiskReason, BranchRiskStatus } from "../risks/types.js"
import type { AiPredictionResult } from "../ai/types.js"

// report 전체가 어떤 base branch 기준으로 생성됐는지 표현
export type MergeRiskReport = {
  baseBranch: string
  generatedAt: Date
  sections: MergeRiskReportSection[]
  totalBranchCount: number
}

// 같은 risk status를 가진 branch item 묶음
export type MergeRiskReportSection = {
  status: BranchRiskStatus
  title: string
  items: MergeRiskReportItem[]
}

// report에 표시할 branch 단위 결과
export type MergeRiskReportItem = {
  branchName: string
  baseBranch: string
  score: number
  status: BranchRiskStatus
  reasons: BranchRiskReason[]
  author?: string
  updatedAt?: Date
  pullRequest?: BranchPullRequestMetadata
  aiPrediction?: AiPredictionResult
  branch: BranchContext
}

// report builder가 받는 branch risk, branch metadata, optional AI prediction 묶음
export type MergeRiskReportInput = {
  risk: BranchRisk
  branch: BranchContext
  aiPrediction?: AiPredictionResult
}

// report 생성 시점과 제목 정책을 조정하기 위한 설정
export type MergeRiskReportOptions = {
  generatedAt?: Date
  sectionTitles?: Partial<Record<BranchRiskStatus, string>>
}
