import test from "node:test"
import assert from "node:assert/strict"
import {
  BranchRiskStatus,
  buildMergeRiskReport,
  type BranchContext,
  type BranchRisk,
  type BranchRiskReasonCode,
  type BranchRiskStatus as BranchRiskStatusType,
  type AiPredictionResult,
  type MergeRiskReportInput
} from "../../src/index.js"

// risk status 우선순서대로 section을 구성하는지 확인
test("groups report sections by risk status order", () => {
  const report = buildMergeRiskReport([
    input("feature/low", BranchRiskStatus.Low, 0),
    input("feature/critical", BranchRiskStatus.Critical, 100),
    input("feature/medium", BranchRiskStatus.Medium, 25),
    input("feature/high", BranchRiskStatus.High, 50)
  ], "main", {
    generatedAt: new Date("2026-06-22T00:00:00.000Z")
  })

  assert.equal(report.baseBranch, "main")
  assert.equal(report.totalBranchCount, 4)
  assert.deepEqual(report.sections.map(section => section.status), [
    BranchRiskStatus.Critical,
    BranchRiskStatus.High,
    BranchRiskStatus.Medium,
    BranchRiskStatus.Low
  ])
})

// 같은 section 내부 branch를 score 내림차순과 branch 이름 오름차순으로 정렬하는지 확인
test("sorts report items by score and branch name", () => {
  const report = buildMergeRiskReport([
    input("feature/b", BranchRiskStatus.High, 70),
    input("feature/c", BranchRiskStatus.High, 90),
    input("feature/a", BranchRiskStatus.High, 70)
  ], "main")

  assert.deepEqual(report.sections[0]?.items.map(item => item.branchName), [
    "feature/c",
    "feature/a",
    "feature/b"
  ])
})

// 같은 score의 branch 이름은 locale 영향을 받지 않는 문자열 비교 순서로 정렬하는지 확인
test("sorts tied report items with deterministic string order", () => {
  const report = buildMergeRiskReport([
    input("feature/ä", BranchRiskStatus.High, 70),
    input("feature/z", BranchRiskStatus.High, 70)
  ], "main")

  assert.deepEqual(report.sections[0]?.items.map(item => item.branchName), [
    "feature/z",
    "feature/ä"
  ])
})

// 비어 있는 status section은 report에서 제외되는지 확인
test("omits empty report sections", () => {
  const report = buildMergeRiskReport([
    input("feature/medium", BranchRiskStatus.Medium, 25)
  ], "main")

  assert.deepEqual(report.sections.map(section => section.status), [BranchRiskStatus.Medium])
})

// section title을 옵션으로 대체할 수 있는지 확인
test("uses custom section titles", () => {
  const report = buildMergeRiskReport([
    input("feature/critical", BranchRiskStatus.Critical, 100)
  ], "main", {
    sectionTitles: {
      [BranchRiskStatus.Critical]: "충돌 확인"
    }
  })

  assert.equal(report.sections[0]?.title, "충돌 확인")
})

// branch author와 updatedAt metadata를 report item에 보존하는지 확인
test("keeps branch author and updated time metadata", () => {
  const updatedAt = new Date("2026-06-22T01:00:00.000Z")
  const report = buildMergeRiskReport([
    input("feature/metadata", BranchRiskStatus.Medium, 25, {
      author: "opfic",
      updatedAt
    })
  ], "main")

  const item = report.sections[0]?.items[0]
  assert.equal(item?.author, "opfic")
  assert.equal(item?.updatedAt, updatedAt)
})

// 연결된 Pull Request metadata가 없어도 report item 생성이 가능한지 확인
test("keeps pull request metadata optional", () => {
  const report = buildMergeRiskReport([
    input("feature/no-pr", BranchRiskStatus.Low, 0)
  ], "main")

  assert.equal(report.sections[0]?.items[0]?.pullRequest, undefined)
})

// 연결된 Pull Request metadata를 report item에 보존하는지 확인
test("keeps pull request metadata when present", () => {
  const report = buildMergeRiskReport([
    input("feature/pr", BranchRiskStatus.High, 50, {
      pullRequest: {
        number: 12,
        title: "Report item",
        url: "https://github.com/opficdev/Watcher/pull/12",
        author: "opfic"
      }
    })
  ], "main")

  assert.deepEqual(report.sections[0]?.items[0]?.pullRequest, {
    number: 12,
    title: "Report item",
    url: "https://github.com/opficdev/Watcher/pull/12",
    author: "opfic"
  })
})

// AI predicted 결과를 report item에 보존하는지 확인
test("keeps predicted AI result when present", () => {
  const prediction = predictedAiResult("feature/ai")
  const report = buildMergeRiskReport([
    input("feature/ai", BranchRiskStatus.High, 70, {}, prediction)
  ], "main")

  assert.deepEqual(report.sections[0]?.items[0]?.aiPrediction, prediction)
})

// AI skipped 결과를 deterministic report와 분리해 보존하는지 확인
test("keeps skipped AI result when present", () => {
  const prediction: AiPredictionResult = {
    status: "skipped",
    branchName: "feature/skipped",
    baseBranch: "main",
    reason: "below_threshold"
  }
  const report = buildMergeRiskReport([
    input("feature/skipped", BranchRiskStatus.Low, 0, {}, prediction)
  ], "main")

  assert.deepEqual(report.sections[0]?.items[0]?.aiPrediction, prediction)
})

// AI failed 결과를 deterministic report와 분리해 보존하는지 확인
test("keeps failed AI result when present", () => {
  const prediction: AiPredictionResult = {
    status: "failed",
    branchName: "feature/failed",
    baseBranch: "main",
    errorMessage: "Gemini request failed"
  }
  const report = buildMergeRiskReport([
    input("feature/failed", BranchRiskStatus.Medium, 25, {}, prediction)
  ], "main")

  assert.deepEqual(report.sections[0]?.items[0]?.aiPrediction, prediction)
})

function input(
  branchName: string,
  status: BranchRiskStatusType,
  score: number,
  metadata: Partial<BranchContext> = {},
  aiPrediction?: AiPredictionResult
): MergeRiskReportInput {
  const context = branch(branchName, metadata)

  return {
    branch: context,
    risk: {
      branchName,
      baseBranch: context.baseBranch,
      score,
      status,
      reasons: [reason("clean_merge")]
    },
    aiPrediction
  }
}

function branch(
  name: string,
  metadata: Partial<BranchContext> = {}
): BranchContext {
  return {
    baseBranch: "main",
    name,
    headSha: `${name}-sha`,
    checks: [],
    ...metadata
  }
}

function reason(code: BranchRiskReasonCode): BranchRisk["reasons"][number] {
  return {
    code,
    message: code,
    scoreImpact: 0
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
