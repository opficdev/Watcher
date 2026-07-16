import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { readGitObjectSnippets } from "../../src/git/gitObjectBatchReader.js"

const execFileAsync = promisify(execFile)

test("reads text, binary, missing, and bounded large snippets in one batch", async () => {
  const fixture = await createGitFixture()

  try {
    const snippets = await readGitObjectSnippets([{
      key: "small",
      objectOid: fixture.commitOid,
      filePath: "소스/값.txt",
      range: { startLine: 2, endLine: 2 }
    }, {
      key: "newline",
      objectOid: fixture.commitOid,
      filePath: "소스/줄\n바꿈.txt",
      range: { startLine: 1, endLine: 1 }
    }, {
      key: "binary",
      objectOid: fixture.commitOid,
      filePath: "소스/data.bin",
      range: { startLine: 1, endLine: 1 }
    }, {
      key: "invalid-utf8",
      objectOid: fixture.commitOid,
      filePath: "소스/invalid.bin",
      range: { startLine: 1, endLine: 1 }
    }, {
      key: "missing",
      objectOid: fixture.commitOid,
      filePath: "소스/missing.txt",
      range: { startLine: 1, endLine: 1 }
    }, {
      key: "large",
      objectOid: fixture.commitOid,
      filePath: "소스/large.txt",
      range: { startLine: 460, endLine: 540 }
    }, {
      key: "long-line",
      objectOid: fixture.commitOid,
      filePath: "소스/long.txt",
      range: { startLine: 1, endLine: 1 }
    }], {
      repositoryPath: fixture.repositoryPath
    })

    assert.deepEqual(snippets.get("small"), {
      status: "text",
      filePath: "소스/값.txt",
      content: "첫째\n둘째\n셋째\n",
      startLine: 1,
      endLine: 3,
      truncated: false
    })
    assert.equal(snippets.get("newline")?.content, "줄바꿈 경로\n")
    assert.deepEqual(snippets.get("binary"), {
      status: "binary",
      filePath: "소스/data.bin",
      truncated: false
    })
    assert.equal(snippets.get("invalid-utf8")?.status, "binary")
    assert.deepEqual(snippets.get("missing"), {
      status: "missing",
      filePath: "소스/missing.txt",
      truncated: false
    })
    assert.deepEqual(snippets.get("large"), {
      status: "text",
      filePath: "소스/large.txt",
      content: Array.from({ length: 81 }, (_, index) =>
        `line ${index + 460}`
      ).join("\n"),
      startLine: 460,
      endLine: 540,
      truncated: true
    })
    assert.equal(snippets.get("long-line")?.status, "text")
    assert.equal(snippets.get("long-line")?.startLine, 1)
    assert.equal(snippets.get("long-line")?.endLine, 1)
    assert.equal(snippets.get("long-line")?.truncated, true)
    assert.equal(
      Buffer.byteLength(snippets.get("long-line")?.content ?? "") <= 32 * 1024,
      true
    )
  } finally {
    await fixture.remove()
  }
})

test("reuses one object lookup for requests with different ranges", async () => {
  const fixture = await createGitFixture()

  try {
    const snippets = await readGitObjectSnippets([{
      key: "first",
      objectOid: fixture.commitOid,
      filePath: "소스/large.txt",
      range: { startLine: 60, endLine: 140 }
    }, {
      key: "second",
      objectOid: fixture.commitOid,
      filePath: "소스/large.txt",
      range: { startLine: 860, endLine: 940 }
    }], {
      repositoryPath: fixture.repositoryPath
    })

    assert.equal(snippets.get("first")?.startLine, 60)
    assert.equal(snippets.get("first")?.endLine, 140)
    assert.equal(snippets.get("second")?.startLine, 860)
    assert.equal(snippets.get("second")?.endLine, 940)
  } finally {
    await fixture.remove()
  }
})

test("rejects an OID whose length is neither 40 nor 64", async () => {
  await assert.rejects(readGitObjectSnippets([{
    key: "invalid",
    objectOid: "a".repeat(41),
    filePath: "value.txt",
    range: { startLine: 1, endLine: 1 }
  }], {
    repositoryPath: "/tmp/repository"
  }), /Invalid Git object OID/)
})

async function createGitFixture(): Promise<{
  repositoryPath: string
  commitOid: string
  remove(): Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), "watcher-object-batch-"))
  const repositoryPath = join(root, "repository")
  const sourcePath = join(repositoryPath, "소스")

  await git(root, ["init", "--initial-branch=main", repositoryPath])
  await git(repositoryPath, ["config", "user.email", "opfic@example.com"])
  await git(repositoryPath, ["config", "user.name", "opfic"])
  await mkdir(sourcePath)
  await writeFile(join(sourcePath, "값.txt"), "첫째\n둘째\n셋째\n")
  await writeFile(join(sourcePath, "줄\n바꿈.txt"), "줄바꿈 경로\n")
  await writeFile(join(sourcePath, "data.bin"), Buffer.from([0, 1, 2, 3]))
  await writeFile(join(sourcePath, "invalid.bin"), Buffer.from([0xc3, 0x28]))
  await writeFile(join(sourcePath, "large.txt"), [
    ...Array.from({ length: 1_000 }, (_, index) => `line ${index + 1}`),
    ""
  ].join("\n"))
  await writeFile(join(sourcePath, "long.txt"), `${"한".repeat(40_000)}\n`)
  await git(repositoryPath, ["add", "."])
  await git(repositoryPath, ["commit", "-m", "fixture"])
  const commitOid = await git(repositoryPath, ["rev-parse", "HEAD"])

  return {
    repositoryPath,
    commitOid,
    async remove(): Promise<void> {
      await rm(root, { recursive: true, force: true })
    }
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024
  })

  return result.stdout.trim()
}
