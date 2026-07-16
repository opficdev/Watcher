import type {
  GitDiffHunk,
  MergeCodeContextLineRange,
  MergeCodeContextRegion
} from "./types.js"

const SMALL_FILE_MAX_BYTES = 32 * 1024
const SMALL_FILE_MAX_LINES = 400
const FALLBACK_CONTEXT_LINES = 40

// unified diff hunk header에서 base와 변경 후 line range를 추출
export function parseDiffHunks(output: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = []

  for (const line of output.split("\n")) {
    const match = line.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
    )

    if (!match) {
      continue
    }

    hunks.push({
      oldStartLine: Number(match[1]),
      oldLineCount: Number(match[2] ?? "1"),
      newStartLine: Number(match[3]),
      newLineCount: Number(match[4] ?? "1")
    })
  }

  return hunks
}

// 양쪽 hunk를 merge-base 좌표에서 비교해 겹치는 코드 문맥 범위를 구성
export function overlapRegions(
  filePath: string,
  leftHunks: GitDiffHunk[],
  rightHunks: GitDiffHunk[]
): MergeCodeContextRegion[] {
  const regions: MergeCodeContextRegion[] = []

  for (const left of leftHunks) {
    const leftBase = oldRangeFor(left)

    for (const right of rightHunks) {
      const rightBase = oldRangeFor(right)
      const startLine = Math.max(leftBase.startLine, rightBase.startLine)
      const endLine = Math.min(leftBase.endLine, rightBase.endLine)

      if (endLine < startLine) {
        continue
      }

      regions.push({
        filePath,
        baseRange: { startLine, endLine },
        leftRange: newRangeFor(left),
        rightRange: newRangeFor(right)
      })
    }
  }

  return regions.sort(compareRegions)
}

// merged text에서 완성된 conflict marker block의 line range를 추출
export function conflictMarkerRanges(
  content: string
): MergeCodeContextLineRange[] {
  const ranges: MergeCodeContextLineRange[] = []
  let startLine: number | undefined

  for (const [index, line] of content.split("\n").entries()) {
    const lineNumber = index + 1

    if (line.startsWith("<<<<<<< ")) {
      startLine = lineNumber
      continue
    }

    if (startLine !== undefined && line.startsWith(">>>>>>> ")) {
      ranges.push({
        startLine,
        endLine: lineNumber
      })
      startLine = undefined
    }
  }

  return ranges
}

// file 크기와 대상 범위에 따라 전체 file 또는 제한된 문맥 범위를 선택
export function snippetRangeFor(input: {
  byteLength: number
  lineCount: number
  targetRange: MergeCodeContextLineRange
  functionRange?: MergeCodeContextLineRange
}): MergeCodeContextLineRange & { truncated: boolean } {
  const lineCount = Math.max(1, input.lineCount)

  if (
    input.byteLength <= SMALL_FILE_MAX_BYTES &&
    input.lineCount <= SMALL_FILE_MAX_LINES
  ) {
    return {
      startLine: 1,
      endLine: lineCount,
      truncated: false
    }
  }

  const selected = input.functionRange ?? {
    startLine: input.targetRange.startLine - FALLBACK_CONTEXT_LINES,
    endLine: input.targetRange.endLine + FALLBACK_CONTEXT_LINES
  }
  let startLine = Math.max(1, selected.startLine)
  let endLine = Math.min(lineCount, selected.endLine)

  if (SMALL_FILE_MAX_LINES < endLine - startLine + 1) {
    const center = Math.floor(
      (input.targetRange.startLine + input.targetRange.endLine) / 2
    )
    const lowerBound = input.functionRange?.startLine ?? 1
    const upperBound = Math.min(
      lineCount,
      input.functionRange?.endLine ?? lineCount
    )

    startLine = Math.max(
      lowerBound,
      center - Math.floor(SMALL_FILE_MAX_LINES / 2)
    )
    endLine = Math.min(upperBound, startLine + SMALL_FILE_MAX_LINES - 1)
    startLine = Math.max(lowerBound, endLine - SMALL_FILE_MAX_LINES + 1)
  }

  return {
    startLine,
    endLine,
    truncated: true
  }
}

function oldRangeFor(hunk: GitDiffHunk): MergeCodeContextLineRange {
  return rangeFor(hunk.oldStartLine, hunk.oldLineCount)
}

function newRangeFor(hunk: GitDiffHunk): MergeCodeContextLineRange {
  return rangeFor(hunk.newStartLine, hunk.newLineCount)
}

function rangeFor(startLine: number, lineCount: number): MergeCodeContextLineRange {
  return {
    startLine,
    endLine: startLine + Math.max(1, lineCount) - 1
  }
}

function compareRegions(
  region: MergeCodeContextRegion,
  other: MergeCodeContextRegion
): number {
  if (region.filePath !== other.filePath) {
    return region.filePath < other.filePath ? -1 : 1
  }

  if (region.baseRange.startLine !== other.baseRange.startLine) {
    return region.baseRange.startLine - other.baseRange.startLine
  }

  return region.baseRange.endLine - other.baseRange.endLine
}
