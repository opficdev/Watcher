import test from "node:test"
import assert from "node:assert/strict"
import { buildEdges } from "../../src/risks/conflictGraphBuilder.js"
import type { BranchComparisonPair } from "../../src/branches/types.js"
import type {
  GitMergeCodeContextPairResult,
  GitMergeTreePairResult,
  MergeCodeContextEvidence
} from "../../src/git/types.js"

test("normalizes branch pairs, removes duplicates, and ignores unrelated results", () => {
  const pair = branchPair("feature/z", "feature/a")
  const edges = buildEdges([
    pair,
    branchPair("feature/a", "feature/z")
  ], [
    mergeResult(pair, "confirmed_conflict", ["src/z.ts", "src/a.ts"]),
    mergeResult(branchPair("feature/unused", "main"), "clean")
  ], [])

  assert.deepEqual(edges, [{
    pair: branchPair("feature/a", "feature/z"),
    status: "confirmed_conflict",
    reasons: [{
      code: "confirmed_conflict",
      files: ["src/a.ts", "src/z.ts"]
    }]
  }])
})

test("classifies same hunk and file overlap as potential overlap", () => {
  const pair = branchPair("feature/a", "feature/b")
  const edges = buildEdges(
    [pair],
    [mergeResult(pair, "clean")],
    [codeContextResult(pair, ["src/shared.ts"], ["src/shared.ts"])]
  )

  assert.deepEqual(edges, [{
    pair,
    status: "potential_overlap",
    reasons: [{
      code: "same_hunk_overlap",
      files: ["src/shared.ts"]
    }, {
      code: "same_file_overlap",
      files: ["src/shared.ts"]
    }]
  }])
})

test("classifies same file without hunk overlap as potential overlap", () => {
  const pair = branchPair("feature/a", "feature/b")
  const [edge] = buildEdges(
    [pair],
    [mergeResult(pair, "clean")],
    [codeContextResult(pair, ["src/shared.ts"])]
  )

  assert.equal(edge?.status, "potential_overlap")
  assert.deepEqual(edge?.reasons, [{
    code: "same_file_overlap",
    files: ["src/shared.ts"]
  }])
})

test("classifies a clean merge without overlap as clean", () => {
  const pair = branchPair("feature/a", "feature/b")
  const [edge] = buildEdges(
    [pair],
    [mergeResult(pair, "clean")],
    [codeContextResult(pair)]
  )

  assert.deepEqual(edge, {
    pair,
    status: "clean",
    reasons: [{ code: "clean_merge" }]
  })
})

test("keeps confirmed conflict above code context failure", () => {
  const pair = branchPair("feature/a", "feature/b")
  const [edge] = buildEdges(
    [pair],
    [mergeResult(pair, "confirmed_conflict", ["src/shared.ts"])],
    [codeContextResult(pair, [], [], "context failed")]
  )

  assert.equal(edge?.status, "confirmed_conflict")
  assert.equal(edge?.errorMessage, undefined)
})

test("classifies failed or missing evidence as error", () => {
  const failedPair = branchPair("feature/a", "feature/b")
  const missingContextPair = branchPair("feature/a", "main")
  const contextFailurePair = branchPair("feature/b", "main")
  const missingMergePair = branchPair("feature/c", "main")
  const edges = buildEdges([
    contextFailurePair,
    missingMergePair,
    failedPair,
    missingContextPair
  ], [
    mergeResult(failedPair, "merge_check_failed", [], "merge failed"),
    mergeResult(missingContextPair, "clean"),
    mergeResult(contextFailurePair, "clean")
  ], [
    codeContextResult(contextFailurePair, [], [], "context failed")
  ])

  assert.deepEqual(edges.map(edge => ({
    pair: edge.pair,
    status: edge.status,
    code: edge.reasons[0]?.code,
    errorMessage: edge.errorMessage
  })), [{
    pair: failedPair,
    status: "error",
    code: "merge_check_failed",
    errorMessage: "merge failed"
  }, {
    pair: missingContextPair,
    status: "error",
    code: "code_context_failed",
    errorMessage: "code context result is missing for branch pair"
  }, {
    pair: contextFailurePair,
    status: "error",
    code: "code_context_failed",
    errorMessage: "context failed"
  }, {
    pair: missingMergePair,
    status: "error",
    code: "merge_check_failed",
    errorMessage: "merge-tree result is missing for branch pair"
  }])
})

function branchPair(
  leftBranchName: string,
  rightBranchName: string
): BranchComparisonPair {
  return {
    leftBranchName,
    rightBranchName
  }
}

function mergeResult(
  pair: BranchComparisonPair,
  status: GitMergeTreePairResult["status"],
  conflictFiles: string[] = [],
  errorMessage?: string
): GitMergeTreePairResult {
  return {
    pair,
    status,
    conflictFiles,
    conflicts: [],
    ...(errorMessage ? { errorMessage } : {})
  }
}

function codeContextResult(
  pair: BranchComparisonPair,
  overlapFiles: string[] = [],
  hunkFiles: string[] = [],
  errorMessage?: string
): GitMergeCodeContextPairResult {
  return {
    pair,
    overlapFiles,
    evidence: hunkFiles.map(filePath => codeContextEvidence(pair, filePath)),
    ...(errorMessage ? { errorMessage } : {})
  }
}

function codeContextEvidence(
  pair: BranchComparisonPair,
  filePath: string
): MergeCodeContextEvidence {
  const snippet = {
    status: "text" as const,
    filePath,
    content: "content",
    startLine: 1,
    endLine: 1,
    truncated: false
  }
  const commit = {
    oid: "a".repeat(40),
    author: "opfic <opfic@example.com>",
    committedAt: "2026-07-16T00:00:00Z",
    subject: "subject"
  }

  return {
    pair,
    kind: "clean_hunk_overlap",
    filePath,
    mergeBaseOid: "b".repeat(40),
    mergedTreeOid: "c".repeat(40),
    baseCommit: { ...commit, role: "base" },
    leftCommit: { ...commit, role: "left", branchName: pair.leftBranchName },
    rightCommit: { ...commit, role: "right", branchName: pair.rightBranchName },
    baseSnippet: snippet,
    leftSnippet: snippet,
    rightSnippet: snippet,
    mergedSnippet: snippet
  }
}
