import type { BranchComparisonPair } from "../branches/types.js"
import type {
  GitMergeSignalStatus,
  GitMergeTreeConflict,
  GitMergeTreePairResult
} from "./types.js"

type ParserState =
  | "status"
  | "merged_tree_oid"
  | "conflict_files"
  | "message_path_count"
  | "message_paths"
  | "message_type"
  | "message_text"

// git merge-tree --stdin -z 출력을 chunk 경계와 무관하게 조합별 결과로 해석
export class MergeTreeOutputParser {
  private readonly pairs: BranchComparisonPair[]
  private readonly results: GitMergeTreePairResult[] = []
  private pendingChunks: Buffer[] = []
  private pendingLength = 0
  private state: ParserState = "status"
  private pairIndex = 0
  private status?: GitMergeSignalStatus
  private mergedTreeOid?: string
  private conflictFiles: string[] = []
  private conflicts: GitMergeTreeConflict[] = []
  private messagePathCount = 0
  private messagePaths: string[] = []
  private messageType?: string

  constructor(pairs: BranchComparisonPair[]) {
    this.pairs = pairs
  }

  push(chunk: Buffer): void {
    if (!chunk.length) {
      return
    }

    let start = 0
    let end = chunk.indexOf(0, start)

    while (end !== -1) {
      const segment = chunk.subarray(start, end)
      const token = this.pendingChunks.length
        ? Buffer.concat(
          [...this.pendingChunks, segment],
          this.pendingLength + segment.length
        )
        : segment

      this.consume(token.toString("utf8"))
      this.pendingChunks = []
      this.pendingLength = 0
      start = end + 1
      end = chunk.indexOf(0, start)
    }

    if (start < chunk.length) {
      const segment = chunk.subarray(start)

      this.pendingChunks.push(segment)
      this.pendingLength += segment.length
    }
  }

  finish(): GitMergeTreePairResult[] {
    if (this.pendingLength) {
      throw this.error(`truncated token while reading ${this.state}`)
    }

    if (this.state !== "status") {
      throw this.error(`truncated result while reading ${this.state}`)
    }

    if (this.pairIndex !== this.pairs.length) {
      throw this.error(
        `expected ${this.pairs.length} results but received ${this.pairIndex}`
      )
    }

    return [...this.results]
  }

  private consume(token: string): void {
    switch (this.state) {
      case "status":
        this.consumeStatus(token)
        return
      case "merged_tree_oid":
        this.consumeMergedTreeOid(token)
        return
      case "conflict_files":
        this.consumeConflictFile(token)
        return
      case "message_path_count":
        this.consumeMessagePathCount(token)
        return
      case "message_paths":
        this.messagePaths.push(token)

        if (this.messagePaths.length === this.messagePathCount) {
          this.state = "message_type"
        }
        return
      case "message_type":
        this.messageType = token
        this.state = "message_text"
        return
      case "message_text":
        this.consumeMessageText()
        return
    }
  }

  private consumeStatus(token: string): void {
    if (this.pairIndex === this.pairs.length) {
      throw this.error("received more results than expected")
    }

    if (token === "1") {
      this.status = "clean"
    } else if (token === "0") {
      this.status = "confirmed_conflict"
    } else {
      throw this.error(`invalid merge status ${JSON.stringify(token)}`)
    }

    this.state = "merged_tree_oid"
  }

  private consumeMergedTreeOid(token: string): void {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(token)) {
      throw this.error(`invalid merged tree OID ${JSON.stringify(token)}`)
    }

    this.mergedTreeOid = token
    this.state = "conflict_files"
  }

  private consumeConflictFile(token: string): void {
    if (token.length) {
      if (this.status === "clean") {
        throw this.error(`clean result contained conflict file ${JSON.stringify(token)}`)
      }

      this.conflictFiles.push(token)
      return
    }

    this.state = "message_path_count"
  }

  private consumeMessagePathCount(token: string): void {
    if (!token.length) {
      this.completeResult()
      return
    }

    if (!/^\d+$/.test(token)) {
      throw this.error(`invalid message path count ${JSON.stringify(token)}`)
    }

    this.messagePathCount = Number(token)
    this.messagePaths = []
    this.state = this.messagePathCount === 0
      ? "message_type"
      : "message_paths"
  }

  private consumeMessageText(): void {
    if (this.messageType?.startsWith("CONFLICT")) {
      this.conflicts.push({
        paths: [...this.messagePaths],
        type: this.messageType
      })
    }

    this.messagePathCount = 0
    this.messagePaths = []
    this.messageType = undefined
    this.state = "message_path_count"
  }

  private completeResult(): void {
    const pair = this.pairs[this.pairIndex]

    if (!pair || !this.status || !this.mergedTreeOid) {
      throw this.error("incomplete merge result")
    }

    this.results.push({
      pair,
      status: this.status,
      mergedTreeOid: this.mergedTreeOid,
      conflictFiles: [...this.conflictFiles],
      conflicts: [...this.conflicts]
    })
    this.pairIndex += 1
    this.status = undefined
    this.mergedTreeOid = undefined
    this.conflictFiles = []
    this.conflicts = []
    this.messagePathCount = 0
    this.messagePaths = []
    this.messageType = undefined
    this.state = "status"
  }

  private error(message: string): Error {
    return new Error(`Invalid merge-tree output at pair ${this.pairIndex}: ${message}`)
  }
}
