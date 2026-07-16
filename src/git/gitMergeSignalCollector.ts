import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { build as buildBranchComparisonPairs } from "../branches/branchPairBuilder.js"
import type { BranchContext } from "../branches/types.js"
import { collect as collectGitMergeTreeResults } from "./gitMergeTreeCollector.js"
import type {
  GitMergeSignal,
  GitMergeSignalCollectionOptions,
  GitMergeTreePairResult
} from "./types.js"

const execFileAsync = promisify(execFile)

// remote branch를 가져와 merge base, 변경 파일, 가상 merge 결과를 수집
export async function collectGitMergeSignal(
  branch: BranchContext,
  options: GitMergeSignalCollectionOptions
): Promise<GitMergeSignal> {
  const pair = buildBranchComparisonPairs(branch.baseBranch, [branch])[0]

  if (!pair) {
    return failedSignal(branch, "branch comparison pair is missing")
  }

  const results = await collectGitMergeTreeResults([pair], {
    repositoryPath: options.repositoryPath,
    remoteName: options.remoteName
  })

  return collectGitMergeSignalFromPairResult(branch, results[0], options)
}

// 미리 수집한 base 포함 pair 결과를 기존 branch 단위 GitMergeSignal로 변환
export async function collectGitMergeSignalFromPairResult(
  branch: BranchContext,
  pairResult: GitMergeTreePairResult | undefined,
  options: GitMergeSignalCollectionOptions
): Promise<GitMergeSignal> {
  if (!pairResult) {
    return failedSignal(branch, "merge-tree result is missing for branch pair")
  }

  if (!matches(branch, pairResult)) {
    return failedSignal(branch, "merge-tree result does not match branch pair")
  }

  if (pairResult.failureStage === "preparation") {
    return failedSignal(
      branch,
      pairResult.errorMessage ?? "merge-tree preparation failed"
    )
  }

  const remote = options.remoteName ?? "origin"
  const baseRef = `refs/remotes/${remote}/${branch.baseBranch}`
  const headRef = `refs/remotes/${remote}/${branch.name}`
  let mergeBaseSha: string | undefined
  let changedFiles: string[] = []

  try {
    mergeBaseSha = await gitOutput(options.repositoryPath, [
      "merge-base",
      baseRef,
      headRef
    ])
    changedFiles = await gitLines(options.repositoryPath, [
      "diff",
      "--name-only",
      mergeBaseSha,
      headRef
    ])

    return {
      status: pairResult.status,
      baseBranch: branch.baseBranch,
      branchName: branch.name,
      mergeBaseSha,
      changedFiles,
      conflictFiles: pairResult.conflictFiles,
      ...(pairResult.errorMessage
        ? { errorMessage: pairResult.errorMessage }
        : {})
    }
  } catch (error) {
    return {
      status: "merge_check_failed",
      baseBranch: branch.baseBranch,
      branchName: branch.name,
      mergeBaseSha,
      changedFiles,
      conflictFiles: [],
      errorMessage: pairResult.status === "merge_check_failed"
        ? pairResult.errorMessage ?? formatGitError(error)
        : formatGitError(error)
    }
  }
}

// pair 결과가 기존 base와 branch 관계를 나타내는지 확인
function matches(branch: BranchContext, result: GitMergeTreePairResult): boolean {
  const names = new Set([
    result.pair.leftBranchName,
    result.pair.rightBranchName
  ])

  return names.size === 2 &&
    names.has(branch.baseBranch) &&
    names.has(branch.name)
}

// pair를 구성하거나 찾지 못한 branch를 기존 실패 signal로 표현
function failedSignal(branch: BranchContext, errorMessage: string): GitMergeSignal {
  return {
    status: "merge_check_failed",
    baseBranch: branch.baseBranch,
    branchName: branch.name,
    changedFiles: [],
    conflictFiles: [],
    errorMessage
  }
}

// git stdout을 비어 있지 않은 line 목록으로 변환
async function gitLines(cwd: string, args: string[]): Promise<string[]> {
  const output = await gitOutput(cwd, args)
  return output.split("\n").filter(line => line.length)
}

// git command 성공 stdout을 반환하고 실패 결과를 오류로 변환
async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await gitResult(cwd, args)

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`)
  }

  return result.stdout.trim()
}

// git command를 실행하고 성공과 실패를 동일한 결과 구조로 정규화
async function gitResult(
  cwd: string,
  args: string[]
): Promise<{ exitCode: number, stdout: string, stderr: string }> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    })

    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr
    }
  } catch (error) {
    const gitError = error as {
      code?: number | string
      stdout?: string
      stderr?: string
      message?: string
    }

    return {
      exitCode: typeof gitError.code === "number" ? gitError.code : 1,
      stdout: gitError.stdout ?? "",
      stderr: gitError.stderr ?? gitError.message ?? ""
    }
  }
}

// unknown git 오류를 signal에 기록할 문자열로 변환
function formatGitError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim()
  }

  if (typeof error === "string") {
    return error.trim()
  }

  return "unknown git error"
}
