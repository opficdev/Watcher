import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { collect as collectCodeContext } from "../../src/git/gitMergeCodeContextCollector.js"
import { collect as collectMergeTreeRound } from "../../src/git/gitMergeTreeRoundCollector.js"
import type { BranchComparisonRound } from "../../src/branches/types.js"
import type { GitMergeTreePairResult } from "../../src/git/types.js"

const execFileAsync = promisify(execFile)

test("collects four conflict versions and commit metadata without repository mutation", async () => {
  const fixture = await createGitFixture()
  const round: BranchComparisonRound = {
    roundIndex: 0,
    pairs: [{
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    }]
  }

  try {
    const [mergeResult] = await collectMergeTreeRound(round, {
      repositoryPath: fixture.repositoryPath,
      commitOidByBranch: fixture.commitOidByBranch
    })

    assert.ok(mergeResult)
    assert.equal(mergeResult.status, "confirmed_conflict")

    const before = await repositorySnapshot(fixture.repositoryPath)
    const [result] = await collectCodeContext([mergeResult], {
      repositoryPath: fixture.repositoryPath
    })
    const after = await repositorySnapshot(fixture.repositoryPath)
    const evidence = result?.evidence[0]

    assert.deepEqual(after, before)
    assert.equal(result?.errorMessage, undefined)
    assert.equal(result?.evidence.length, 1)
    assert.equal(evidence?.kind, "confirmed_conflict")
    assert.equal(evidence?.filePath, "src/value.ts")
    assert.equal(evidence?.mergeBaseOid, fixture.baseOid)
    assert.equal(evidence?.mergedTreeOid, mergeResult.mergedTreeOid)
    assert.deepEqual(evidence?.baseCommit, {
      role: "base",
      oid: fixture.baseOid,
      author: "opfic <opfic@example.com>",
      committedAt: "2026-07-16T00:00:00Z",
      subject: "base"
    })
    assert.equal(evidence?.leftCommit.role, "left")
    assert.equal(evidence?.leftCommit.branchName, "feature/left")
    assert.equal(evidence?.leftCommit.oid, fixture.commitOidByBranch.get("feature/left"))
    assert.equal(evidence?.leftCommit.subject, "left change")
    assert.equal(evidence?.rightCommit.role, "right")
    assert.equal(evidence?.rightCommit.branchName, "feature/right")
    assert.equal(evidence?.rightCommit.oid, fixture.commitOidByBranch.get("feature/right"))
    assert.equal(evidence?.rightCommit.subject, "right change")
    assert.match(evidence?.baseSnippet.content ?? "", /base/)
    assert.match(evidence?.leftSnippet.content ?? "", /left/)
    assert.match(evidence?.rightSnippet.content ?? "", /right/)
    assert.match(evidence?.mergedSnippet.content ?? "", /<<<<<<< /)
    assert.match(evidence?.mergedSnippet.content ?? "", /=======/)
    assert.match(evidence?.mergedSnippet.content ?? "", />>>>>>> /)
  } finally {
    await fixture.remove()
  }
})

test("uses actual merged marker ranges after earlier conflicts shift line numbers", async () => {
  const conflictLines = [
    20, 60, 100, 140, 180, 220, 260,
    300, 340, 380, 420, 460, 600
  ]
  const baseLines = Array.from({ length: 700 }, (_, index) =>
    `line ${index + 1}`
  )
  const leftLines = [...baseLines]
  const rightLines = [...baseLines]

  for (const lineNumber of conflictLines) {
    leftLines[lineNumber - 1] = `left ${lineNumber}`
    rightLines[lineNumber - 1] = `right ${lineNumber}`
  }

  const fixture = await createVersionedGitFixture(
    "src/large.txt",
    `${baseLines.join("\n")}\n`,
    `${leftLines.join("\n")}\n`,
    `${rightLines.join("\n")}\n`
  )

  try {
    const mergeResult = await collectFixtureMergeResult(fixture)
    const [result] = await collectCodeContext([mergeResult], {
      repositoryPath: fixture.repositoryPath
    })

    assert.equal(result?.evidence.length, conflictLines.length)
    assert.equal(result?.evidence.every(evidence =>
      evidence.mergedSnippet.content?.includes("<<<<<<< ") &&
      evidence.mergedSnippet.content.includes("=======") &&
      evidence.mergedSnippet.content.includes(">>>>>>> ")
    ), true)
  } finally {
    await fixture.remove()
  }
})

