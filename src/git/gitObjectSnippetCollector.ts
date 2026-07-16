import { TextDecoder } from "node:util"
import type {
  GitObjectCheck,
  GitObjectContentConsumer
} from "./gitObjectBatchProcess.js"
import type {
  GitObjectSnippetRequest,
  MergeCodeContextSnippet
} from "./types.js"

const SNIPPET_MAX_BYTES = 32 * 1024
export const SNIPPET_MAX_LINES = 400

// object별 streaming 수집기를 전환하며 결과 map을 구성
export class GitObjectSnippetStream implements GitObjectContentConsumer {
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

export function unavailableSnippet(
  request: GitObjectSnippetRequest
): MergeCodeContextSnippet {
  return {
    status: "missing",
    filePath: request.filePath,
    truncated: false
  }
}
