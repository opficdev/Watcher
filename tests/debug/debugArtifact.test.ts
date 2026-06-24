import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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

// artifact 저장 실패가 main workflow 실패로 전파되지 않는지 확인
test("warns and continues when debug artifact write fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "watcher-debug-"))
  const filePath = join(directory, "not-directory")
  const originalWarn = console.warn
  const warnings: unknown[][] = []

  console.warn = (...values: unknown[]) => {
    warnings.push(values)
  }

  try {
    await writeFile(filePath, "not a directory")

    const writer = writerFor(filePath)
    assert.ok(writer)

    await assert.doesNotReject(writer.writeText("report.md", "## Merge Risk Report\n"))
    assert.equal(warnings.length, 1)
    assert.match(String(warnings[0]?.[0]), /Failed to write debug artifact report\.md:/)
  } finally {
    console.warn = originalWarn
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