test("prefers function context over the forty line fallback", async () => {
  const prelude = Array.from({ length: 450 }, (_, index) =>
    `/* prelude ${index + 1} */`
  )
  const functionLines = [
    "int value(void) {",
    ...Array.from({ length: 120 }, (_, index) =>
      `  int local_${index + 1} = ${index + 1};`
    ),
    "  return local_60;",
    "}"
  ]
  const baseLines = [...prelude, ...functionLines]
  const selectedLine = prelude.length + 61
  const leftLines = [...baseLines]
  const rightLines = [...baseLines]

  leftLines[selectedLine - 1] = "  int local_60 = 600;"
  rightLines[selectedLine - 1] = "  int local_60 = 601;"

  const fixture = await createVersionedGitFixture(
    "src/value.c",
    `${baseLines.join("\n")}\n`,
    `${leftLines.join("\n")}\n`,
    `${rightLines.join("\n")}\n`
  )

  try {
    const mergeResult = await collectFixtureMergeResult(fixture)
    const [result] = await collectCodeContext([mergeResult], {
      repositoryPath: fixture.repositoryPath
    })
    const evidence = result?.evidence[0]

    assert.match(evidence?.baseSnippet.content ?? "", /int value\(void\) \{/)
    assert.match(evidence?.leftSnippet.content ?? "", /int value\(void\) \{/)
    assert.match(evidence?.rightSnippet.content ?? "", /int value\(void\) \{/)
    assert.match(evidence?.mergedSnippet.content ?? "", /int value\(void\) \{/)
    assert.match(evidence?.mergedSnippet.content ?? "", /<<<<<<< /)
  } finally {
    await fixture.remove()
  }
})

test("bounds pair diagnostics and rejects non-object identifiers", async () => {
  const invalidResult = conflictResult({
    leftCommitOid: "a".repeat(41)
  })
  const [invalid] = await collectCodeContext([invalidResult], {
    repositoryPath: "/tmp/repository"
  })

  assert.match(invalid?.errorMessage ?? "", /Invalid left commit OID/)

  const root = await mkdtemp(join(tmpdir(), "watcher-fake-git-"))
  const executablePath = join(root, "git")
  const scriptPath = join(root, "fake-git.js")
  const originalPath = process.env.PATH

  try {
    await writeFile(scriptPath, [
      `#!${process.execPath}`,
      "process.stderr.write(\"x\".repeat(20 * 1024))",
      "process.exit(1)",
      ""
    ].join("\n"))
    await writeFile(executablePath, [
      "#!/bin/sh",
      `exec "${process.execPath}" "${scriptPath}" "$@"`,
      ""
    ].join("\n"))
    await chmod(executablePath, 0o755)
    process.env.PATH = `${root}:${originalPath ?? ""}`

    const [failed] = await collectCodeContext([conflictResult()], {
      repositoryPath: root
    })

    assert.equal(Buffer.byteLength(failed?.errorMessage ?? "") <= 16 * 1024, true)
  } finally {
    process.env.PATH = originalPath
    await rm(root, { recursive: true, force: true })
  }
})

test("collects only overlapping clean hunks without repository mutation", async () => {
  const baseLines = Array.from({ length: 100 }, (_, index) =>
    `line ${index + 1}`
  )
  const overlappingLines = [...baseLines]

  overlappingLines[49] = "shared change"

  const overlapFixture = await createVersionedGitFixture(
    "src/clean.txt",
    `${baseLines.join("\n")}\n`,
    `${overlappingLines.join("\n")}\n`,
    `${overlappingLines.join("\n")}\n`
  )
  const leftLines = [...baseLines]
  const rightLines = [...baseLines]

  leftLines[9] = "left change"
  rightLines[89] = "right change"

  const disjointFixture = await createVersionedGitFixture(
    "src/disjoint.txt",
    `${baseLines.join("\n")}\n`,
    `${leftLines.join("\n")}\n`,
    `${rightLines.join("\n")}\n`
  )

  try {
    const overlapMergeResult = await collectFixtureMergeResult(
      overlapFixture,
      "clean"
    )
    const disjointMergeResult = await collectFixtureMergeResult(
      disjointFixture,
      "clean"
    )
    const overlapBefore = await repositorySnapshot(overlapFixture.repositoryPath)
    const disjointBefore = await repositorySnapshot(disjointFixture.repositoryPath)
    const [overlap] = await collectCodeContext([overlapMergeResult], {
      repositoryPath: overlapFixture.repositoryPath
    })
    const [disjoint] = await collectCodeContext([disjointMergeResult], {
      repositoryPath: disjointFixture.repositoryPath
    })
    const overlapAfter = await repositorySnapshot(overlapFixture.repositoryPath)
    const disjointAfter = await repositorySnapshot(disjointFixture.repositoryPath)

    assert.deepEqual(overlapAfter, overlapBefore)
    assert.deepEqual(disjointAfter, disjointBefore)
    assert.equal(overlap?.evidence.length, 1)
    assert.equal(overlap?.evidence[0]?.kind, "clean_hunk_overlap")
    assert.match(overlap?.evidence[0]?.mergedSnippet.content ?? "", /shared change/)
    assert.equal(disjoint?.errorMessage, undefined)
    assert.deepEqual(disjoint?.evidence, [])
  } finally {
    await overlapFixture.remove()
    await disjointFixture.remove()
  }
})

test("maps a clean overlap through the merged tree after a large insertion", async () => {
  const baseLines = Array.from({ length: 100 }, (_, index) =>
    `line ${index + 1}`
  )
  const rightLines = [...baseLines]
  const leftLines = [
    ...Array.from({ length: 450 }, (_, index) => `inserted ${index + 1}`),
    ...baseLines
  ]

  rightLines[79] = "shared change"
  leftLines[450 + 79] = "shared change"

  const fixture = await createVersionedGitFixture(
    "src/shifted.txt",
    `${baseLines.join("\n")}\n`,
    `${leftLines.join("\n")}\n`,
    `${rightLines.join("\n")}\n`
  )

  try {
    const mergeResult = await collectFixtureMergeResult(fixture, "clean")
    const [result] = await collectCodeContext([mergeResult], {
      repositoryPath: fixture.repositoryPath
    })

    assert.equal(result?.evidence.length, 1)
    assert.match(result?.evidence[0]?.mergedSnippet.content ?? "", /shared change/)
  } finally {
    await fixture.remove()
  }
})

test("classifies every deleted clean overlap version without repository mutation", async () => {
  const fixture = await createVersionedGitFixture(
    "src/deleted.txt",
    "base\n",
    undefined,
    undefined
  )

  try {
    const mergeResult = await collectFixtureMergeResult(fixture, "clean")
    const before = await repositorySnapshot(fixture.repositoryPath)
    const [result] = await collectCodeContext([mergeResult], {
      repositoryPath: fixture.repositoryPath
    })
    const after = await repositorySnapshot(fixture.repositoryPath)
    const evidence = result?.evidence[0]

    assert.deepEqual(after, before)
    assert.equal(result?.evidence.length, 1)
    assert.equal(evidence?.baseSnippet.status, "text")
    assert.equal(evidence?.leftSnippet.status, "deleted")
    assert.equal(evidence?.rightSnippet.status, "deleted")
    assert.equal(evidence?.mergedSnippet.status, "deleted")
    assert.equal(evidence?.leftSnippet.content, undefined)
    assert.equal(evidence?.rightSnippet.content, undefined)
    assert.equal(evidence?.mergedSnippet.content, undefined)
  } finally {
    await fixture.remove()
  }
})

test("classifies binary, deleted, and missing conflict versions without repository mutation", async () => {
  const fixture = await createEdgeCaseGitFixture()

  try {
    const mergeResult = await collectFixtureMergeResult(fixture)
    const before = await repositorySnapshot(fixture.repositoryPath)
    const [result] = await collectCodeContext([mergeResult], {
      repositoryPath: fixture.repositoryPath
    })
    const after = await repositorySnapshot(fixture.repositoryPath)
    const evidenceByFile = new Map(result?.evidence.map(evidence => [
      evidence.filePath,
      evidence
    ]))
    const binary = evidenceByFile.get("binary.bin")
    const deleted = evidenceByFile.get("delete.txt")
    const added = evidenceByFile.get("added.txt")

    assert.deepEqual(after, before)
    assert.equal(binary?.baseSnippet.status, "binary")
    assert.equal(binary?.leftSnippet.status, "binary")
    assert.equal(binary?.rightSnippet.status, "binary")
    assert.equal(binary?.mergedSnippet.status, "binary")
    assert.equal(binary?.baseSnippet.content, undefined)
    assert.equal(binary?.leftSnippet.content, undefined)
    assert.equal(binary?.rightSnippet.content, undefined)
    assert.equal(binary?.mergedSnippet.content, undefined)
    assert.equal(deleted?.baseSnippet.status, "text")
    assert.equal(deleted?.leftSnippet.status, "text")
    assert.equal(deleted?.rightSnippet.status, "deleted")
    assert.equal(deleted?.rightSnippet.content, undefined)
    assert.equal(added?.baseSnippet.status, "missing")
    assert.equal(added?.leftSnippet.status, "text")
    assert.equal(added?.rightSnippet.status, "text")
  } finally {
    await fixture.remove()
  }
})

test("isolates one pair failure and preserves input order", async () => {
  const fixture = await createGitFixture()

  try {
    const valid = await collectFixtureMergeResult(fixture)
    const invalid = {
      ...valid,
      pair: {
        leftBranchName: "invalid/left",
        rightBranchName: "invalid/right"
      },
      leftCommitOid: "f".repeat(41)
    }
    const repeated = {
      ...valid,
      pair: {
        leftBranchName: "repeated/left",
        rightBranchName: "repeated/right"
      }
    }
    const inputs = [valid, invalid, repeated]
    const before = await repositorySnapshot(fixture.repositoryPath)
    const results = await collectCodeContext(inputs, {
      repositoryPath: fixture.repositoryPath
    })
    const after = await repositorySnapshot(fixture.repositoryPath)

    assert.deepEqual(after, before)
    assert.deepEqual(results.map(result => result.pair), inputs.map(result => result.pair))
    assert.equal(results[0]?.errorMessage, undefined)
    assert.match(results[1]?.errorMessage ?? "", /Invalid left commit OID/)
    assert.equal(results[2]?.errorMessage, undefined)
    assert.equal(results[0]?.evidence.length, results[2]?.evidence.length)
  } finally {
    await fixture.remove()
  }
})

async function createGitFixture(): Promise<{
  repositoryPath: string
  baseOid: string
  commitOidByBranch: Map<string, string>
  remove(): Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), "watcher-code-context-"))
  const repositoryPath = join(root, "repository")
  const sourcePath = join(repositoryPath, "src")

  await git(root, ["init", "--initial-branch=main", repositoryPath])
  await git(repositoryPath, ["config", "user.email", "opfic@example.com"])
  await git(repositoryPath, ["config", "user.name", "opfic"])
  await mkdir(sourcePath)
  await writeValueFile(repositoryPath, "base")
  await git(repositoryPath, ["add", "."])
  await git(repositoryPath, ["commit", "-m", "base"], "2026-07-16T00:00:00Z")
  const baseOid = await git(repositoryPath, ["rev-parse", "HEAD"])
  const commitOidByBranch = new Map<string, string>()

  await git(repositoryPath, ["checkout", "-b", "feature/left", baseOid])
  await writeValueFile(repositoryPath, "left")
  await git(repositoryPath, ["commit", "-am", "left change"], "2026-07-16T01:00:00Z")
  commitOidByBranch.set("feature/left", await git(repositoryPath, ["rev-parse", "HEAD"]))

  await git(repositoryPath, ["checkout", "-b", "feature/right", baseOid])
  await writeValueFile(repositoryPath, "right")
  await git(repositoryPath, ["commit", "-am", "right change"], "2026-07-16T02:00:00Z")
  commitOidByBranch.set("feature/right", await git(repositoryPath, ["rev-parse", "HEAD"]))
  await git(repositoryPath, ["checkout", "main"])

  return {
    repositoryPath,
    baseOid,
    commitOidByBranch,
    async remove(): Promise<void> {
      await rm(root, { recursive: true, force: true })
    }
  }
}

async function writeValueFile(
  repositoryPath: string,
  value: string
): Promise<void> {
  await writeFile(join(repositoryPath, "src/value.ts"), [
    "export function value() {",
    `  return "${value}"`,
    "}",
    ""
  ].join("\n"))
}

async function createVersionedGitFixture(
  filePath: string,
  baseContent: string,
  leftContent: string | undefined,
  rightContent: string | undefined
): Promise<{
  repositoryPath: string
  baseOid: string
  commitOidByBranch: Map<string, string>
  remove(): Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), "watcher-code-context-versioned-"))
  const repositoryPath = join(root, "repository")
  const absoluteFilePath = join(repositoryPath, filePath)

  await git(root, ["init", "--initial-branch=main", repositoryPath])
  await git(repositoryPath, ["config", "user.email", "opfic@example.com"])
  await git(repositoryPath, ["config", "user.name", "opfic"])
  await mkdir(dirname(absoluteFilePath), { recursive: true })
  await writeFile(absoluteFilePath, baseContent)
  await git(repositoryPath, ["add", "."])
  await git(repositoryPath, ["commit", "-m", "base"], "2026-07-16T00:00:00Z")
  const baseOid = await git(repositoryPath, ["rev-parse", "HEAD"])
  const commitOidByBranch = new Map<string, string>()

  await git(repositoryPath, ["checkout", "-b", "feature/left", baseOid])
  if (leftContent === undefined) {
    await rm(absoluteFilePath)
  } else {
    await writeFile(absoluteFilePath, leftContent)
  }
  await git(repositoryPath, ["add", "-A"])
  await git(repositoryPath, ["commit", "-m", "left change"], "2026-07-16T01:00:00Z")
  commitOidByBranch.set("feature/left", await git(repositoryPath, ["rev-parse", "HEAD"]))

  await git(repositoryPath, ["checkout", "-b", "feature/right", baseOid])
  if (rightContent === undefined) {
    await rm(absoluteFilePath)
  } else {
    await writeFile(absoluteFilePath, rightContent)
  }
  await git(repositoryPath, ["add", "-A"])
  await git(repositoryPath, ["commit", "-m", "right change"], "2026-07-16T02:00:00Z")
  commitOidByBranch.set("feature/right", await git(repositoryPath, ["rev-parse", "HEAD"]))
  await git(repositoryPath, ["checkout", "main"])

  return {
    repositoryPath,
    baseOid,
    commitOidByBranch,
    async remove(): Promise<void> {
      await rm(root, { recursive: true, force: true })
    }
  }
}

