import type {
  GitObjectCheck,
  GitObjectContentConsumer
} from "./gitObjectBatchProcess.js"
import type { MergeCodeContextLineRange } from "./types.js"

// object별 conflict marker 수집기를 전환하며 결과 map을 구성
export class GitObjectConflictMarkerStream implements GitObjectContentConsumer {
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
