import test from "node:test"
import assert from "node:assert/strict"
import {
  conflictMarkerRanges,
  overlapRegions,
  parseDiffHunks,
  snippetRangeFor
} from "../../src/git/mergeCodeContextParser.js"

test("parses old and new hunk ranges", () => {
  assert.deepEqual(parseDiffHunks([
    "@@ -10,3 +12,4 @@ function value()",
    "@@ -30 +32 @@"
  ].join("\n")), [{
    oldStartLine: 10,
    oldLineCount: 3,
    newStartLine: 12,
    newLineCount: 4
  }, {
    oldStartLine: 30,
    oldLineCount: 1,
    newStartLine: 32,
    newLineCount: 1
  }])
})

test("finds overlap in merge-base coordinates", () => {
  const left = parseDiffHunks("@@ -10,3 +10,4 @@")
  const right = parseDiffHunks("@@ -12,2 +12,3 @@")

  assert.deepEqual(overlapRegions("src/value.ts", left, right), [{
    filePath: "src/value.ts",
    baseRange: { startLine: 12, endLine: 12 },
    leftRange: { startLine: 10, endLine: 13 },
    rightRange: { startLine: 12, endLine: 14 }
  }])
})

test("uses insertion lines as overlap anchors", () => {
  const left = parseDiffHunks("@@ -5,0 +6,2 @@")
  const right = parseDiffHunks("@@ -5,0 +6,1 @@")

  assert.deepEqual(overlapRegions("src/value.ts", left, right)[0]?.baseRange, {
    startLine: 5,
    endLine: 5
  })
})

test("finds merged conflict marker ranges", () => {
  const content = [
    "before",
    "<<<<<<< left",
    "left",
    "=======",
    "right",
    ">>>>>>> right",
    "after"
  ].join("\n")

  assert.deepEqual(conflictMarkerRanges(content), [{
    startLine: 2,
    endLine: 6
  }])
})

test("ignores an unclosed conflict marker", () => {
  assert.deepEqual(conflictMarkerRanges("<<<<<<< left\nvalue"), [])
})

test("uses whole small file and bounded fallback for a large file", () => {
  assert.deepEqual(snippetRangeFor({
    byteLength: 100,
    lineCount: 20,
    targetRange: { startLine: 10, endLine: 10 }
  }), { startLine: 1, endLine: 20, truncated: false })

  assert.deepEqual(snippetRangeFor({
    byteLength: 64 * 1024,
    lineCount: 1_000,
    targetRange: { startLine: 500, endLine: 510 }
  }), { startLine: 460, endLine: 550, truncated: true })
})

test("prefers a bounded function range for a large file", () => {
  assert.deepEqual(snippetRangeFor({
    byteLength: 64 * 1024,
    lineCount: 1_000,
    targetRange: { startLine: 500, endLine: 510 },
    functionRange: { startLine: 450, endLine: 520 }
  }), { startLine: 450, endLine: 520, truncated: true })
})

test("keeps a long bounded function range inside the function", () => {
  assert.deepEqual(snippetRangeFor({
    byteLength: 128 * 1024,
    lineCount: 2_000,
    targetRange: { startLine: 1_480, endLine: 1_490 },
    functionRange: { startLine: 1_000, endLine: 1_500 }
  }), { startLine: 1_101, endLine: 1_500, truncated: true })
})

test("normalizes a zero line Git insertion range", () => {
  assert.deepEqual(snippetRangeFor({
    byteLength: 64 * 1024,
    lineCount: 1_000,
    targetRange: { startLine: 0, endLine: 0 },
    functionRange: { startLine: 0, endLine: 0 }
  }), { startLine: 1, endLine: 1, truncated: true })
})
