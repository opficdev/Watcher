import { spawn } from "node:child_process"
import { TextDecoder } from "node:util"
import type {
  GitObjectSnippetRequest,
  MergeCodeContextLineRange,
  MergeCodeContextSnippet
} from "./types.js"

const STDERR_LIMIT = 16 * 1024
const CHECK_OUTPUT_LIMIT = 16 * 1024 * 1024
const SNIPPET_MAX_BYTES = 32 * 1024
const SNIPPET_MAX_LINES = 400

type GitObjectRequestGroup = {
  objectSpec: string
  requests: GitObjectSnippetRequest[]
}

type GitObjectCheck = {
  group: GitObjectRequestGroup
  objectType?: string
  byteLength?: number
}

type GitObjectContentConsumer = {
  start(check: GitObjectCheck): void
  push(content: Buffer): void
  finish(): void
}

// 여러 Git object의 file 내용을 checkout 없이 묶음 조회
export async function readGitObjectSnippets(
  requests: GitObjectSnippetRequest[],
  options: { repositoryPath: string }
): Promise<ReadonlyMap<string, MergeCodeContextSnippet>> {
  if (!requests.length) {
    return new Map()
  }

  validateRequests(requests)
  const groups = groupRequests(requests)
  const checks = await checkObjects(groups, options.repositoryPath)
  const snippets = new Map<string, MergeCodeContextSnippet>()
  const readable = checks.filter(check => check.objectType === "blob")

  for (const check of checks) {
    if (check.objectType === "blob") {
      continue
    }

    for (const request of check.group.requests) {
      snippets.set(request.key, unavailableSnippet(request))
    }
  }

  await readObjects(
    readable,
    options.repositoryPath,
    new GitObjectSnippetStream(snippets)
  )

  return snippets
}

// merged object를 흘려 읽으며 conflict marker block의 line range만 수집
export async function readGitObjectConflictMarkerRanges(
  requests: GitObjectSnippetRequest[],
  options: { repositoryPath: string }
): Promise<ReadonlyMap<string, MergeCodeContextLineRange[]>> {
  if (!requests.length) {
    return new Map()
  }

  validateRequests(requests)
  const groups = groupRequests(requests)
  const checks = await checkObjects(groups, options.repositoryPath)
  const ranges = new Map<string, MergeCodeContextLineRange[]>()
  const readable = checks.filter(check => check.objectType === "blob")

  for (const check of checks) {
    if (check.objectType === "blob") {
      continue
    }

    for (const request of check.group.requests) {
      ranges.set(request.key, [])
    }
  }

  await readObjects(
    readable,
    options.repositoryPath,
    new GitObjectConflictMarkerStream(ranges)
  )

  return ranges
}

// 요청 key, OID, line range가 묶음 protocol에 안전한지 확인
function validateRequests(requests: GitObjectSnippetRequest[]): void {
  const keys = new Set<string>()

  for (const request of requests) {
    if (keys.has(request.key)) {
      throw new Error(`Duplicate Git object snippet key: ${request.key}`)
    }

    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(request.objectOid)) {
      throw new Error(`Invalid Git object OID for key ${request.key}`)
    }

    if (request.filePath.includes("\u0000")) {
      throw new Error(`Invalid Git object path for key ${request.key}`)
    }

    if (
      request.range.startLine < 1 ||
      request.range.endLine < request.range.startLine ||
      SNIPPET_MAX_LINES < request.range.endLine - request.range.startLine + 1
    ) {
      throw new Error(`Invalid Git object line range for key ${request.key}`)
    }

    keys.add(request.key)
  }
}

// 같은 object와 file 조합을 한 번만 읽도록 요청을 묶음
function groupRequests(
  requests: GitObjectSnippetRequest[]
): GitObjectRequestGroup[] {
  const groupsBySpec = new Map<string, GitObjectRequestGroup>()

  for (const request of requests) {
    const objectSpec = `${request.objectOid}:${request.filePath}`
    const group = groupsBySpec.get(objectSpec)

    if (group) {
      group.requests.push(request)
    } else {
      groupsBySpec.set(objectSpec, {
        objectSpec,
        requests: [request]
      })
    }
  }

  return [...groupsBySpec.values()]
}

