import { execFile, spawn } from "node:child_process"
import { availableParallelism } from "node:os"
import { promisify } from "node:util"
import { compareBranchNames } from "../branches/branchPairBuilder.js"
import { build as buildBranchComparisonRounds } from "../branches/branchRoundBuilder.js"
import type {
  BranchComparisonPair,
  BranchComparisonRound
} from "../branches/types.js"
import { collect as collectGitMergeTreeRound } from "./gitMergeTreeRoundCollector.js"
import type {
  GitMergeTreeCollectionOptions,
  GitMergeTreeCollectorDependencies,
  GitMergeTreePairResult
} from "./types.js"

const execFileAsync = promisify(execFile)
const MAX_PARALLEL_ROUNDS = 4
const MAX_ERROR_MESSAGE_LENGTH = 16 * 1024

const defaultDependencies: GitMergeTreeCollectorDependencies = {
  fetchRemoteBranches,
  resolveCommitOids,
  supportsMergeTreeStdin,
  collectRound: collectGitMergeTreeRound,
  availableParallelism
}

// 모든 branch 조합을 제한된 라운드 병렬 실행으로 수집하고 입력 순서로 복원
export async function collect(
  pairs: BranchComparisonPair[],
  options: GitMergeTreeCollectionOptions,
  dependencyOverrides: Partial<GitMergeTreeCollectorDependencies> = {}
): Promise<GitMergeTreePairResult[]> {
  if (!pairs.length) {
    return []
  }

  const dependencies = {
    ...defaultDependencies,
    ...dependencyOverrides
  }
  const remote = options.remoteName ?? "origin"

  try {
    await dependencies.fetchRemoteBranches(options.repositoryPath, remote)
  } catch {
    return pairs.map(pair => failedResult(
      pair,
      `git fetch failed for remote ${remote}`,
      "preparation"
    ))
  }

  const branchNames = [...new Set(pairs.flatMap(pair => [
    pair.leftBranchName,
    pair.rightBranchName
  ]))].sort(compareBranchNames)
  let commitOidByBranch: ReadonlyMap<string, string>

  try {
    commitOidByBranch = await dependencies.resolveCommitOids(
      options.repositoryPath,
      remote,
      branchNames
    )
  } catch {
    return pairs.map(pair => failedResult(
      pair,
      "git remote ref resolution failed",
      "preparation"
    ))
  }

  const resultByKey = new Map<string, GitMergeTreePairResult>()
  const resolvedPairs = pairs.filter(pair => {
    const missing = [pair.leftBranchName, pair.rightBranchName]
      .filter(name => !commitOidByBranch.has(name))

    if (!missing.length) {
      return true
    }

    resultByKey.set(keyFor(pair), failedResult(
      pair,
      `Missing remote branch commit OID: ${missing.join(", ")}`,
      "preparation"
    ))
    return false
  })

  if (!resolvedPairs.length) {
    return resultsInInputOrder(pairs, resultByKey)
  }

  let supported: boolean

  try {
    supported = await dependencies.supportsMergeTreeStdin(options.repositoryPath)
  } catch {
    supported = false
  }

  if (!supported) {
    const message = "git merge-tree --stdin is not supported by the installed Git version"

    for (const pair of resolvedPairs) {
      resultByKey.set(keyFor(pair), failedResult(pair, message, "preparation"))
    }

    return resultsInInputOrder(pairs, resultByKey)
  }

  const rounds = buildBranchComparisonRounds(resolvedPairs)
  let nextRoundIndex = 0
  const workerCount = Math.min(
    rounds.length,
    MAX_PARALLEL_ROUNDS,
    Math.max(1, dependencies.availableParallelism())
  )

  async function runNextRound(): Promise<void> {
    while (nextRoundIndex < rounds.length) {
      const round = rounds[nextRoundIndex]

      nextRoundIndex += 1

      if (!round) {
        return
      }

      const results = await collectWithFailureIsolation(round, {
        repositoryPath: options.repositoryPath,
        commitOidByBranch,
        stderrLimit: options.stderrLimit
      }, dependencies.collectRound)

      for (const result of results) {
        resultByKey.set(keyFor(result.pair), result)
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runNextRound))

  return resultsInInputOrder(pairs, resultByKey)
}

// 실패한 라운드만 절반으로 나눠 단일 조합 오류까지 격리
async function collectWithFailureIsolation(
  round: BranchComparisonRound,
  options: {
    repositoryPath: string
    commitOidByBranch: ReadonlyMap<string, string>
    stderrLimit?: number
  },
  collectRound: GitMergeTreeCollectorDependencies["collectRound"]
): Promise<GitMergeTreePairResult[]> {
  try {
    return await collectRound(round, options)
  } catch (error) {
    if (round.pairs.length === 1) {
      return [failedResult(round.pairs[0]!, errorMessageFor(error), "merge")]
    }

    const middle = Math.ceil(round.pairs.length / 2)
    const results: GitMergeTreePairResult[] = []

    for (const pairs of [
      round.pairs.slice(0, middle),
      round.pairs.slice(middle)
    ]) {
      results.push(...await collectWithFailureIsolation({
        roundIndex: round.roundIndex,
        pairs
      }, options, collectRound))
    }

    return results
  }
}

// 비교할 remote tracking ref를 한 번의 fetch로 갱신
async function fetchRemoteBranches(
  repositoryPath: string,
  remote: string
): Promise<void> {
  await execFileAsync("git", [
    "fetch",
    "--quiet",
    "--prune",
    remote,
    `+refs/heads/*:refs/remotes/${remote}/*`
  ], {
    cwd: repositoryPath,
    maxBuffer: 1024 * 1024
  })
}

// remote tracking ref 이름을 해당 실행에서 고정할 commit OID로 변환
async function resolveCommitOids(
  repositoryPath: string,
  remote: string,
  branchNames: string[]
): Promise<ReadonlyMap<string, string>> {
  const result = await execFileAsync("git", [
    "for-each-ref",
    `refs/remotes/${remote}`,
    "--format=%(refname)%09%(objectname)"
  ], {
    cwd: repositoryPath,
    maxBuffer: 1024 * 1024
  })
  const prefix = `refs/remotes/${remote}/`
  const requested = new Set(branchNames)
  const commitOidByBranch = new Map<string, string>()

  for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
    const [ref, oid] = line.split("\t")

    if (!ref?.startsWith(prefix) || !oid) {
      continue
    }

    const name = ref.slice(prefix.length)

    if (requested.has(name)) {
      commitOidByBranch.set(name, oid)
    }
  }

  return commitOidByBranch
}

