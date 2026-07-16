import { readGitObjectSnippets } from "./gitObjectBatchReader.js"
import type { PairCodeContext } from "./gitCodeContextReader.js"
import type {
  GitMergeTreePairResult,
  GitObjectSnippetRequest,
  MergeCodeContextEvidence,
  MergeCodeContextKind,
  MergeCodeContextLineRange,
  MergeCodeContextSnippet
} from "./types.js"

export type PreparedCodeContextEvidence = {
  filePath: string
  baseRange: MergeCodeContextLineRange
  leftRange: MergeCodeContextLineRange
  rightRange: MergeCodeContextLineRange
  mergedRange: MergeCodeContextLineRange
  baseKey: string
  leftKey: string
  rightKey: string
  mergedKey: string
}

// 준비된 네 version 요청을 evidence model로 변환
export async function collectPreparedEvidence(
  mergeResult: GitMergeTreePairResult,
  kind: MergeCodeContextKind,
  context: PairCodeContext,
  prepared: PreparedCodeContextEvidence[],
  repositoryPath: string
): Promise<MergeCodeContextEvidence[]> {
  const snippets = await readGitObjectSnippets(
    snippetRequests(
      prepared,
      context.mergeBaseOid,
      context.leftOid,
      context.rightOid,
      context.mergedTreeOid
    ),
    { repositoryPath }
  )

  return prepared.map(item => {
    const baseSnippet = requiredSnippet(snippets, item.baseKey)
    const leftSnippet = deletedVersionSnippet(
      baseSnippet,
      requiredSnippet(snippets, item.leftKey)
    )
    const rightSnippet = deletedVersionSnippet(
      baseSnippet,
      requiredSnippet(snippets, item.rightKey)
    )
    const mergedSnippet = deletedMergedSnippet(
      baseSnippet,
      leftSnippet,
      rightSnippet,
      requiredSnippet(snippets, item.mergedKey)
    )

    return {
      pair: mergeResult.pair,
      kind,
      filePath: item.filePath,
      mergeBaseOid: context.mergeBaseOid,
      mergedTreeOid: context.mergedTreeOid,
      baseCommit: context.baseCommit,
      leftCommit: context.leftCommit,
      rightCommit: context.rightCommit,
      baseSnippet,
      leftSnippet,
      rightSnippet,
      mergedSnippet
    }
  })
}

// 준비된 evidence를 Git object batch 요청 네 개로 변환
function snippetRequests(
  prepared: PreparedCodeContextEvidence[],
  mergeBaseOid: string,
  leftOid: string,
  rightOid: string,
  mergedTreeOid: string
): GitObjectSnippetRequest[] {
  return prepared.flatMap(item => [{
    key: item.baseKey,
    objectOid: mergeBaseOid,
    filePath: item.filePath,
    range: item.baseRange
  }, {
    key: item.leftKey,
    objectOid: leftOid,
    filePath: item.filePath,
    range: item.leftRange
  }, {
    key: item.rightKey,
    objectOid: rightOid,
    filePath: item.filePath,
    range: item.rightRange
  }, {
    key: item.mergedKey,
    objectOid: mergedTreeOid,
    filePath: item.filePath,
    range: item.mergedRange
  }])
}

function requiredSnippet(
  snippets: ReadonlyMap<string, MergeCodeContextSnippet>,
  key: string
): MergeCodeContextSnippet {
  const snippet = snippets.get(key)

  if (!snippet) {
    throw new Error(`Missing Git object snippet ${key}`)
  }

  return snippet
}

// base에 존재하던 file이 side object에 없으면 deleted로 분류
function deletedVersionSnippet(
  baseSnippet: MergeCodeContextSnippet,
  snippet: MergeCodeContextSnippet
): MergeCodeContextSnippet {
  if (snippet.status !== "missing" || baseSnippet.status === "missing") {
    return snippet
  }

  return {
    ...snippet,
    status: "deleted"
  }
}

// 어느 version에든 존재한 file이 merge tree에서 없으면 deleted로 분류
function deletedMergedSnippet(
  baseSnippet: MergeCodeContextSnippet,
  leftSnippet: MergeCodeContextSnippet,
  rightSnippet: MergeCodeContextSnippet,
  mergedSnippet: MergeCodeContextSnippet
): MergeCodeContextSnippet {
  if (
    mergedSnippet.status !== "missing" ||
    [baseSnippet, leftSnippet, rightSnippet].every(
      snippet => snippet.status === "missing"
    )
  ) {
    return mergedSnippet
  }

  return {
    ...mergedSnippet,
    status: "deleted"
  }
}
