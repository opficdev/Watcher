import test from "node:test"
import assert from "node:assert/strict"
import {
  BranchRiskStatus,
  formatMergeRiskReportMarkdown,
  type AiPredictionResult,
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

// branch metadata는 유지하되 Pull Request metadata는 Markdown item에서 제외되는지 확인
test("formats branch metadata without pull request link", () => {
  const markdown = formatMergeRiskReportMarkdown(report())

  assert.match(markdown, /- author: `opfic`/)
  assert.match(markdown, /- updated: `2026-06-22T01:00:00.000Z`/)
  assert.doesNotMatch(markdown, /pull request/)
  assert.doesNotMatch(markdown, /github\.com\/opficdev\/Watcher\/pull\/12/)
})

// deterministic reason의 관련 파일, branch, check metadata가 표시되는지 확인
test("formats deterministic reason metadata", () => {
  const markdown = formatMergeRiskReportMarkdown(report())

  assert.match(markdown, /- `same_hunk_overlap` \(\+35\): 다른 branch와 같은 hunk를 수정함/)
  assert.match(markdown, /- files: `src\/shared.ts`/)
  assert.match(markdown, /- branches: `feature\/other`/)
  assert.match(markdown, /- checks: `build`/)
})

// inline code 내부 backtick이 Markdown code span 문법을 깨지 않도록 delimiter를 늘리는지 확인
test("formats inline code containing backticks", () => {
  const markdown = formatMergeRiskReportMarkdown(report(undefined, {
    branchName: "feature/`risk`",
    reasonFile: "src/`shared`.ts"
  }))

  assert.match(markdown, /#### `` feature\/`risk` ``/)
  assert.match(markdown, /- files: `` src\/`shared`\.ts ``/)
})

// AI predicted 결과를 deterministic reason과 분리해 표시하는지 확인
test("formats predicted AI result", () => {
  const markdown = formatMergeRiskReportMarkdown(report(predictedAiResult("feature/risk")))

  assert.match(markdown, /- ai prediction:/)
  assert.match(markdown, /- prediction: 공유 파일 변경 의도가 겹칠 가능성 있음/)
  assert.match(markdown, /- confidence: `82`/)
  assert.match(markdown, /- recommended actions:/)
  assert.match(markdown, /- `high` base branch rebase: 최신 main 기준으로 rebase 후 실제 충돌 여부 확인/)
  assert.match(markdown, /- files: `src\/shared.ts`/)
  assert.match(markdown, /- false positive notes:/)
  assert.match(markdown, /- 파일은 같지만 line range가 다르면 false positive 가능성 있음/)
})

// AI skipped 결과를 report에 표시하는지 확인
test("formats skipped AI result", () => {
  const markdown = formatMergeRiskReportMarkdown(report({
    status: "skipped",
    branchName: "feature/risk",
    baseBranch: "main",
    reason: "not_target"
  }))

  assert.match(markdown, /- ai prediction:/)
  assert.match(markdown, /- status: `skipped`/)
  assert.match(markdown, /- reason: `not_target`/)
})

// AI failed 결과를 deterministic report 유지 상태로 표시하는지 확인
test("formats failed AI result", () => {
  const markdown = formatMergeRiskReportMarkdown(report({
    status: "failed",
    branchName: "feature/risk",
    baseBranch: "main",
    errorMessage: "Gemini request failed"
  }))

  assert.match(markdown, /- ai prediction:/)
  assert.match(markdown, /- status: `failed`/)
  assert.match(markdown, /- error: Gemini request failed/)
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

function report(
  aiPrediction?: AiPredictionResult,
  options: {
    branchName?: string
    reasonFile?: string
  } = {}
): MergeRiskReport {
  const branchName = options.branchName ?? "feature/risk"

  return {
    baseBranch: "main",
    generatedAt: new Date("2026-06-22T00:00:00.000Z"),
    totalBranchCount: 1,
    sections: [{
      status: BranchRiskStatus.High,
      title: "High",
      items: [{
        branchName,
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
          name: branchName,
          headSha: "feature-risk-sha",
          checks: []
        },
        reasons: [{
          code: "same_hunk_overlap",
          message: "다른 branch와 같은 hunk를 수정함",
          scoreImpact: 35,
          files: [options.reasonFile ?? "src/shared.ts"],
          branches: ["feature/other"],
          checks: ["build"]
        }],
        aiPrediction
      }]
    }]
  }
}

function predictedAiResult(branchName: string): AiPredictionResult {
  return {
    status: "predicted",
    branchName,
    baseBranch: "main",
    prediction: {
      branchName,
      baseBranch: "main",
      prediction: "공유 파일 변경 의도가 겹칠 가능성 있음",
      confidence: 82,
      recommendedActions: [{
        title: "base branch rebase",
        description: "최신 main 기준으로 rebase 후 실제 충돌 여부 확인",
        priority: "high",
        files: ["src/shared.ts"]
      }],
      falsePositiveNotes: ["파일은 같지만 line range가 다르면 false positive 가능성 있음"]
    }
  }
}
