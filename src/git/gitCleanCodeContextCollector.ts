import {
  collectPreparedEvidence,
  type PreparedCodeContextEvidence
} from "./gitCodeContextEvidenceBuilder.js"
import {
  changedFiles,
  diffHunks,
  pairCodeContext
} from "./gitCodeContextReader.js"
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
  MergeCodeContextLineRange
} from "./types.js"

// clean 조합에서 양쪽 exact hunk가 merge-base 좌표로 겹치는 문맥만 수집
export async function collectCleanOverlapEvidence(
  mergeResult: GitMergeTreePairResult,
  pairIndex: number,
  repositoryPath: string
): Promise<{
  overlapFiles: string[]
  evidence: MergeCodeContextEvidence[]
}> {
  const context = await pairCodeContext(mergeResult, repositoryPath)
  const [leftFiles, rightFiles] = await Promise.all([
    changedFiles(repositoryPath, context.mergeBaseOid, context.leftOid),
    changedFiles(repositoryPath, context.mergeBaseOid, context.rightOid)
  ])
  const rightFileSet = new Set(rightFiles)
  const commonFiles = [...new Set(
    leftFiles.filter(filePath => rightFileSet.has(filePath))
  )].sort(compareText)
  const prepared: PreparedCodeContextEvidence[] = []

  for (const [fileIndex, filePath] of commonFiles.entries()) {
    const [leftHunks, rightHunks] = await Promise.all([
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
      )
    ])
    const regions = overlapRegions(filePath, leftHunks, rightHunks)

    if (!regions.length) {
      continue
    }

    const [
      mergedHunks,
      leftFunctionHunks,
      rightFunctionHunks,
      mergedFunctionHunks
    ] = await Promise.all([
      diffHunks(
        repositoryPath,
        context.mergeBaseOid,
        context.mergedTreeOid,
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

    for (const [regionIndex, region] of regions.entries()) {
      const mergedTarget = mappedNewRangeFor(
        mergedHunks,
        region.baseRange
      ) ?? unionRange(region.leftRange, region.rightRange)
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

  return {
    overlapFiles: commonFiles,
    evidence: await collectPreparedEvidence(
      mergeResult,
      "clean_hunk_overlap",
      context,
      prepared,
      repositoryPath
    )
  }
}

// base 좌표와 겹치는 merged hunk의 변경 후 좌표를 선택
function mappedNewRangeFor(
  hunks: GitDiffHunk[],
  baseRange: MergeCodeContextLineRange
): MergeCodeContextLineRange | undefined {
  return hunks
    .map(hunk => ({
      oldRange: oldRange(hunk),
      newRange: newRange(hunk)
    }))
    .filter(item =>
      item.oldRange !== undefined &&
      item.newRange !== undefined &&
      Math.max(item.oldRange.startLine, baseRange.startLine) <=
        Math.min(item.oldRange.endLine, baseRange.endLine)
    )
    .sort((item, other) => {
      const range = item.oldRange!
      const otherRange = other.oldRange!

      return range.endLine - range.startLine -
        (otherRange.endLine - otherRange.startLine)
    })[0]?.newRange
}

function compareText(text: string, other: string): number {
  if (text === other) {
    return 0
  }

  return text < other ? -1 : 1
}
