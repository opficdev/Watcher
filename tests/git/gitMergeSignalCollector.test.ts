import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { collectGitMergeSignal, type BranchContext } from "../../src/index.js"
import { collectGitMergeSignalFromPairResult } from "../../src/git/gitMergeSignalCollector.js"

const execFileAsync = promisify(execFile)

// conflict가 없는 branch를 clean signal과 변경 파일 목록으로 표현하는지 확인
test("collects clean merge signal", async () => {
  const fixture = await createGitFixture()

  try {
    const signal = await collectGitMergeSignal(branch("main", "feature/clean"), {
      repositoryPath: fixture.repositoryPath,
      worktreeRoot: fixture.worktreeRoot
    })

    assert.equal(signal.status, "clean")
    assert.deepEqual(signal.changedFiles, ["clean.txt"])
    assert.deepEqual(signal.conflictFiles, [])
    assert.match(signal.mergeBaseSha ?? "", /^[0-9a-f]{40}$/)
    assert.deepEqual(await readdir(fixture.worktreeRoot), [])
  } finally {
    await fixture.remove()
  }
})

// 같은 파일의 같은 위치를 수정한 branch를 confirmed_conflict signal로 표현하는지 확인
test("collects confirmed conflict signal", async () => {
  const fixture = await createGitFixture()

  try {
    const signal = await collectGitMergeSignal(branch("main", "feature/conflict"), {
      repositoryPath: fixture.repositoryPath,
      worktreeRoot: fixture.worktreeRoot
    })

    assert.equal(signal.status, "confirmed_conflict")
    assert.deepEqual(signal.changedFiles, ["shared.txt"])
    assert.deepEqual(signal.conflictFiles, ["shared.txt"])
    assert.deepEqual(await readdir(fixture.worktreeRoot), [])
  } finally {
    await fixture.remove()
  }
})

// fetch나 merge 준비가 실패하면 merge_check_failed signal로 표현하는지 확인
test("collects merge check failure signal", async () => {
  const fixture = await createGitFixture()

  try {
    const signal = await collectGitMergeSignal(branch("main", "feature/missing"), {
      repositoryPath: fixture.repositoryPath,
      worktreeRoot: fixture.worktreeRoot
    })

    assert.equal(signal.status, "merge_check_failed")
    assert.deepEqual(signal.changedFiles, [])
    assert.deepEqual(signal.conflictFiles, [])
    assert.match(signal.errorMessage ?? "", /feature\/missing/)
    assert.deepEqual(await readdir(fixture.worktreeRoot), [])
  } finally {
    await fixture.remove()
  }
})

// base branch가 조합의 오른쪽에 있어도 기존 branch signal로 변환하는지 확인
test("converts a base pair result independent of pair direction", async () => {
  const fixture = await createGitFixture()

  try {
    const signal = await collectGitMergeSignalFromPairResult(
      branch("main", "feature/conflict"),
      {
        pair: {
          leftBranchName: "feature/conflict",
          rightBranchName: "main"
        },
        status: "confirmed_conflict",
        mergedTreeOid: "1".repeat(40),
        conflictFiles: ["shared.txt"],
        conflicts: [{
          paths: ["shared.txt"],
          type: "CONFLICT (contents)"
        }]
      },
      {
        repositoryPath: fixture.repositoryPath,
        worktreeRoot: fixture.worktreeRoot
      }
    )

    assert.equal(signal.status, "confirmed_conflict")
    assert.deepEqual(signal.changedFiles, ["shared.txt"])
    assert.deepEqual(signal.conflictFiles, ["shared.txt"])
    assert.deepEqual(await readdir(fixture.worktreeRoot), [])
  } finally {
    await fixture.remove()
  }
})

// fetch와 ref 고정 실패에서는 오래된 ref의 변경 정보를 다시 사용하지 않는지 확인
test("keeps changed files empty after merge-tree preparation failure", async () => {
  const fixture = await createGitFixture()

  try {
    const signal = await collectGitMergeSignalFromPairResult(
      branch("main", "feature/conflict"),
      {
        pair: {
          leftBranchName: "feature/conflict",
          rightBranchName: "main"
        },
        status: "merge_check_failed",
        conflictFiles: [],
        conflicts: [],
        errorMessage: "git fetch failed for remote origin",
        failureStage: "preparation"
      },
      {
        repositoryPath: fixture.repositoryPath
      }
    )

    assert.equal(signal.status, "merge_check_failed")
    assert.equal(signal.mergeBaseSha, undefined)
    assert.deepEqual(signal.changedFiles, [])
    assert.deepEqual(signal.conflictFiles, [])
  } finally {
    await fixture.remove()
  }
})

async function createGitFixture(): Promise<{
  repositoryPath: string
  worktreeRoot: string
  remove(): Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), "watcher-git-fixture-"))
  const repositoryPath = join(root, "repository")
  const remotePath = join(root, "remote.git")
  const worktreeRoot = join(root, "worktrees")

  await git(root, ["init", "--initial-branch=main", repositoryPath])
  await git(repositoryPath, ["config", "user.email", "opfic@example.com"])
  await git(repositoryPath, ["config", "user.name", "opfic"])

  await writeFile(join(repositoryPath, "shared.txt"), "value=base\n")
  await git(repositoryPath, ["add", "shared.txt"])
  await git(repositoryPath, ["commit", "-m", "initial"])

  await git(repositoryPath, ["checkout", "-b", "feature/conflict"])
  await writeFile(join(repositoryPath, "shared.txt"), "value=feature\n")
  await git(repositoryPath, ["commit", "-am", "feature conflict"])

  await git(repositoryPath, ["checkout", "main"])
  await writeFile(join(repositoryPath, "shared.txt"), "value=main\n")
  await git(repositoryPath, ["commit", "-am", "main conflict"])

  await git(repositoryPath, ["checkout", "-b", "feature/clean"])
  await writeFile(join(repositoryPath, "clean.txt"), "clean\n")
  await git(repositoryPath, ["add", "clean.txt"])
  await git(repositoryPath, ["commit", "-m", "feature clean"])

  await git(repositoryPath, ["checkout", "main"])
  await git(root, ["init", "--bare", remotePath])
  await git(repositoryPath, ["remote", "add", "origin", remotePath])
  await git(repositoryPath, ["push", "--quiet", "origin", "main", "feature/conflict", "feature/clean"])
  await mkdir(worktreeRoot)

  return {
    repositoryPath,
    worktreeRoot,
    async remove(): Promise<void> {
      await rm(root, { recursive: true, force: true })
    }
  }
}

function branch(baseBranch: string, name: string): BranchContext {
  return {
    baseBranch,
    name,
    headSha: `${name}-sha`,
    checks: []
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024
  })

  return result.stdout.trim()
}
