import { spawn } from "node:child_process"
import type { GitObjectSnippetRequest } from "./types.js"

const STDERR_LIMIT = 16 * 1024
const CHECK_OUTPUT_LIMIT = 16 * 1024 * 1024

export type GitObjectRequestGroup = {
  objectSpec: string
  requests: GitObjectSnippetRequest[]
}

export type GitObjectCheck = {
  group: GitObjectRequestGroup
  objectType?: string
  byteLength?: number
}

export type GitObjectContentConsumer = {
  start(check: GitObjectCheck): void
  push(content: Buffer): void
  finish(): void
}

type GitProcessOutputConsumer<Result> = {
  push(content: Buffer): void
  finish(): Result
}

// object 존재 여부와 종류, 크기를 작은 응답으로 먼저 확인
export async function checkObjects(
  groups: GitObjectRequestGroup[],
  repositoryPath: string
): Promise<GitObjectCheck[]> {
  const output = await collectGitOutput(
    ["cat-file", "--batch-check", "-Z"],
    batchInput(groups),
    repositoryPath
  )
  const records = nulRecords(output)

  if (records.length !== groups.length) {
    throw new Error("Unexpected git cat-file batch-check record count")
  }

  return records.map((record, index) => {
    const group = groups[index]

    if (!group) {
      throw new Error(`Missing Git object request group ${index}`)
    }

    if (record.endsWith(" missing")) {
      return { group }
    }

    const match = record.match(/^([0-9a-f]+) ([^ ]+) (\d+)$/)

    if (!match) {
      throw new Error(`Unexpected git cat-file batch-check record ${index}`)
    }

    return {
      group,
      objectType: match[2],
      byteLength: Number(match[3])
    }
  })
}

// 확인된 blob을 한 process에서 읽고 object별로 즉시 소비
export async function readObjects(
  checks: GitObjectCheck[],
  repositoryPath: string,
  consumer: GitObjectContentConsumer
): Promise<void> {
  if (!checks.length) {
    return
  }

  await runGitProcess(
    ["cat-file", "--batch", "-Z"],
    "batch",
    batchInput(checks.map(check => check.group)),
    repositoryPath,
    new GitBatchContentParser(checks, consumer)
  )
}

// NUL header와 고정 크기 content가 번갈아 오는 batch 응답을 해석
class GitBatchContentParser {
  private checkIndex = 0
  private headerChunks: Buffer[] = []
  private headerLength = 0
  private contentLength = 0
  private expectedContentLength: number | undefined
  private expectsTerminator = false

  constructor(
    private readonly checks: GitObjectCheck[],
    private readonly consumer: GitObjectContentConsumer
  ) {}

  push(chunk: Buffer): void {
    let offset = 0

    while (offset < chunk.length) {
      if (this.expectsTerminator) {
        if (chunk[offset] !== 0) {
          throw new Error(`Missing git cat-file content terminator ${this.checkIndex}`)
        }

        offset += 1
        this.finishContent()
        continue
      }

      if (this.expectedContentLength !== undefined) {
        const remaining = this.expectedContentLength - this.contentLength
        const length = Math.min(remaining, chunk.length - offset)

        if (length) {
          this.consumer.push(chunk.subarray(offset, offset + length))
          this.contentLength += length
          offset += length
        }

        if (this.contentLength === this.expectedContentLength) {
          this.expectsTerminator = true
        }

        continue
      }

      const terminator = chunk.indexOf(0, offset)

      if (terminator < 0) {
        this.headerChunks.push(chunk.subarray(offset))
        this.headerLength += chunk.length - offset
        return
      }

      this.headerChunks.push(chunk.subarray(offset, terminator))
      this.headerLength += terminator - offset
      offset = terminator + 1
      this.finishHeader()
    }
  }

  finish(): void {
    if (
      this.checkIndex !== this.checks.length ||
      this.headerLength ||
      this.expectedContentLength !== undefined ||
      this.expectsTerminator
    ) {
      throw new Error("Incomplete git cat-file batch response")
    }
  }

