import {
  collectPreparedEvidence,
  type PreparedCodeContextEvidence
} from "./gitCodeContextEvidenceBuilder.js"
import {
  diffHunks,
  pairCodeContext
} from "./gitCodeContextReader.js"
import { readGitObjectConflictMarkerRanges } from "./gitObjectBatchReader.js"
import {
  boundedContextRange,
  functionRangeFor,
  newRange,
  oldRange,
  overlapRegions,
  unionRange
} from "./mergeCodeContextParser.js"
import type {
  GitDiffHunk,
  GitMergeTreePairResult,
  MergeCodeContextEvidence,
  MergeCodeContextRegion
} from "./types.js"

// 한 conflict 조합의 merge base, metadata, hunk, 네 version을 조립
export async function collectConflictEvidence(
  mergeResult: GitMergeTreePairResult,
  pairIndex: number,
  repositoryPath: string
): Promise<MergeCodeContextEvidence[]> {
  const context = await pairCodeContext(mergeResult, repositoryPath)
  const prepared: PreparedCodeContextEvidence[] = []
  const markerKeys = mergeResult.conflictFiles.map((_, fileIndex) =>
    `${pairIndex}:${fileIndex}:markers`
  )
  const markerRanges = await readGitObjectConflictMarkerRanges(
    mergeResult.conflictFiles.map((filePath, fileIndex) => ({
      key: markerKeys[fileIndex]!,
      objectOid: context.mergedTreeOid,
      filePath,
      range: { startLine: 1, endLine: 1 }
    })),
    { repositoryPath }
  )

  for (const [fileIndex, filePath] of mergeResult.conflictFiles.entries()) {
    const [
      leftHunks,
      rightHunks,
      leftFunctionHunks,
      rightFunctionHunks,
      mergedFunctionHunks
    ] = await Promise.all([
      diffHunks(
        repositoryPath,
        context.mergeBaseOid,
        context.leftOid,
        filePath,
        "exact"
      ),
      diffHunks(
        repositoryPath,
        context.mergeBaseOid,
        context.rightOid,
        filePath,
        "exact"
      ),
      diffHunks(
        repositoryPath,
        context.mergeBaseOid,
        context.leftOid,
        filePath,
        "function"
      ),
      diffHunks(
        repositoryPath,
        context.mergeBaseOid,
        context.rightOid,
        filePath,
        "function"
      ),
      diffHunks(
        repositoryPath,
        context.mergeBaseOid,
        context.mergedTreeOid,
        filePath,
        "function"
      )
    ])
    const regions = conflictRegions(filePath, leftHunks, rightHunks)
    const markers = markerRanges.get(markerKeys[fileIndex]!) ?? []
    const evidenceCount = Math.max(regions.length, markers.length)

    for (let regionIndex = 0; regionIndex < evidenceCount; regionIndex += 1) {
      const region = regions[Math.min(regionIndex, regions.length - 1)]!
      const mergedTarget = markers[regionIndex] ?? unionRange(
        region.leftRange,
        region.rightRange
      )
      const key = `${pairIndex}:${fileIndex}:${regionIndex}`

      prepared.push({
        filePath,
        baseRange: boundedContextRange(
          region.baseRange,
          functionRangeFor(
            [...leftFunctionHunks, ...rightFunctionHunks],
            "old",
            region.baseRange
          )
        ),
        leftRange: boundedContextRange(
          region.leftRange,
          functionRangeFor(leftFunctionHunks, "new", region.leftRange)
        ),
        rightRange: boundedContextRange(
          region.rightRange,
          functionRangeFor(rightFunctionHunks, "new", region.rightRange)
        ),
        mergedRange: boundedContextRange(
          mergedTarget,
          functionRangeFor(mergedFunctionHunks, "new", mergedTarget)
        ),
        baseKey: `${key}:base`,
        leftKey: `${key}:left`,
        rightKey: `${key}:right`,
        mergedKey: `${key}:merged`
      })
    }
  }

  return collectPreparedEvidence(
    mergeResult,
    "confirmed_conflict",
    context,
    prepared,
    repositoryPath
  )
}

// merge-base 좌표가 겹치면 각 overlap을, 아니면 file별 fallback을 사용
function conflictRegions(
  filePath: string,
  leftHunks: GitDiffHunk[],
  rightHunks: GitDiffHunk[]
): MergeCodeContextRegion[] {
  const overlaps = overlapRegions(filePath, leftHunks, rightHunks)

  if (overlaps.length) {
    return overlaps
  }

  const left = leftHunks[0]
  const right = rightHunks[0]

  return [{
    filePath,
    baseRange: unionRange(
      oldRange(left) ?? { startLine: 1, endLine: 1 },
      oldRange(right) ?? { startLine: 1, endLine: 1 }
    ),
    leftRange: newRange(left) ?? { startLine: 1, endLine: 1 },
    rightRange: newRange(right) ?? { startLine: 1, endLine: 1 }
  }]
}