async function createEdgeCaseGitFixture(): Promise<{
  repositoryPath: string
  baseOid: string
  commitOidByBranch: Map<string, string>
  remove(): Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), "watcher-code-context-edge-"))
  const repositoryPath = join(root, "repository")

  await git(root, ["init", "--initial-branch=main", repositoryPath])
  await git(repositoryPath, ["config", "user.email", "opfic@example.com"])
  await git(repositoryPath, ["config", "user.name", "opfic"])
  await writeFile(join(repositoryPath, "binary.bin"), Buffer.from([0, 1, 2]))
  await writeFile(join(repositoryPath, "delete.txt"), "base\n")
  await git(repositoryPath, ["add", "."])
  await git(repositoryPath, ["commit", "-m", "base"], "2026-07-16T00:00:00Z")
  const baseOid = await git(repositoryPath, ["rev-parse", "HEAD"])
  const commitOidByBranch = new Map<string, string>()

  await git(repositoryPath, ["checkout", "-b", "feature/left", baseOid])
  await writeFile(join(repositoryPath, "binary.bin"), Buffer.from([0, 3, 2]))
  await writeFile(join(repositoryPath, "delete.txt"), "left\n")
  await writeFile(join(repositoryPath, "added.txt"), "left added\n")
  await git(repositoryPath, ["add", "-A"])
  await git(repositoryPath, ["commit", "-m", "left change"], "2026-07-16T01:00:00Z")
  commitOidByBranch.set("feature/left", await git(repositoryPath, ["rev-parse", "HEAD"]))

  await git(repositoryPath, ["checkout", "-b", "feature/right", baseOid])
  await writeFile(join(repositoryPath, "binary.bin"), Buffer.from([0, 4, 2]))
  await rm(join(repositoryPath, "delete.txt"))
  await writeFile(join(repositoryPath, "added.txt"), "right added\n")
  await git(repositoryPath, ["add", "-A"])
  await git(repositoryPath, ["commit", "-m", "right change"], "2026-07-16T02:00:00Z")
  commitOidByBranch.set("feature/right", await git(repositoryPath, ["rev-parse", "HEAD"]))
  await git(repositoryPath, ["checkout", "main"])

  return {
    repositoryPath,
    baseOid,
    commitOidByBranch,
    async remove(): Promise<void> {
      await rm(root, { recursive: true, force: true })
    }
  }
}

