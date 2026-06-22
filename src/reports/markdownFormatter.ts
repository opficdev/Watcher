import type {
  MergeRiskReport,
  MergeRiskReportItem
} from "./types.js"
import type { BranchRiskReason } from "../risks/types.js"

// MergeRiskReport 모델을 GitHub comment나 stdout에 붙일 Markdown 문자열로 변환
export function format(report: MergeRiskReport): string {
  const lines = [
    "## Merge Risk Report",
    "",
    `- base branch: ${code(report.baseBranch)}`,
    `- watched branches: ${report.totalBranchCount.toString()}`
  ]

  if (report.sections.length === 0) {
    lines.push("", "감시 대상 branch 없음")
    return lines.join("\n")
  }

  for (const section of report.sections) {
    lines.push("", `### ${section.title}`)

    for (const item of section.items) {
      lines.push(...linesForItem(item))
    }
  }

  return lines.join("\n")
}

// branch 하나의 score, metadata, reason을 Markdown block으로 구성
function linesForItem(item: MergeRiskReportItem): string[] {
  return [
    "",
    `#### ${code(item.branchName)}`,
    `- score/status: ${code(item.score.toString())} / ${code(item.status)}`,
    ...metadataLinesFor(item),
    "- reasons:",
    ...item.reasons.flatMap(reason => linesForReason(reason))
  ]
}

// optional branch metadata가 있을 때만 report line으로 표시
function metadataLinesFor(item: MergeRiskReportItem): string[] {
  const lines: string[] = []

  if (item.author) {
    lines.push(`- author: ${code(item.author)}`)
  }

  if (item.updatedAt) {
    lines.push(`- updated: ${code(item.updatedAt.toISOString())}`)
  }

  if (item.pullRequest) {
    lines.push(`- pull request: [#${item.pullRequest.number} ${item.pullRequest.title}](${item.pullRequest.url})`)
  }

  return lines
}

// deterministic reason의 code, score 영향, 관련 metadata를 Markdown bullet로 구성
function linesForReason(reason: BranchRiskReason): string[] {
  const lines = [
    `  - ${code(reason.code)} (+${reason.scoreImpact.toString()}): ${reason.message}`
  ]

  if (reason.files?.length) {
    lines.push(`    - files: ${reason.files.map(code).join(", ")}`)
  }

  if (reason.branches?.length) {
    lines.push(`    - branches: ${reason.branches.map(code).join(", ")}`)
  }

  if (reason.checks?.length) {
    lines.push(`    - checks: ${reason.checks.map(code).join(", ")}`)
  }

  return lines
}

// Markdown inline code 안에서 backtick이 문법을 깨지 않도록 escape
function code(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``
}
