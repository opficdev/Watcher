import test from "node:test"
import assert from "node:assert/strict"
import {
  BranchRiskStatus,
  formatMergeRiskReportMarkdown,
  type MergeRiskReport
} from "../../src/index.js"

// report 기본 요약과 status section이 Markdown으로 변환되는지 확인
test("formats merge risk report summary and sections", () => {
  const markdown = formatMergeRiskReportMarkdown(report())

  assert.match(markdown, /## Merge Risk Report/)
  assert.match(markdown, /- base branch: `main`/)
  assert.match(markdown, /- watched branches: 1/)
  assert.match(markdown, /### High/)
  assert.match(markdown, /#### `feature\/risk`/)
  assert.match(markdown, /- score\/status: `65` \/ `high`/)
})

// branch metadata와 Pull Request link가 Markdown item에 포함되는지 확인
test("formats branch metadata and pull request link", () => {
  const markdown = formatMergeRiskReportMarkdown(report())

  assert.match(markdown, /- author: `opfic`/)
  assert.match(markdown, /- updated: `2026-06-22T01:00:00.000Z`/)
  assert.match(
    markdown,
    /- pull request: \[#12 Report item\]\(https:\/\/github.com\/opficdev\/Watcher\/pull\/12\)/
  )
})

// deterministic reason의 관련 파일, branch, check metadata가 표시되는지 확인
test("formats deterministic reason metadata", () => {
  const markdown = formatMergeRiskReportMarkdown(report())

  assert.match(markdown, /- `same_hunk_overlap` \(\+35\): 다른 branch와 같은 hunk를 수정함/)
  assert.match(markdown, /- files: `src\/shared.ts`/)
  assert.match(markdown, /- branches: `feature\/other`/)
  assert.match(markdown, /- checks: `build`/)
})

// section이 없으면 감시 대상 branch 없음 상태를 표시하는지 확인
test("formats empty report", () => {
  const markdown = formatMergeRiskReportMarkdown({
    baseBranch: "main",
    generatedAt: new Date("2026-06-22T00:00:00.000Z"),
    sections: [],
    totalBranchCount: 0
  })

  assert.match(markdown, /- watched branches: 0/)
  assert.match(markdown, /감시 대상 branch 없음/)
})

function report(): MergeRiskReport {
  return {
    baseBranch: "main",
    generatedAt: new Date("2026-06-22T00:00:00.000Z"),
    totalBranchCount: 1,
    sections: [{
      status: BranchRiskStatus.High,
      title: "High",
      items: [{
        branchName: "feature/risk",
        baseBranch: "main",
        score: 65,
        status: BranchRiskStatus.High,
        author: "opfic",
        updatedAt: new Date("2026-06-22T01:00:00.000Z"),
        pullRequest: {
          number: 12,
          title: "Report item",
          url: "https://github.com/opficdev/Watcher/pull/12",
          author: "opfic"
        },
        branch: {
          baseBranch: "main",
          name: "feature/risk",
          headSha: "feature-risk-sha",
          checks: []
        },
        reasons: [{
          code: "same_hunk_overlap",
          message: "다른 branch와 같은 hunk를 수정함",
          scoreImpact: 35,
          files: ["src/shared.ts"],
          branches: ["feature/other"],
          checks: ["build"]
        }]
      }]
    }]
  }
}