async function collectFixtureMergeResult(
  fixture: {
    repositoryPath: string
    commitOidByBranch: Map<string, string>
  },
  expectedStatus: "clean" | "confirmed_conflict" = "confirmed_conflict"
): Promise<GitMergeTreePairResult> {
  const round: BranchComparisonRound = {
    roundIndex: 0,
    pairs: [{
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    }]
  }
  const [result] = await collectMergeTreeRound(round, {
    repositoryPath: fixture.repositoryPath,
    commitOidByBranch: fixture.commitOidByBranch
  })

  assert.ok(result)
  assert.equal(result.status, expectedStatus)
  return result
}

function conflictResult(
  overrides: Partial<GitMergeTreePairResult> = {}
): GitMergeTreePairResult {
  return {
    pair: {
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    },
    status: "confirmed_conflict",
    leftCommitOid: "1".repeat(40),
    rightCommitOid: "2".repeat(40),
    mergedTreeOid: "3".repeat(40),
    conflictFiles: ["value.txt"],
    conflicts: [],
    ...overrides
  }
}

async function repositorySnapshot(repositoryPath: string): Promise<string[]> {
  const head = await git(repositoryPath, ["rev-parse", "HEAD"])
  const branch = await git(repositoryPath, ["branch", "--show-current"])
  const status = await git(repositoryPath, ["status", "--porcelain=v1"])
  const index = await git(repositoryPath, ["write-tree"])
  const refs = await git(repositoryPath, ["show-ref", "--head"])

  return [head, branch, status, index, refs]
}

async function git(
  cwd: string,
  args: string[],
  date?: string
): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: date ? {
      ...process.env,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date
    } : process.env,
    maxBuffer: 10 * 1024 * 1024
  })

  return result.stdout.trim()
}
