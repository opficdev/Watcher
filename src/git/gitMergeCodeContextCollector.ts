import { collectCleanOverlapEvidence } from "./gitCleanCodeContextCollector.js"
import { collectConflictEvidence } from "./gitConflictCodeContextCollector.js"
import type {
  GitMergeCodeContextPairResult,
  GitMergeTreePairResult
} from "./types.js"

const STDERR_LIMIT = 16 * 1024

// merge-tree 결과 순서를 보존하며 conflict와 clean overlap 코드 문맥을 수집
export async function collect(
  mergeResults: GitMergeTreePairResult[],
  options: { repositoryPath: string }
): Promise<GitMergeCodeContextPairResult[]> {
  const results: GitMergeCodeContextPairResult[] = []

  for (const [pairIndex, mergeResult] of mergeResults.entries()) {
    if (mergeResult.status === "merge_check_failed") {
      results.push({
        pair: mergeResult.pair,
        overlapFiles: [],
        evidence: []
      })
      continue
    }

    try {
      if (mergeResult.status === "confirmed_conflict") {
        results.push({
          pair: mergeResult.pair,
          overlapFiles: sortedUnique(mergeResult.conflictFiles),
          evidence: await collectConflictEvidence(
            mergeResult,
            pairIndex,
            options.repositoryPath
          )
        })
        continue
      }

      const collection = await collectCleanOverlapEvidence(
        mergeResult,
        pairIndex,
        options.repositoryPath
      )

      results.push({
        pair: mergeResult.pair,
        overlapFiles: collection.overlapFiles,
        evidence: collection.evidence
      })
    } catch (error) {
      results.push({
        pair: mergeResult.pair,
        overlapFiles: [],
        evidence: [],
        errorMessage: diagnosticFor(error)
      })
    }
  }

  return results
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(compareText)
}

function compareText(text: string, other: string): number {
  if (text === other) {
    return 0
  }

  return text < other ? -1 : 1
}

function diagnosticFor(error: unknown): string {
  return utf8Prefix(
    `Git code context collection failed: ${errorFor(error).message}`,
    STDERR_LIMIT
  )
}

function utf8Prefix(content: string, maximumBytes: number): string {
  let byteLength = 0
  let endIndex = 0

  for (const character of content) {
    const characterLength = Buffer.byteLength(character)

    if (maximumBytes < byteLength + characterLength) {
      break
    }

    byteLength += characterLength
    endIndex += character.length
  }

  return content.slice(0, endIndex)
}

function errorFor(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