// object 존재 여부와 종류, 크기를 작은 응답으로 먼저 확인
async function checkObjects(
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
async function readObjects(
  checks: GitObjectCheck[],
  repositoryPath: string,
  consumer: GitObjectContentConsumer
): Promise<void> {
  if (!checks.length) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["cat-file", "--batch", "-Z"], {
      cwd: repositoryPath,
      stdio: ["pipe", "pipe", "pipe"]
    })
    const parser = new GitBatchContentParser(checks, consumer)
    const stderrChunks: Buffer[] = []
    let stderrLength = 0
    let parserError: unknown
    let inputError: unknown
    let settled = false

    child.stdout.on("data", (chunk: Buffer) => {
      if (parserError) {
        return
      }

      try {
        parser.push(chunk)
      } catch (error) {
        parserError = error
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
        reject(gitError("batch", code, signal, stderr))
        return
      }

      if (inputError) {
        reject(errorFor(inputError))
        return
      }

      if (parserError) {
        reject(errorFor(parserError))
        return
      }

      try {
        parser.finish()
        resolve()
      } catch (error) {
        reject(errorFor(error))
      }
    })

    child.stdin.end(batchInput(checks.map(check => check.group)))
  })
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

// batch-check의 작은 응답을 크기 제한 안에서 수집
async function collectGitOutput(
  args: string[],
  input: Buffer,
  repositoryPath: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repositoryPath,
      stdio: ["pipe", "pipe", "pipe"]
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutLength = 0
    let stderrLength = 0
    let outputError: Error | undefined
    let inputError: unknown
    let settled = false

    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = CHECK_OUTPUT_LIMIT - stdoutLength

      if (remaining <= 0) {
        outputError ??= new Error("git cat-file batch-check output limit exceeded")
        return
      }

      const captured = chunk.subarray(0, remaining)

      stdoutChunks.push(captured)
      stdoutLength += captured.length

      if (captured.length !== chunk.length) {
        outputError ??= new Error("git cat-file batch-check output limit exceeded")
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
        reject(gitError("batch-check", code, signal, stderr))
        return
      }

      if (inputError) {
        reject(errorFor(inputError))
        return
      }

      if (outputError) {
        reject(outputError)
        return
      }

      resolve(Buffer.concat(stdoutChunks, stdoutLength))
    })

    child.stdin.end(input)
  })
}

// NUL로 끝나는 batch-check record를 순서대로 분리
function nulRecords(output: Buffer): string[] {
  if (!output.length || output[output.length - 1] !== 0) {
    throw new Error("Incomplete git cat-file batch-check response")
  }

  return output.subarray(0, -1).toString("utf8").split("\u0000")
}

// object별 streaming 수집기를 전환하며 결과 map을 구성
class GitObjectSnippetStream implements GitObjectContentConsumer {
  private collector: GitObjectContentCollector | undefined

  constructor(
    private readonly snippets: Map<string, MergeCodeContextSnippet>
  ) {}

  start(check: GitObjectCheck): void {
    if (this.collector) {
      throw new Error("Overlapping git cat-file object content")
    }

    this.collector = new GitObjectContentCollector(check)
  }

  push(content: Buffer): void {
    if (!this.collector) {
      throw new Error("Missing git cat-file object collector")
    }

    this.collector.push(content)
  }

  finish(): void {
    if (!this.collector) {
      throw new Error("Missing git cat-file object collector")
    }

    for (const [key, snippet] of this.collector.finish()) {
      this.snippets.set(key, snippet)
    }

    this.collector = undefined
  }
}

// object별 conflict marker 수집기를 전환하며 결과 map을 구성
class GitObjectConflictMarkerStream implements GitObjectContentConsumer {
  private check: GitObjectCheck | undefined
  private collector: GitObjectConflictMarkerCollector | undefined

  constructor(
    private readonly ranges: Map<string, MergeCodeContextLineRange[]>
  ) {}

  start(check: GitObjectCheck): void {
    if (this.collector) {
      throw new Error("Overlapping git cat-file conflict marker content")
    }

    this.check = check
    this.collector = new GitObjectConflictMarkerCollector()
  }

  push(content: Buffer): void {
    if (!this.collector) {
      throw new Error("Missing git conflict marker collector")
    }

    this.collector.push(content)
  }

  finish(): void {
    if (!this.check || !this.collector) {
      throw new Error("Missing git conflict marker collector")
    }

    const ranges = this.collector.finish()

    for (const request of this.check.group.requests) {
      this.ranges.set(request.key, ranges)
    }

    this.check = undefined
    this.collector = undefined
  }
}

