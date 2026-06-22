import test from "node:test"
import assert from "node:assert/strict"
import {
  BranchRiskStatus,
  buildMergeRiskReport,
  type BranchContext,
  type BranchRisk,
  type BranchRiskReasonCode,
  type BranchRiskStatus as BranchRiskStatusType,
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

function input(
  branchName: string,
  status: BranchRiskStatusType,
  score: number,
  metadata: Partial<BranchContext> = {}
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
    }
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
