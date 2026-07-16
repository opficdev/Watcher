import { spawn } from "node:child_process"
import type { BranchComparisonRound } from "../branches/types.js"
import { MergeTreeOutputParser } from "./mergeTreeOutputParser.js"
import type {
  GitMergeTreePairResult,
  GitMergeTreeRoundCollectionOptions
} from "./types.js"

const DEFAULT_STDERR_LIMIT = 16 * 1024

// 한 라운드의 commit OID 조합을 하나의 git merge-tree process에서 수집
export async function collect(
  round: BranchComparisonRound,
  options: GitMergeTreeRoundCollectionOptions
): Promise<GitMergeTreePairResult[]> {
  if (!round.pairs.length) {
    return []
  }

  const input = `${round.pairs.map(pair => [
    oidFor(pair.leftBranchName, options.commitOidByBranch),
    oidFor(pair.rightBranchName, options.commitOidByBranch)
  ].join(" ")).join("\n")}\n`
  const parser = new MergeTreeOutputParser(round.pairs)
  const stderrLimit = options.stderrLimit ?? DEFAULT_STDERR_LIMIT

  return new Promise((resolve, reject) => {
    const child = spawn("git", [
      "merge-tree",
      "--stdin",
      "--name-only",
      "--messages"
    ], {
      cwd: options.repositoryPath,
      stdio: ["pipe", "pipe", "pipe"]
    })
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
      const remaining = stderrLimit - stderrLength

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
      const stderr = Buffer.concat(stderrChunks, stderrLength).toString("utf8").trim()

      if (code !== 0) {
        reject(new Error([
          `git merge-tree failed for round ${round.roundIndex}`,
          code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`,
          stderr
        ].filter(Boolean).join(": ")))
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
        resolve(parser.finish())
      } catch (error) {
        reject(errorFor(error))
      }
    })

    child.stdin.end(input)
  })
}

// branch 이름에 대응하는 고정 commit OID를 반환
function oidFor(name: string, commitOidByBranch: ReadonlyMap<string, string>): string {
  const oid = commitOidByBranch.get(name)

  if (!oid) {
    throw new Error(`Missing commit OID for branch ${name}`)
  }

  return oid
}

// unknown 오류를 호출자가 진단 가능한 Error로 정규화
function errorFor(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