// raw blob에서 line 접두사만 보관해 완성된 conflict marker 범위를 계산
class GitObjectConflictMarkerCollector {
  private readonly ranges: MergeCodeContextLineRange[] = []
  private lineNumber = 1
  private linePrefix = Buffer.alloc(0)
  private startLine: number | undefined
  private binary = false

  push(content: Buffer): void {
    if (this.binary) {
      return
    }

    if (content.includes(0)) {
      this.binary = true
      return
    }

    let offset = 0
    let newline = content.indexOf(10, offset)

    while (newline >= 0) {
      this.pushLinePrefix(content.subarray(offset, newline))
      this.finishLine()
      offset = newline + 1
      newline = content.indexOf(10, offset)
    }

    if (offset < content.length) {
      this.pushLinePrefix(content.subarray(offset))
    }
  }

  finish(): MergeCodeContextLineRange[] {
    if (this.binary) {
      return []
    }

    if (this.linePrefix.length) {
      this.finishLine()
    }

    return [...this.ranges]
  }

  private pushLinePrefix(content: Buffer): void {
    const remaining = 16 - this.linePrefix.length

    if (remaining <= 0) {
      return
    }

    this.linePrefix = Buffer.concat([
      this.linePrefix,
      content.subarray(0, remaining)
    ])
  }

  private finishLine(): void {
    const prefix = this.linePrefix.toString("ascii")

    if (prefix.startsWith("<<<<<<< ")) {
      this.startLine = this.lineNumber
    } else if (
      this.startLine !== undefined &&
      prefix.startsWith(">>>>>>> ")
    ) {
      this.ranges.push({
        startLine: this.startLine,
        endLine: this.lineNumber
      })
      this.startLine = undefined
    }

    this.lineNumber += 1
    this.linePrefix = Buffer.alloc(0)
  }
}

// 작은 object만 전체 보관하고 큰 object는 선택 line만 streaming 보관
class GitObjectContentCollector {
  private readonly storesWholeContent: boolean
  private readonly contentChunks: Buffer[] = []
  private readonly decoder = new TextDecoder("utf-8", { fatal: true })
  private readonly lineCollectors: GitObjectLineRangeCollector[]
  private contentLength = 0
  private currentLine = 1
  private endedWithNewline = false
  private binary = false

  constructor(private readonly check: GitObjectCheck) {
    if (check.byteLength === undefined) {
      throw new Error("Missing Git object byte length")
    }

    this.storesWholeContent = check.byteLength <= SNIPPET_MAX_BYTES
    this.lineCollectors = check.group.requests.map(request =>
      new GitObjectLineRangeCollector(request)
    )
  }

  push(content: Buffer): void {
    if (this.storesWholeContent) {
      this.contentChunks.push(content)
      this.contentLength += content.length
      return
    }

    if (this.binary) {
      return
    }

    if (content.includes(0)) {
      this.binary = true
      return
    }

    try {
      this.pushDecoded(this.decoder.decode(content, { stream: true }))
    } catch {
      this.binary = true
    }
  }

  finish(): Array<[string, MergeCodeContextSnippet]> {
    if (this.storesWholeContent) {
      return this.finishWholeContent()
    }

    if (!this.binary) {
      try {
        this.pushDecoded(this.decoder.decode())
      } catch {
        this.binary = true
      }
    }

    if (this.binary) {
      return this.check.group.requests.map(request => [
        request.key,
        binarySnippet(request)
      ])
    }

    const byteLength = this.check.byteLength ?? 0
    const lineCount = byteLength === 0
      ? 1
      : this.endedWithNewline
        ? Math.max(1, this.currentLine - 1)
        : this.currentLine

    return this.lineCollectors.map(collector => [
      collector.request.key,
      collector.snippet(lineCount)
    ])
  }

  private finishWholeContent(): Array<[string, MergeCodeContextSnippet]> {
    const content = Buffer.concat(this.contentChunks, this.contentLength)
    const decoded = decodeText(content)

    if (decoded === undefined) {
      return this.check.group.requests.map(request => [
        request.key,
        binarySnippet(request)
      ])
    }

    const text = splitText(decoded)

    return this.check.group.requests.map(request => [
      request.key,
      wholeTextSnippet(request, decoded, text)
    ])
  }

  private pushDecoded(content: string): void {
    let offset = 0

    while (offset < content.length) {
      const newline = content.indexOf("\n", offset)

      if (newline < 0) {
        this.pushLineContent(content.slice(offset))
        this.endedWithNewline = false
        return
      }

      this.pushLineContent(content.slice(offset, newline))
      this.currentLine += 1
      this.endedWithNewline = true
      offset = newline + 1
    }
  }

