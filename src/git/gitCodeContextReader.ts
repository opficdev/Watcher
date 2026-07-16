import { execFile, spawn } from "node:child_process"
import { parseDiffHunks } from "./mergeCodeContextParser.js"
import type {
  GitDiffHunk,
  GitMergeTreePairResult,
  MergeCodeContextCommitMetadata
} from "./types.js"

const STDERR_LIMIT = 16 * 1024
const SMALL_GIT_OUTPUT_LIMIT = 64 * 1024
const PATH_GIT_OUTPUT_LIMIT = 16 * 1024 * 1024
const DIFF_LINE_PREFIX_LIMIT = 4 * 1024

export type PairCodeContext = {
  leftOid: string
  rightOid: string
  mergedTreeOid: string
  mergeBaseOid: string
  baseCommit: MergeCodeContextCommitMetadata
  leftCommit: MergeCodeContextCommitMetadata
  rightCommit: MergeCodeContextCommitMetadata
}

// 조합 OID와 commit metadata를 한 번만 고정
export async function pairCodeContext(
  mergeResult: GitMergeTreePairResult,
  repositoryPath: string
): Promise<PairCodeContext> {
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

  return {
    leftOid,
    rightOid,
    mergedTreeOid,
    mergeBaseOid,
    baseCommit,
    leftCommit,
    rightCommit
  }
}

// base와 한쪽 commit 사이에서 변경된 file path를 NUL 구분으로 조회
export async function changedFiles(
  repositoryPath: string,
  baseOid: string,
  targetOid: string
): Promise<string[]> {
  const output = await executeGitBuffer(repositoryPath, [
    "diff",
    "--name-only",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--no-color",
    baseOid,
    targetOid
  ], "diff names")

  if (!output.length) {
    return []
  }

  if (output[output.length - 1] !== 0) {
    throw new Error("Incomplete Git changed file response")
  }

  return output.subarray(0, -1).toString("utf8").split("\u0000")
}

// raw diff 본문은 버리고 unified hunk header만 제한된 memory로 수집
export async function diffHunks(
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

// path와 같은 NUL 포함 Git 응답을 제한된 buffer로 조회
async function executeGitBuffer(
  repositoryPath: string,
  args: string[],
  operation: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd: repositoryPath,
      encoding: "buffer",
      env: readOnlyGitEnvironment(),
      maxBuffer: PATH_GIT_OUTPUT_LIMIT
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

      resolve(stdout)
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

function errorFor(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
