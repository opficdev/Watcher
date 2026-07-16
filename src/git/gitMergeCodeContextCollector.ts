import { execFile, spawn } from "node:child_process"
import {
  readGitObjectConflictMarkerRanges,
  readGitObjectSnippets
} from "./gitObjectBatchReader.js"
import {
  overlapRegions,
  parseDiffHunks,
  snippetRangeFor
} from "./mergeCodeContextParser.js"
import type {
  GitDiffHunk,
  GitMergeCodeContextPairResult,
  GitMergeTreePairResult,
  GitObjectSnippetRequest,
  MergeCodeContextCommitMetadata,
  MergeCodeContextEvidence,
  MergeCodeContextLineRange,
  MergeCodeContextRegion,
  MergeCodeContextSnippet
} from "./types.js"

const STDERR_LIMIT = 16 * 1024
const SMALL_GIT_OUTPUT_LIMIT = 64 * 1024
const DIFF_LINE_PREFIX_LIMIT = 4 * 1024

type PreparedConflictEvidence = {
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

// merge-tree 결과 순서를 보존하며 confirmed conflict 코드 문맥을 수집
export async function collect(
  mergeResults: GitMergeTreePairResult[],
  options: { repositoryPath: string }
): Promise<GitMergeCodeContextPairResult[]> {
  const results: GitMergeCodeContextPairResult[] = []

  for (const [pairIndex, mergeResult] of mergeResults.entries()) {
    if (mergeResult.status !== "confirmed_conflict") {
      results.push({
        pair: mergeResult.pair,
        evidence: []
      })
      continue
    }

    try {
      results.push({
        pair: mergeResult.pair,
        evidence: await collectConflictEvidence(
          mergeResult,
          pairIndex,
          options.repositoryPath
        )
      })
    } catch (error) {
      results.push({
        pair: mergeResult.pair,
        evidence: [],
        errorMessage: diagnosticFor(error)
      })
    }
  }

  return results
}

// 한 conflict 조합의 merge base, metadata, hunk, 네 version을 조립
async function collectConflictEvidence(
  mergeResult: GitMergeTreePairResult,
  pairIndex: number,
  repositoryPath: string
): Promise<MergeCodeContextEvidence[]> {
  const leftOid = requiredOid(mergeResult.leftCommitOid, "left commit")
  const rightOid = requiredOid(mergeResult.rightCommitOid, "right commit")
  const mergedTreeOid = requiredOid(mergeResult.mergedTreeOid, "merged tree")
  const mergeBaseOid = requiredOid(
    await executeGitText(
      repositoryPath,
      ["merge-base", leftOid, rightOid],
      "merge-base"
    ),
    "merge base"
  )
  const [baseCommit, leftCommit, rightCommit] = await Promise.all([
    commitMetadata(repositoryPath, mergeBaseOid, "base"),
    commitMetadata(
      repositoryPath,
      leftOid,
      "left",
      mergeResult.pair.leftBranchName
    ),
    commitMetadata(
      repositoryPath,
      rightOid,
      "right",
      mergeResult.pair.rightBranchName
    )
  ])
  const prepared: PreparedConflictEvidence[] = []
  const markerKeys = mergeResult.conflictFiles.map((_, fileIndex) =>
    `${pairIndex}:${fileIndex}:markers`
  )
  const markerRanges = await readGitObjectConflictMarkerRanges(
    mergeResult.conflictFiles.map((filePath, fileIndex) => ({
      key: markerKeys[fileIndex]!,
      objectOid: mergedTreeOid,
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
      diffHunks(repositoryPath, mergeBaseOid, leftOid, filePath, "exact"),
      diffHunks(repositoryPath, mergeBaseOid, rightOid, filePath, "exact"),
      diffHunks(repositoryPath, mergeBaseOid, leftOid, filePath, "function"),
      diffHunks(repositoryPath, mergeBaseOid, rightOid, filePath, "function"),
      diffHunks(
        repositoryPath,
        mergeBaseOid,
        mergedTreeOid,
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

  const snippets = await readGitObjectSnippets(
    snippetRequests(
      prepared,
      mergeBaseOid,
      leftOid,
      rightOid,
      mergedTreeOid
    ),
    { repositoryPath }
  )

  return prepared.map(item => ({
    pair: mergeResult.pair,
    kind: "confirmed_conflict",
    filePath: item.filePath,
    mergeBaseOid,
    mergedTreeOid,
    baseCommit,
    leftCommit,
    rightCommit,
    baseSnippet: requiredSnippet(snippets, item.baseKey),
    leftSnippet: requiredSnippet(snippets, item.leftKey),
    rightSnippet: requiredSnippet(snippets, item.rightKey),
    mergedSnippet: requiredSnippet(snippets, item.mergedKey)
  }))
}

// 준비된 evidence를 Git object batch 요청 네 개로 변환
function snippetRequests(
  prepared: PreparedConflictEvidence[],
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

// 큰 file fallback 규칙으로 최대 400줄 요청 범위를 구성
function boundedContextRange(
  targetRange: MergeCodeContextLineRange,
  functionRange?: MergeCodeContextLineRange
): MergeCodeContextLineRange {
  const selected = snippetRangeFor({
    byteLength: Number.MAX_SAFE_INTEGER,
    lineCount: Number.MAX_SAFE_INTEGER,
    targetRange,
    functionRange
  })

  return {
    startLine: selected.startLine,
    endLine: selected.endLine
  }
}

// target을 포함하는 가장 좁은 function hunk range를 선택
function functionRangeFor(
  hunks: GitDiffHunk[],
  side: "old" | "new",
  targetRange: MergeCodeContextLineRange
): MergeCodeContextLineRange | undefined {
  return hunks
    .map(hunk => side === "old" ? oldRange(hunk) : newRange(hunk))
    .filter((range): range is MergeCodeContextLineRange =>
      range !== undefined &&
      range.startLine <= targetRange.startLine &&
      targetRange.endLine <= range.endLine
    )
    .sort((range, other) =>
      range.endLine - range.startLine - (other.endLine - other.startLine)
    )[0]
}

function oldRange(hunk: GitDiffHunk | undefined): MergeCodeContextLineRange | undefined {
  if (!hunk) {
    return undefined
  }

  return lineRange(hunk.oldStartLine, hunk.oldLineCount)
}

function newRange(hunk: GitDiffHunk | undefined): MergeCodeContextLineRange | undefined {
  if (!hunk) {
    return undefined
  }

  return lineRange(hunk.newStartLine, hunk.newLineCount)
}

function lineRange(startLine: number, lineCount: number): MergeCodeContextLineRange {
  return {
    startLine,
    endLine: startLine + Math.max(1, lineCount) - 1
  }
}

function unionRange(
  range: MergeCodeContextLineRange,
  other: MergeCodeContextLineRange
): MergeCodeContextLineRange {
  return {
    startLine: Math.min(range.startLine, other.startLine),
    endLine: Math.max(range.endLine, other.endLine)
  }
}

// commit 한 건의 고정 metadata를 object OID 기준으로 조회
async function commitMetadata(
  repositoryPath: string,
  oid: string,
  role: "base" | "left" | "right",
  branchName?: string
): Promise<MergeCodeContextCommitMetadata> {
  const output = await executeGitText(repositoryPath, [
    "show",
    "-s",
    "--format=%H%x00%an <%ae>%x00%cI%x00%s",
    oid
  ], "show metadata")
  const [resolvedOid, author, committedAt, subject, ...remaining] = output.split("\u0000")

  if (!resolvedOid || !author || !committedAt || subject === undefined || remaining.length) {
    throw new Error("Invalid Git commit metadata response")
  }

  return {
    role,
    ...(branchName ? { branchName } : {}),
    oid: resolvedOid,
    author,
    committedAt,
    subject
  }
}

// raw diff 본문은 버리고 unified hunk header만 제한된 memory로 수집
async function diffHunks(
  repositoryPath: string,
  baseOid: string,
  targetOid: string,
  filePath: string,
  context: "exact" | "function"
): Promise<GitDiffHunk[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--unified=0",
      ...(context === "function" ? ["--function-context"] : []),
      baseOid,
      targetOid,
      "--",
      filePath
    ], {
      cwd: repositoryPath,
      env: readOnlyGitEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    })
    const collector = new GitDiffHunkHeaderCollector()
    const stderrChunks: Buffer[] = []
    let stderrLength = 0
    let outputError: unknown
    let settled = false

    child.stdout.on("data", (chunk: Buffer) => {
      if (outputError) {
        return
      }

      try {
        collector.push(chunk)
      } catch (error) {
        outputError = error
      }
    })
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = STDERR_LIMIT - stderrLength

      if (remaining <= 0) {
        return
      }

      const captured = chunk.subarray(0, remaining)

      stderrChunks.push(captured)
      stderrLength += captured.length
    })
    child.on("error", error => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.on("close", (code, signal) => {
      if (settled) {
        return
      }

      settled = true

      if (code !== 0) {
        reject(gitFailure(
          "diff",
          code,
          signal,
          Buffer.concat(stderrChunks, stderrLength).toString("utf8").trim()
        ))
        return
      }

      if (outputError) {
        reject(errorFor(outputError))
        return
      }

      resolve(collector.finish())
    })
  })
}

// 긴 변경 line을 보관하지 않고 hunk header 접두사만 해석
class GitDiffHunkHeaderCollector {
  private readonly hunks: GitDiffHunk[] = []
  private lineChunks: Buffer[] = []
  private lineLength = 0

  push(chunk: Buffer): void {
    let offset = 0
    let newline = chunk.indexOf(10, offset)

    while (newline >= 0) {
      this.pushLineSegment(chunk.subarray(offset, newline))
      this.finishLine()
      offset = newline + 1
      newline = chunk.indexOf(10, offset)
    }

    if (offset < chunk.length) {
      this.pushLineSegment(chunk.subarray(offset))
    }
  }

  finish(): GitDiffHunk[] {
    if (this.lineLength) {
      this.finishLine()
    }

    return [...this.hunks]
  }

  private pushLineSegment(segment: Buffer): void {
    const remaining = DIFF_LINE_PREFIX_LIMIT - this.lineLength

    if (remaining <= 0) {
      return
    }

    const captured = segment.subarray(0, remaining)

    this.lineChunks.push(captured)
    this.lineLength += captured.length
  }

  private finishLine(): void {
    if (this.lineLength) {
      this.hunks.push(...parseDiffHunks(
        Buffer.concat(this.lineChunks, this.lineLength).toString("utf8")
      ))
    }

    this.lineChunks = []
    this.lineLength = 0
  }
}

// 작은 Git text 응답을 제한된 buffer로 조회
async function executeGitText(
  repositoryPath: string,
  args: string[],
  operation: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd: repositoryPath,
      env: readOnlyGitEnvironment(),
      maxBuffer: SMALL_GIT_OUTPUT_LIMIT
    }, (error, stdout, stderr) => {
      if (error) {
        reject(gitFailure(
          operation,
          typeof error.code === "number" ? error.code : null,
          error.signal ?? null,
          stderr.toString().slice(0, STDERR_LIMIT).trim()
        ))
        return
      }

      resolve(stdout.toString().trimEnd())
    })
  })
}

function readOnlyGitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0"
  }
}

function requiredOid(oid: string | undefined, role: string): string {
  if (!oid || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) {
    throw new Error(`Invalid ${role} OID`)
  }

  return oid
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

function gitFailure(
  operation: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string
): Error {
  return new Error([
    `git ${operation} failed`,
    code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`,
    stderr
  ].filter(Boolean).join(": "))
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