  private pushLineContent(content: string): void {
    for (const collector of this.lineCollectors) {
      collector.push(this.currentLine, content)
    }
  }
}

// 한 요청의 line range만 UTF-8 byte 상한 안에서 누적
class GitObjectLineRangeCollector {
  readonly request: GitObjectSnippetRequest
  private readonly contentChunks: string[] = []
  private contentLength = 0
  private firstLine: number | undefined
  private lastLine: number | undefined
  private activeLine: number | undefined
  private byteTruncated = false

  constructor(request: GitObjectSnippetRequest) {
    this.request = request
  }

  push(lineNumber: number, content: string): void {
    if (
      lineNumber < this.request.range.startLine ||
      this.request.range.endLine < lineNumber
    ) {
      return
    }

    if (this.activeLine !== lineNumber) {
      if (this.firstLine !== undefined && !this.append("\n")) {
        return
      }

      this.firstLine ??= lineNumber
      this.lastLine = lineNumber
      this.activeLine = lineNumber
    }

    this.append(content)
  }

  snippet(lineCount: number): MergeCodeContextSnippet {
    const fallbackLine = Math.max(
      1,
      Math.min(this.request.range.startLine, lineCount)
    )

    return {
      status: "text",
      filePath: this.request.filePath,
      content: this.contentChunks.join(""),
      startLine: this.firstLine ?? fallbackLine,
      endLine: this.lastLine ?? fallbackLine,
      truncated:
        this.byteTruncated ||
        this.firstLine !== 1 ||
        this.lastLine !== lineCount
    }
  }

  private append(content: string): boolean {
    if (this.byteTruncated) {
      return false
    }

    if (!content.length) {
      return true
    }

    const remaining = SNIPPET_MAX_BYTES - this.contentLength

    if (remaining <= 0) {
      this.byteTruncated = true
      return false
    }

    const byteLength = Buffer.byteLength(content)

    if (byteLength <= remaining) {
      this.contentChunks.push(content)
      this.contentLength += byteLength
      return true
    }

    const prefix = utf8Prefix(content, remaining)

    if (prefix) {
      this.contentChunks.push(prefix)
      this.contentLength += Buffer.byteLength(prefix)
    }

    this.byteTruncated = true
    return false
  }
}

type SplitText = {
  lines: string[]
  endsWithNewline: boolean
}

// NUL이나 잘못된 UTF-8을 binary로 분류
function decodeText(content: Buffer): string | undefined {
  if (content.includes(0)) {
    return undefined
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content)
  } catch {
    return undefined
  }
}

// 마지막 개행을 가상 line으로 세지 않고 text를 분리
function splitText(content: string): SplitText {
  const endsWithNewline = content.endsWith("\n")
  const body = endsWithNewline ? content.slice(0, -1) : content

  return {
    lines: body.length ? body.split("\n") : [""],
    endsWithNewline
  }
}

// 작은 file은 전체를, 400줄 초과 file은 요청 범위만 반환
function wholeTextSnippet(
  request: GitObjectSnippetRequest,
  content: string,
  text: SplitText
): MergeCodeContextSnippet {
  if (text.lines.length <= SNIPPET_MAX_LINES) {
    return {
      status: "text",
      filePath: request.filePath,
      content,
      startLine: 1,
      endLine: text.lines.length,
      truncated: false
    }
  }

  const startLine = Math.min(request.range.startLine, text.lines.length)
  const endLine = Math.max(
    startLine,
    Math.min(request.range.endLine, text.lines.length)
  )
  let selected = text.lines.slice(startLine - 1, endLine).join("\n")

  if (text.endsWithNewline && endLine === text.lines.length) {
    selected += "\n"
  }

  return {
    status: "text",
    filePath: request.filePath,
    content: selected,
    startLine,
    endLine,
    truncated: startLine !== 1 || endLine !== text.lines.length
  }
}

// UTF-8 문자를 자르지 않고 byte 상한 안의 접두사 반환
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

function binarySnippet(
  request: GitObjectSnippetRequest
): MergeCodeContextSnippet {
  return {
    status: "binary",
    filePath: request.filePath,
    truncated: false
  }
}

function unavailableSnippet(
  request: GitObjectSnippetRequest
): MergeCodeContextSnippet {
  return {
    status: "missing",
    filePath: request.filePath,
    truncated: false
  }
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
