import test from "node:test"
import assert from "node:assert/strict"
import {
  analyzeBranchMergeRisks,
  type BranchContext,
  type BranchRiskAnalysisInput,
  type GitMergeSignal
} from "../../src/index.js"

// confirmed conflict signal이 최상위 risk로 반영되는지 확인
test("marks confirmed conflict as critical risk", () => {
  const [risk] = analyzeBranchMergeRisks([
    input("feature/conflict", {
      status: "confirmed_conflict",
      changedFiles: ["shared.ts"],
      conflictFiles: ["shared.ts"]
    })
  ])

  assert.equal(risk?.status, "critical")
  assert.equal(risk?.score, 100)
  assert.deepEqual(risk?.reasons.map(reason => reason.code), ["confirmed_conflict"])
  assert.deepEqual(risk?.reasons[0]?.files, ["shared.ts"])
})

// 여러 branch가 같은 파일을 수정하면 same file overlap risk가 생성되는지 확인
test("adds same file overlap risk", () => {
  const risks = analyzeBranchMergeRisks([
    input("feature/a", {
      status: "clean",
      changedFiles: ["src/shared.ts"],
      conflictFiles: []
    }),
    input("feature/b", {
      status: "clean",
      changedFiles: ["src/shared.ts"],
      conflictFiles: []
    })
  ])

  assert.deepEqual(reasonCodes(risks[0]), ["same_file_overlap"])
  assert.equal(risks[0]?.score, 20)
  assert.deepEqual(risks[0]?.reasons[0]?.files, ["src/shared.ts"])
  assert.deepEqual(risks[0]?.reasons[0]?.branches, ["feature/b"])
})

// 여러 branch가 같은 파일의 겹치는 line range를 수정하면 same hunk overlap risk가 생성되는지 확인
test("adds same hunk overlap risk", () => {
  const risks = analyzeBranchMergeRisks([
    input("feature/a", {
      status: "clean",
      changedFiles: ["src/shared.ts"],
      conflictFiles: []
    }, [{ filePath: "src/shared.ts", startLine: 10, endLine: 20 }]),
    input("feature/b", {
      status: "clean",
      changedFiles: ["src/shared.ts"],
      conflictFiles: []
    }, [{ filePath: "src/shared.ts", startLine: 18, endLine: 30 }])
  ])

  assert.deepEqual(reasonCodes(risks[0]), ["same_hunk_overlap", "same_file_overlap"])
  assert.equal(risks[0]?.score, 55)
  assert.deepEqual(risks[0]?.reasons[0]?.files, ["src/shared.ts"])
  assert.deepEqual(risks[0]?.reasons[0]?.branches, ["feature/b"])
})

// 같은 파일을 수정하더라도 line range가 겹치지 않으면 same hunk overlap으로 보지 않는지 확인
test("does not add same hunk risk for separated hunks", () => {
  const risks = analyzeBranchMergeRisks([
    input("feature/a", {
      status: "clean",
      changedFiles: ["src/shared.ts"],
      conflictFiles: []
    }, [{ filePath: "src/shared.ts", startLine: 10, endLine: 20 }]),
    input("feature/b", {
      status: "clean",
      changedFiles: ["src/shared.ts"],
      conflictFiles: []
    }, [{ filePath: "src/shared.ts", startLine: 21, endLine: 30 }])
  ])

  assert.deepEqual(reasonCodes(risks[0]), ["same_file_overlap"])
  assert.equal(risks[0]?.score, 20)
})

// 실패한 check metadata가 branch risk에 반영되는지 확인
test("adds failed check risk", () => {
  const [risk] = analyzeBranchMergeRisks([
    input("feature/check", {
      status: "clean",
      changedFiles: ["src/app.ts"],
      conflictFiles: []
    }, [], branch("feature/check", [{
      name: "CI",
      status: "completed",
      conclusion: "failure"
    }]))
  ])

  assert.deepEqual(reasonCodes(risk), ["failed_check"])
  assert.equal(risk?.score, 15)
  assert.deepEqual(risk?.reasons[0]?.checks, ["CI"])
})

// 설정으로 주입한 critical file pattern이 risk에 반영되는지 확인
test("adds critical file risk", () => {
  const [risk] = analyzeBranchMergeRisks([
    input("feature/package", {
      status: "clean",
      changedFiles: [".github/workflows/ci.yml", "package-lock.json", "src/app.ts"],
      conflictFiles: []
    })
  ], {
    criticalFilePatterns: ["package-lock.json", ".github/**"]
  })

  assert.deepEqual(reasonCodes(risk), ["critical_file_changed"])
  assert.equal(risk?.score, 15)
  assert.deepEqual(risk?.reasons[0]?.files, [".github/workflows/ci.yml", "package-lock.json"])
})

// merge check 실패가 중간 risk로 반영되고 이미 수집된 변경 파일과 결합되는지 확인
test("adds merge check failure risk", () => {
  const [risk] = analyzeBranchMergeRisks([
    input("feature/error", {
      status: "merge_check_failed",
      changedFiles: ["src/app.ts"],
      conflictFiles: [],
      errorMessage: "fetch failed"
    })
  ])

  assert.deepEqual(reasonCodes(risk), ["merge_check_failed"])
  assert.equal(risk?.status, "medium")
  assert.equal(risk?.score, 25)
})

// risk signal이 없으면 deterministic low risk reason을 생성하는지 확인
test("adds clean merge reason when no risk rules match", () => {
  const [risk] = analyzeBranchMergeRisks([
    input("feature/clean", {
      status: "clean",
      changedFiles: ["src/app.ts"],
      conflictFiles: []
    })
  ])

  assert.equal(risk?.status, "low")
  assert.equal(risk?.score, 0)
  assert.deepEqual(reasonCodes(risk), ["clean_merge"])
})

function input(
  name: string,
  signal: Pick<GitMergeSignal, "status" | "changedFiles" | "conflictFiles" | "errorMessage">,
  changedHunks: BranchRiskAnalysisInput["changedHunks"] = [],
  context: BranchContext = branch(name)
): BranchRiskAnalysisInput {
  return {
    branch: context,
    changedHunks,
    gitSignal: {
      baseBranch: context.baseBranch,
      branchName: name,
      ...signal
    }
  }
}

function branch(
  name: string,
  checks: BranchContext["checks"] = []
): BranchContext {
  return {
    baseBranch: "main",
    name,
    headSha: `${name}-sha`,
    checks
  }
}

function reasonCodes(
  risk: ReturnType<typeof analyzeBranchMergeRisks>[number] | undefined
): string[] {
  return risk?.reasons.map(reason => reason.code) ?? []
}
