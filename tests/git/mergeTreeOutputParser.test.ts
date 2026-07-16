import test from "node:test"
import assert from "node:assert/strict"
import { MergeTreeOutputParser } from "../../src/git/mergeTreeOutputParser.js"
import type { BranchComparisonPair } from "../../src/branches/types.js"

const cleanTreeOid = "1".repeat(40)
const conflictTreeOid = "2".repeat(40)

// 정상 병합 상태와 merged tree OID를 조합 순서대로 해석하는지 확인
test("parses clean merge results", () => {
  const pairs = [pair("main", "feature/clean")]
  const parser = new MergeTreeOutputParser(pairs)

  parser.push(output(["1", cleanTreeOid, "", ""]))

  assert.deepEqual(parser.finish(), [{
    pair: pairs[0],
    status: "clean",
    mergedTreeOid: cleanTreeOid,
    conflictFiles: [],
    conflicts: []
  }])
})

// conflict file과 여러 path가 연결된 안정된 conflict type을 해석하는지 확인
test("parses conflict files and conflict types", () => {
  const pairs = [pair("feature/a", "feature/b")]
  const parser = new MergeTreeOutputParser(pairs)

  parser.push(output([
    "0",
    conflictTreeOid,
    "renamed.txt",
    "removed.txt",
    "",
    "2",
    "before.txt",
    "renamed.txt",
    "CONFLICT (rename/delete)",
    "free form message is ignored",
    "1",
    "removed.txt",
    "CONFLICT (modify/delete)",
    "another free form message",
    ""
  ]))

  assert.deepEqual(parser.finish(), [{
    pair: pairs[0],
    status: "confirmed_conflict",
    mergedTreeOid: conflictTreeOid,
    conflictFiles: ["renamed.txt", "removed.txt"],
    conflicts: [{
      paths: ["before.txt", "renamed.txt"],
      type: "CONFLICT (rename/delete)"
    }, {
      paths: ["removed.txt"],
      type: "CONFLICT (modify/delete)"
    }]
  }])
})

// Auto-merging 같은 정보성 message를 conflict 목록에 포함하지 않는지 확인
test("ignores non-conflict informational messages", () => {
  const pairs = [pair("main", "feature/conflict")]
  const parser = new MergeTreeOutputParser(pairs)

  parser.push(output([
    "0",
    conflictTreeOid,
    "공유.txt",
    "",
    "1",
    "공유.txt",
    "Auto-merging",
    "free form message",
    "1",
    "공유.txt",
    "CONFLICT (content)",
    "free form message",
    ""
  ]))

  assert.deepEqual(parser.finish()[0]?.conflicts, [{
    paths: ["공유.txt"],
    type: "CONFLICT (content)"
  }])
})

// UTF-8 문자와 NUL 사이에서 stdout chunk가 나뉘어도 같은 결과를 만드는지 확인
test("parses chunks split across UTF-8 and NUL boundaries", () => {
  const pairs = [
    pair("main", "feature/clean"),
    pair("main", "feature/conflict")
  ]
  const parser = new MergeTreeOutputParser(pairs)
  const bytes = output([
    "1",
    cleanTreeOid,
    "",
    "",
    "0",
    conflictTreeOid,
    "한글.txt",
    "",
    "1",
    "한글.txt",
    "CONFLICT (content)",
    "free form message",
    ""
  ])

  for (const byte of bytes) {
    parser.push(Buffer.from([byte]))
  }

  const results = parser.finish()

  assert.deepEqual(results.map(result => result.status), [
    "clean",
    "confirmed_conflict"
  ])
  assert.deepEqual(results[1]?.conflictFiles, ["한글.txt"])
})

// 잘린 토큰에 현재 pair와 parser 상태를 포함한 진단 오류를 제공하는지 확인
test("rejects truncated output", () => {
  const parser = new MergeTreeOutputParser([pair("main", "feature/a")])

  parser.push(Buffer.from(`1\0${cleanTreeOid}`, "utf8"))

  assert.throws(
    () => parser.finish(),
    /pair 0: truncated token while reading merged_tree_oid/
  )
})

// 잘못된 상태와 OID를 진단 오류로 거부하는지 확인
test("rejects invalid status and merged tree OID", () => {
  const invalidStatus = new MergeTreeOutputParser([pair("main", "feature/a")])
  const invalidOid = new MergeTreeOutputParser([pair("main", "feature/a")])
  const abbreviatedOid = new MergeTreeOutputParser([pair("main", "feature/a")])

  assert.throws(
    () => invalidStatus.push(output(["2"])),
    /invalid merge status/
  )
  assert.throws(
    () => invalidOid.push(output(["1", "not-an-oid"])),
    /invalid merged tree OID/
  )
  assert.throws(
    () => abbreviatedOid.push(output(["1", "1".repeat(39)])),
    /invalid merged tree OID/
  )
})

// 예상한 조합 수보다 결과가 적거나 많으면 거부하는지 확인
test("rejects mismatched result count", () => {
  const missing = new MergeTreeOutputParser([
    pair("main", "feature/a"),
    pair("main", "feature/b")
  ])
  const extra = new MergeTreeOutputParser([pair("main", "feature/a")])

  missing.push(output(["1", cleanTreeOid, "", ""]))
  extra.push(output(["1", cleanTreeOid, "", ""]))

  assert.throws(
    () => missing.finish(),
    /expected 2 results but received 1/
  )
  assert.throws(
    () => extra.push(output(["1"])),
    /received more results than expected/
  )
})

// message path 수가 숫자가 아니면 구조화된 출력 오류로 처리하는지 확인
test("rejects invalid message path count", () => {
  const parser = new MergeTreeOutputParser([pair("main", "feature/a")])

  assert.throws(
    () => parser.push(output([
      "0",
      conflictTreeOid,
      "shared.txt",
      "",
      "not-a-count"
    ])),
    /invalid message path count/
  )
})

function pair(
  leftBranchName: string,
  rightBranchName: string
): BranchComparisonPair {
  return {
    leftBranchName,
    rightBranchName
  }
}

function output(tokens: string[]): Buffer {
  return Buffer.from(`${tokens.join("\0")}\0`, "utf8")
}
