import test from "node:test"
import assert from "node:assert/strict"
import {
  formatBranchPairMergeRiskReportMarkdown,
  type AiConfirmedConflictResponse,
  type AiCleanOverlapResponse,
  type BranchComparisonPair,
  type BranchPairMergeRiskReport,
  type BranchPairMergeRiskReportPairItem
} from "../../src/index.js"
import {
  splitDiscordMessages
} from "../../src/reportChannels/discordMessageSplitter.js"

// 활성 기간과 branch 및 조합 수를 Summary에 표시
test("formats branch pair report summary", () => {
  const markdown = formatBranchPairMergeRiskReportMarkdown(report())

  assert.match(markdown, /## Merge Risk Report/)
  assert.match(markdown, /### Summary/)
  assert.match(
    markdown,
    /- active period: `2026-07-03T00:00:00\.000Z` - `2026-07-17T00:00:00\.000Z` \(`14 days`\)/
  )
  assert.match(markdown, /- base branch: `main`/)
  assert.match(markdown, /- discovered branches: 8/)
  assert.match(markdown, /- watched branches: 3/)
  assert.match(markdown, /- compared pairs: 6/)
  assert.match(markdown, /- clean pairs: 1/)
  assert.doesNotMatch(markdown, /clean_merge/)
})

// 확정 conflict의 commit, 원인, conflict type과 Suggested Patch를 표시
test("formats confirmed conflict details and suggested patch", () => {
  const markdown = formatBranchPairMergeRiskReportMarkdown(report())

  assert.match(markdown, /### Confirmed Conflicts/)
  assert.match(markdown, /#### `feature\/a` ↔ `main`/)
  assert.match(markdown, /- status: `confirmed_conflict`/)
  assert.match(markdown, /- `feature\/a`: `feature-a-oid`/)
  assert.match(markdown, /- `main`: `main-oid`/)
  assert.match(markdown, /- `confirmed_conflict`/)
  assert.match(markdown, /- files: `src\/a\.ts`/)
  assert.match(markdown, /- `content`: `src\/a\.ts`/)
  assert.match(markdown, /- AI Analysis:/)
  assert.match(markdown, /- cause: 같은 조건을 다르게 수정함/)
  assert.match(markdown, /- Recommended Resolution:/)
  assert.match(markdown, /- strategy: `rebase`/)
  assert.match(markdown, /- order: `feature\/a` → `main`/)
  assert.match(markdown, /- Suggested Patch:/)
  assert.match(markdown, /- `src\/a\.ts`: 두 변경 의도를 보존함/)
  assert.match(markdown, /```diff\n\s*@@ -1 \+1 @@\n\s*-old\n\s*\+new\n\s*```/)
  assert.equal(markdown.match(/#### `feature\/a` ↔ `main`/g)?.length, 1)
})

// formatter의 실제 Markdown 구조를 Discord message splitter가 같은 계약으로 해석하는지 확인
test("formats report compatible with discord message splitting", () => {
  const value = report()
  const analysis = value.confirmedConflicts[0]?.aiAnalysis

  if (analysis?.status !== "predicted" || analysis.response.kind !== "confirmed_conflict") {
    assert.fail("Expected predicted confirmed conflict analysis")
  }

  analysis.response.patches = [{
    ...analysis.response.patches[0]!,
    patch: Array.from({ length: 300 }, (_, index) =>
      `+const value${index.toString()} = "${"x".repeat(24)}"`
    ).join("\n")
  }]

  const markdown = formatBranchPairMergeRiskReportMarkdown(value)
  const messages = splitDiscordMessages(markdown)
  const pairLabel = "`feature/a` ↔ `main`"
  const pairMessages = messages.filter(message => message.pairLabel === pairLabel)
  const patchMessages = pairMessages.filter(message =>
    message.content.includes("- Suggested Patch (")
  )

  assert.match(messages[0]?.content ?? "", /### Summary/)
  assert.equal(
    pairMessages.some(message =>
      message.content.startsWith(`#### ${pairLabel}\n- AI Analysis:`)
    ),
    true
  )
  assert.equal(
    pairMessages.some(message =>
      message.content.startsWith(`#### ${pairLabel}\n- Recommended Resolution:`)
    ),
    true
  )
  assert.equal(1 < patchMessages.length, true)
  assert.equal(patchMessages.every(message => message.content.endsWith("    ```")), true)
  assert.deepEqual(
    pairMessages.map(message => message.fragmentNumber),
    pairMessages.map((_, index) => index + 1)
  )
  assert.equal(messages.every(message => message.content.length <= 2000), true)
})

// 잠재 위험의 AI 해결 순서와 예방 조치를 표시
test("formats potential risk analysis and preventive actions", () => {
  const markdown = formatBranchPairMergeRiskReportMarkdown(report())

  assert.match(markdown, /### Potential Risks/)
  assert.match(markdown, /#### `feature\/a` ↔ `feature\/b`/)
  assert.match(markdown, /- status: `potential_overlap`/)
  assert.match(markdown, /- cause: 같은 파일의 인접 코드를 수정함/)
  assert.match(markdown, /- strategy: `merge`/)
  assert.match(markdown, /- Preventive Actions:/)
  assert.match(markdown, /- 통합 동작 확인: 두 변경이 함께 동작하는지 확인함/)
})

// AI skipped와 failed 상태에서도 deterministic 위험 상세를 유지
test("formats skipped and failed AI analysis", () => {
  const markdown = formatBranchPairMergeRiskReportMarkdown(report())

  assert.match(
    markdown,
    /#### `feature\/b` ↔ `feature\/c`[\s\S]*?- status: `skipped`[\s\S]*?- reason: `not_target`/
  )
  assert.match(
    markdown,
    /#### `feature\/c` ↔ `main`[\s\S]*?- status: `failed`[\s\S]*?- error: provider failed/
  )
  assert.match(markdown, /- `same_file_overlap`/)
})

// 감시 branch별 확정 conflict와 잠재 위험 관계를 개수와 함께 집계
test("formats watched branch impacts without a base branch row", () => {
  const markdown = formatBranchPairMergeRiskReportMarkdown(report())

  assert.match(markdown, /### Branch Impact/)
  assert.match(
    markdown,
    /- `feature\/a`[\s\S]*?- confirmed \(1\): `feature\/a` ↔ `main`[\s\S]*?- potential \(1\): `feature\/a` ↔ `feature\/b`/
  )
  assert.match(
    markdown,
    /- `feature\/b`[\s\S]*?- confirmed \(0\): 없음[\s\S]*?- potential \(2\): `feature\/a` ↔ `feature\/b`, `feature\/b` ↔ `feature\/c`/
  )
  assert.doesNotMatch(markdown, /^- `main`$/m)
})

// 제외 branch와 merge error를 별도 section에 표시
test("formats excluded branches and merge errors", () => {
  const markdown = formatBranchPairMergeRiskReportMarkdown(report())

  assert.match(markdown, /### Excluded Branches/)
  assert.match(markdown, /- `feature\/old`: `stale_branch`/)
  assert.match(markdown, /- `feature\/overflow`: `branch_limit`/)
  assert.match(markdown, /### Merge Errors/)
  assert.match(markdown, /- `feature\/b` ↔ `main`/)
  assert.match(markdown, /- reasons: `merge_check_failed`/)
  assert.match(markdown, /- error: merge-tree failed/)
})

// 값이 없는 section을 명시하고 inline code와 patch fence를 안전하게 구성
test("formats empty sections and embedded backticks", () => {
  const value = report()
  value.confirmedConflicts = [{
    ...value.confirmedConflicts[0]!,
    pair: pair("feature/`a`", "main"),
    aiAnalysis: {
      status: "predicted",
      response: {
        ...confirmedResponse(pair("feature/`a`", "main")),
        patches: [{
          filePath: "src/`a`.ts",
          patch: "```diff\n-old\n+new\n```",
          reason: "fence 확인"
        }]
      }
    }
  }]
  value.potentialRisks = []
  value.branchImpacts = []
  value.excludedBranches = []
  value.mergeErrors = []

  const markdown = formatBranchPairMergeRiskReportMarkdown(value)

  assert.match(markdown, /#### `` feature\/`a` `` ↔ `main`/)
  assert.match(markdown, /- `` src\/`a`\.ts ``: fence 확인/)
  assert.match(markdown, /````diff\n\s*```diff\n\s*-old\n\s*\+new\n\s*```\n\s*````/)
  assert.match(markdown, /### Potential Risks\n\n없음/)
  assert.match(markdown, /### Branch Impact\n\n없음/)
  assert.match(markdown, /### Excluded Branches\n\n없음/)
  assert.match(markdown, /### Merge Errors\n\n없음/)
})

function report(): BranchPairMergeRiskReport {
  const confirmedPair = pair("feature/a", "main")
  const predictedPair = pair("feature/a", "feature/b")

  return {
    baseBranch: "main",
    generatedAt: new Date("2026-07-17T00:00:00.000Z"),
    activePeriod: {
      dayCount: 14,
      since: new Date("2026-07-03T00:00:00.000Z"),
      until: new Date("2026-07-17T00:00:00.000Z")
    },
    discoveredBranchCount: 8,
    watchedBranchCount: 3,
    comparisonPairCount: 6,
    confirmedConflicts: [item(
      confirmedPair,
      "confirmed_conflict",
      "confirmed_conflict",
      "src/a.ts",
      {
        status: "predicted",
        response: confirmedResponse(confirmedPair)
      },
      [{ paths: ["src/a.ts"], type: "content" }]
    )],
    potentialRisks: [item(
      predictedPair,
      "potential_overlap",
      "same_hunk_overlap",
      "src/b.ts",
      {
        status: "predicted",
        response: cleanOverlapResponse(predictedPair)
      }
    ), item(
      pair("feature/b", "feature/c"),
      "potential_overlap",
      "same_file_overlap",
      "src/c.ts",
      {
        status: "skipped",
        reason: "not_target"
      }
    ), item(
      pair("feature/c", "main"),
      "potential_overlap",
      "same_file_overlap",
      "src/d.ts",
      {
        status: "failed",
        errorMessage: "provider failed"
      }
    )],
    branchImpacts: [{
      branchName: "feature/a",
      confirmedConflictPairs: [confirmedPair],
      potentialRiskPairs: [predictedPair]
    }, {
      branchName: "feature/b",
      confirmedConflictPairs: [],
      potentialRiskPairs: [
        predictedPair,
        pair("feature/b", "feature/c")
      ]
    }, {
      branchName: "feature/c",
      confirmedConflictPairs: [],
      potentialRiskPairs: [
        pair("feature/b", "feature/c"),
        pair("feature/c", "main")
      ]
    }],
    cleanPairCount: 1,
    excludedBranches: [{
      name: "feature/old",
      reason: "stale_branch"
    }, {
      name: "feature/overflow",
      reason: "branch_limit"
    }],
    mergeErrors: [{
      pair: pair("feature/b", "main"),
      reasons: [{ code: "merge_check_failed" }],
      errorMessage: "merge-tree failed"
    }]
  }
}

function item(
  branchPair: BranchComparisonPair,
  status: BranchPairMergeRiskReportPairItem["status"],
  reasonCode: BranchPairMergeRiskReportPairItem["reasons"][number]["code"],
  filePath: string,
  aiAnalysis: BranchPairMergeRiskReportPairItem["aiAnalysis"],
  conflicts: BranchPairMergeRiskReportPairItem["conflicts"] = []
): BranchPairMergeRiskReportPairItem {
  return {
    pair: branchPair,
    status,
    reasons: [{ code: reasonCode, files: [filePath] }],
    conflicts,
    leftCommitOid: `${branchPair.leftBranchName.replace("feature/", "feature-")}-oid`,
    rightCommitOid: `${branchPair.rightBranchName.replace("feature/", "feature-")}-oid`,
    aiAnalysis
  }
}

function pair(
  leftBranchName: string,
  rightBranchName: string
): BranchComparisonPair {
  return {
    leftBranchName,
    rightBranchName
  }
}

function confirmedResponse(
  branchPair: BranchComparisonPair
): AiConfirmedConflictResponse {
  return {
    kind: "confirmed_conflict",
    pair: branchPair,
    conflictCause: {
      summary: "같은 조건을 다르게 수정함",
      files: ["src/a.ts"]
    },
    integrationOrder: {
      strategy: "rebase",
      firstBranchName: branchPair.leftBranchName,
      secondBranchName: branchPair.rightBranchName,
      reason: "첫 변경을 기준으로 정리함",
      steps: ["첫 branch 반영", "두 번째 branch rebase"]
    },
    patches: [{
      filePath: "src/a.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      reason: "두 변경 의도를 보존함"
    }]
  }
}

function cleanOverlapResponse(
  branchPair: BranchComparisonPair
): AiCleanOverlapResponse {
  return {
    kind: "clean_overlap",
    pair: branchPair,
    overlapCause: {
      summary: "같은 파일의 인접 코드를 수정함",
      files: ["src/b.ts"]
    },
    integrationOrder: {
      strategy: "merge",
      firstBranchName: branchPair.leftBranchName,
      secondBranchName: branchPair.rightBranchName,
      reason: "현재 순서로 통합 가능함",
      steps: ["첫 branch merge", "두 번째 branch merge"]
    },
    preventiveActions: [{
      title: "통합 동작 확인",
      description: "두 변경이 함께 동작하는지 확인함",
      files: ["src/b.ts"]
    }]
  }
}
