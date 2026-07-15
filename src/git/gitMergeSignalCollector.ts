import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { BranchContext } from "../branches/types.js"
import type { GitMergeSignal, GitMergeSignalCollectionOptions } from "./types.js"

const execFileAsync = promisify(execFile)

// remote branch를 가져와 merge base, 변경 파일, 가상 merge 결과를 수집
export async function collectGitMergeSignal(
  branch: BranchContext,
  options: GitMergeSignalCollectionOptions
): Promise<GitMergeSignal> {
  const remote = options.remoteName ?? "origin"
  const baseRef = `refs/remotes/${remote}/${branch.baseBranch}`
  const headRef = `refs/remotes/${remote}/${branch.name}`
  let mergeBaseSha: string | undefined
  let changedFiles: string[] = []

  try {
    // remote tracking ref 기준으로 base/head를 맞춘 뒤 merge signal을 계산
    await fetchBranch(options.repositoryPath, remote, branch.baseBranch)
    await fetchBranch(options.repositoryPath, remote, branch.name)

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

    return await runVirtualMerge({
      branch,
      options,
      baseRef,
      headRef,
      mergeBaseSha,
      changedFiles
    })
  } catch (error) {
    return {
      status: "merge_check_failed",
      baseBranch: branch.baseBranch,
      branchName: branch.name,
      mergeBaseSha,
      changedFiles,
      conflictFiles: [],
      errorMessage: formatGitError(error)
    }
  }
}

// 임시 worktree에서 merge를 시도해 repository 변경 없이 충돌 여부를 확인
async function runVirtualMerge(input: {
  branch: BranchContext
  options: GitMergeSignalCollectionOptions
  baseRef: string
  headRef: string
  mergeBaseSha: string
  changedFiles: string[]
}): Promise<GitMergeSignal> {
  // 실제 repository 상태를 더럽히지 않도록 임시 worktree에서 virtual merge 수행
  const root = await mkdtemp(join(input.options.worktreeRoot ?? tmpdir(), "watcher-merge-"))
  const worktree = join(root, "worktree")

  try {
    await gitOutput(input.options.repositoryPath, [
      "worktree",
      "add",
      "--detach",
      worktree,
      input.baseRef
    ])

    try {
      const merge = await gitResult(worktree, [
        "merge",
        "--no-commit",
        "--no-ff",
        input.headRef
      ])

      if (merge.exitCode === 0) {
        return {
          status: "clean",
          baseBranch: input.branch.baseBranch,
          branchName: input.branch.name,
          mergeBaseSha: input.mergeBaseSha,
          changedFiles: input.changedFiles,
          conflictFiles: []
        }
      }

      const conflictFiles = await gitLines(worktree, [
        "diff",
        "--name-only",
        "--diff-filter=U"
      ])

      if (0 < conflictFiles.length) {
        return {
          status: "confirmed_conflict",
          baseBranch: input.branch.baseBranch,
          branchName: input.branch.name,
          mergeBaseSha: input.mergeBaseSha,
          changedFiles: input.changedFiles,
          conflictFiles
        }
      }

      return {
        status: "merge_check_failed",
        baseBranch: input.branch.baseBranch,
        branchName: input.branch.name,
        mergeBaseSha: input.mergeBaseSha,
        changedFiles: input.changedFiles,
        conflictFiles: [],
        errorMessage: formatGitError(merge.stderr)
      }
    } finally {
      await gitResult(input.options.repositoryPath, [
        "worktree",
        "remove",
        "--force",
        worktree
      ])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// 지정 branch의 최신 remote ref를 로컬 remote tracking ref로 갱신
async function fetchBranch(
  repositoryPath: string,
  remote: string,
  branchName: string
): Promise<void> {
  await gitOutput(repositoryPath, [
    "fetch",
    "--quiet",
    remote,
    `+refs/heads/${branchName}:refs/remotes/${remote}/${branchName}`
  ])
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