  private finishHeader(): void {
    const check = this.checks[this.checkIndex]
    const header = Buffer.concat(this.headerChunks, this.headerLength)
      .toString("utf8")
    const match = header.match(/^([0-9a-f]+) ([^ ]+) (\d+)$/)

    this.headerChunks = []
    this.headerLength = 0

    if (!check || !match || match[2] !== "blob") {
      throw new Error(`Unexpected git cat-file batch header ${this.checkIndex}`)
    }

    const byteLength = Number(match[3])

    if (byteLength !== check.byteLength) {
      throw new Error(`Changed git cat-file object size ${this.checkIndex}`)
    }

    this.expectedContentLength = byteLength
    this.consumer.start(check)

    if (!byteLength) {
      this.expectsTerminator = true
    }
  }

  private finishContent(): void {
    if (!this.checks[this.checkIndex]) {
      throw new Error(`Missing Git object check ${this.checkIndex}`)
    }

    this.consumer.finish()
    this.checkIndex += 1
    this.contentLength = 0
    this.expectedContentLength = undefined
    this.expectsTerminator = false
  }
}

// NUL 구분 입력을 만들어 경로의 개행과 공백을 보존
function batchInput(groups: GitObjectRequestGroup[]): Buffer {
  return Buffer.from(`${groups.map(group => group.objectSpec).join("\u0000")}\u0000`)
}

// Git process 생명주기와 공통 오류 우선순위를 관리
async function runGitProcess<Result>(
  args: string[],
  operation: string,
  input: Buffer,
  repositoryPath: string,
  outputConsumer: GitProcessOutputConsumer<Result>
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repositoryPath,
      stdio: ["pipe", "pipe", "pipe"]
    })
    const stderrChunks: Buffer[] = []
    let stderrLength = 0
    let outputError: unknown
    let inputError: unknown
    let settled = false

    child.stdout.on("data", (chunk: Buffer) => {
      if (outputError) {
        return
      }

      try {
        outputConsumer.push(chunk)
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
    child.stdin.on("error", error => {
      inputError = error
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
      const stderr = Buffer.concat(stderrChunks, stderrLength)
        .toString("utf8")
        .trim()

      if (code !== 0) {
        reject(gitError(operation, code, signal, stderr))
        return
      }

      if (inputError) {
        reject(errorFor(inputError))
        return
      }

      if (outputError) {
        reject(errorFor(outputError))
        return
      }

      try {
        resolve(outputConsumer.finish())
      } catch (error) {
        reject(errorFor(error))
      }
    })

    child.stdin.end(input)
  })
}

// batch-check의 작은 응답을 크기 제한 안에서 수집
async function collectGitOutput(
  args: string[],
  input: Buffer,
  repositoryPath: string
): Promise<Buffer> {
  const stdoutChunks: Buffer[] = []
  let stdoutLength = 0

  return runGitProcess(args, "batch-check", input, repositoryPath, {
    push(chunk) {
      const remaining = CHECK_OUTPUT_LIMIT - stdoutLength

      if (remaining <= 0) {
        throw new Error("git cat-file batch-check output limit exceeded")
      }

      const captured = chunk.subarray(0, remaining)

      stdoutChunks.push(captured)
      stdoutLength += captured.length

      if (captured.length !== chunk.length) {
        throw new Error("git cat-file batch-check output limit exceeded")
      }
    },
    finish() {
      return Buffer.concat(stdoutChunks, stdoutLength)
    }
  })
}

// NUL로 끝나는 batch-check record를 순서대로 분리
function nulRecords(output: Buffer): string[] {
  if (!output.length || output[output.length - 1] !== 0) {
    throw new Error("Incomplete git cat-file batch-check response")
  }

  return output.subarray(0, -1).toString("utf8").split("\u0000")
}

function gitError(
  operation: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string
): Error {
  return new Error([
    `git cat-file ${operation} failed`,
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
