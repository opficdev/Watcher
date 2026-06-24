import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { writerFor } from "../../src/debug/debugArtifact.js"

// debug artifact writer가 JSON 파일을 안정적으로 생성하는지 확인
test("writes debug artifact json", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watcher-debug-"))

  try {
    const writer = writerFor(directory)
    assert.ok(writer)

    await writer.writeJson("run.json", {
      repository: "opficdev/Watcher",
      generatedAt: new Date("2026-06-24T00:00:00.000Z")
    })

    assert.equal(
      await readFile(join(directory, "run.json"), "utf8"),
      [
        "{",
        "  \"repository\": \"opficdev/Watcher\",",
        "  \"generatedAt\": \"2026-06-24T00:00:00.000Z\"",
        "}",
        ""
      ].join("\n")
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    })
  }
})

// debug artifact writer가 text 파일을 생성하는지 확인
test("writes debug artifact text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watcher-debug-"))

  try {
    const writer = writerFor(directory)
    assert.ok(writer)

    await writer.writeText("report.md", "## Merge Risk Report\n")

    assert.equal(
      await readFile(join(directory, "report.md"), "utf8"),
      "## Merge Risk Report\n"
    )
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    })
  }
})

// directory가 없으면 artifact 기록을 비활성화하는지 확인
test("omits writer when debug artifact directory is missing", () => {
  assert.equal(writerFor(undefined), undefined)
})
