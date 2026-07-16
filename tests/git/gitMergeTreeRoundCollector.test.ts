import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { collect } from "../../src/git/gitMergeTreeRoundCollector.js"
import type {
  BranchComparisonPair,
  BranchComparisonRound
} from "../../src/branches/types.js"

const execFileAsync = promisify(execFile)

// clean과 여러 conflict 조합을 한 process 출력 순서대로 수집하는지 확인
test("collects mixed merge results for one round", async () => {
  const fixture = await createGitFixture()
  const round = comparisonRound([
    pair("clean/left", "clean/right"),
    pair("content/left", "content/right"),
    pair("rename/left", "rename/delete"),
    pair("modify/left", "modify/delete")
  ])

  try {
    const results = await collect(round, {
      repositoryPath: fixture.repositoryPath,
      commitOidByBranch: fixture.commitOidByBranch
    })

    assert.deepEqual(results.map(result => result.pair), round.pairs)
    assert.deepEqual(results.map(result => result.status), [
      "clean",
      "confirmed_conflict",
      "confirmed_conflict",
      "confirmed_conflict"
    ])
    assert.match(results[0]?.mergedTreeOid ?? "", /^[0-9a-f]{40}$/)
    assert.deepEqual(results[0]?.conflictFiles, [])
    assert.deepEqual(results[1]?.conflictFiles, ["shared.txt"])
    assert.equal(results[1]?.conflicts.some(conflict =>
      conflict.type === "CONFLICT (contents)"
    ), true)
    assert.equal(results[2]?.conflicts.some(conflict =>
      conflict.type === "CONFLICT (rename/delete)"
    ), true)
    assert.equal(results[3]?.conflicts.some(conflict =>
      conflict.type === "CONFLICT (modify/delete)"
    ), true)
  } finally {
    await fixture.remove()
  }
})

// merge-tree 실행 전후 worktree 상태와 index tree가 바뀌지 않는지 확인
test("keeps worktree and index unchanged", async () => {
  const fixture = await createGitFixture()
  const round = comparisonRound([
    pair("content/left", "content/right")
  ])

  try {
    const statusBefore = await git(fixture.repositoryPath, ["status", "--porcelain=v1"])
    const indexBefore = await git(fixture.repositoryPath, ["write-tree"])

    await collect(round, {
      repositoryPath: fixture.repositoryPath,
      commitOidByBranch: fixture.commitOidByBranch
    })

    assert.equal(await git(fixture.repositoryPath, ["status", "--porcelain=v1"]), statusBefore)
    assert.equal(await git(fixture.repositoryPath, ["write-tree"]), indexBefore)
  } finally {
    await fixture.remove()
  }
})

// Git process가 실패하면 부분 결과 대신 제한된 stderr 진단을 반환하는지 확인
test("rejects failed git process with bounded stderr", async () => {
  const fixture = await createGitFixture()
  const round = comparisonRound([
    pair("clean/left", "missing")
  ])
  const commitOidByBranch = new Map(fixture.commitOidByBranch)

  commitOidByBranch.set("missing", "f".repeat(40))

  try {
    await assert.rejects(
      collect(round, {
        repositoryPath: fixture.repositoryPath,
        commitOidByBranch,
        stderrLimit: 32
      }),
      error => {
        assert.match(String(error), /git merge-tree failed for round 0: exit code/)
        assert.equal(String(error).length < 160, true)
        return true
      }
    )
  } finally {
    await fixture.remove()
  }
})

// branch commit OID가 없으면 Git 실행 전에 해당 branch를 진단하는지 확인
test("rejects missing branch commit OID", async () => {
  await assert.rejects(
    collect(comparisonRound([pair("main", "feature/a")]), {
      repositoryPath: "/tmp/repository",
      commitOidByBranch: new Map([["main", "1".repeat(40)]])
    }),
    /Missing commit OID for branch feature\/a/
  )
})