// 빈 표준 입력으로 merge-tree --stdin 지원 여부를 한 번 확인
async function supportsMergeTreeStdin(repositoryPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn("git", [
      "merge-tree",
      "--stdin",
      "--name-only",
      "--messages"
    ], {
      cwd: repositoryPath,
      stdio: ["pipe", "ignore", "ignore"]
    })
    let settled = false

    child.stdin.on("error", () => {})
    child.on("error", () => {
      if (!settled) {
        settled = true
        resolve(false)
      }
    })
    child.on("close", code => {
      if (!settled) {
        settled = true
        resolve(code === 0)
      }
    })
    child.stdin.end()
  })
}

// 모든 조합 결과를 원래 #42 조합 배열 순서로 복원
function resultsInInputOrder(
  pairs: BranchComparisonPair[],
  resultByKey: ReadonlyMap<string, GitMergeTreePairResult>
): GitMergeTreePairResult[] {
  return pairs.map(pair => resultByKey.get(keyFor(pair)) ?? failedResult(
    pair,
    "merge-tree result missing for pair",
    "merge"
  ))
}

// 실행하지 못한 조합을 기존 merge 실패 상태와 같은 형태로 구성
function failedResult(
  pair: BranchComparisonPair,
  errorMessage: string,
  failureStage: "preparation" | "merge"
): GitMergeTreePairResult {
  return {
    pair,
    status: "merge_check_failed",
    conflictFiles: [],
    conflicts: [],
    errorMessage: errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    failureStage
  }
}

// 조합 방향과 무관한 결과 식별자를 구성
function keyFor(pair: BranchComparisonPair): string {
  const names = [pair.leftBranchName, pair.rightBranchName].sort(compareBranchNames)

  return `${names[0]}\u0000${names[1]}`
}

// unknown 오류를 제한된 진단 문자열로 변환
function errorMessageFor(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .slice(0, MAX_ERROR_MESSAGE_LENGTH)
}