// 빈 라운드에서는 Git process 없이 빈 결과를 반환하는지 확인
test("returns no results for an empty round", async () => {
  assert.deepEqual(await collect(comparisonRound([]), {
    repositoryPath: "/missing/repository",
    commitOidByBranch: new Map()
  }), [])
})

async function createGitFixture(): Promise<{
  repositoryPath: string
  commitOidByBranch: Map<string, string>
  remove(): Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), "watcher-merge-tree-round-"))
  const repositoryPath = join(root, "repository")

  await git(root, ["init", "--initial-branch=main", repositoryPath])
  await git(repositoryPath, ["config", "user.email", "opfic@example.com"])
  await git(repositoryPath, ["config", "user.name", "opfic"])
  await writeFile(join(repositoryPath, "shared.txt"), "value=base\n")
  await writeFile(join(repositoryPath, "rename.txt"), "rename base\n")
  await writeFile(join(repositoryPath, "modify-delete.txt"), "modify delete base\n")
  await git(repositoryPath, ["add", "."])
  await git(repositoryPath, ["commit", "-m", "initial"])
  const baseOid = await git(repositoryPath, ["rev-parse", "HEAD"])
  const commitOidByBranch = new Map<string, string>()

  await checkout(repositoryPath, baseOid, "clean/left")
  await writeFile(join(repositoryPath, "left.txt"), "left\n")
  commitOidByBranch.set("clean/left", await commit(repositoryPath, "clean left"))

  await checkout(repositoryPath, baseOid, "clean/right")
  await writeFile(join(repositoryPath, "right.txt"), "right\n")
  commitOidByBranch.set("clean/right", await commit(repositoryPath, "clean right"))

  await checkout(repositoryPath, baseOid, "content/left")
  await writeFile(join(repositoryPath, "shared.txt"), "value=left\n")
  commitOidByBranch.set("content/left", await commit(repositoryPath, "content left"))

  await checkout(repositoryPath, baseOid, "content/right")
  await writeFile(join(repositoryPath, "shared.txt"), "value=right\n")
  commitOidByBranch.set("content/right", await commit(repositoryPath, "content right"))

  await checkout(repositoryPath, baseOid, "rename/left")
  await git(repositoryPath, ["mv", "rename.txt", "renamed.txt"])
  commitOidByBranch.set("rename/left", await commit(repositoryPath, "rename left"))

  await checkout(repositoryPath, baseOid, "rename/delete")
  await rm(join(repositoryPath, "rename.txt"))
  commitOidByBranch.set("rename/delete", await commit(repositoryPath, "rename delete"))

  await checkout(repositoryPath, baseOid, "modify/left")
  await writeFile(join(repositoryPath, "modify-delete.txt"), "modified\n")
  commitOidByBranch.set("modify/left", await commit(repositoryPath, "modify left"))

  await checkout(repositoryPath, baseOid, "modify/delete")
  await rm(join(repositoryPath, "modify-delete.txt"))
  commitOidByBranch.set("modify/delete", await commit(repositoryPath, "modify delete"))

  await git(repositoryPath, ["checkout", "main"])

  return {
    repositoryPath,
    commitOidByBranch,
    async remove(): Promise<void> {
      await rm(root, { recursive: true, force: true })
    }
  }
}

async function checkout(
  repositoryPath: string,
  oid: string,
  name: string
): Promise<void> {
  await git(repositoryPath, ["checkout", "-B", name, oid])
}

async function commit(repositoryPath: string, message: string): Promise<string> {
  await git(repositoryPath, ["add", "-A"])
  await git(repositoryPath, ["commit", "-m", message])
  return git(repositoryPath, ["rev-parse", "HEAD"])
}

function comparisonRound(pairs: BranchComparisonPair[]): BranchComparisonRound {
  return {
    roundIndex: 0,
    pairs
  }
}

function pair(
  leftBranchName: string,
  rightBranchName: string
): BranchComparisonPair {
  return {
    leftBranchName,
    rightBranchName
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024
  })

  return result.stdout.trim()
}
