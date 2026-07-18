import test from "node:test"
import assert from "node:assert/strict"
import {
  splitDiscordMessages
} from "../../src/reportChannels/discordMessageSplitter.js"

// Summary를 첫 message로 두고 각 branch 조합을 새 message에서 시작하는지 확인
test("places summary first and starts each branch pair in a new message", () => {
  const messages = splitDiscordMessages([
    "## Merge Risk Report",
    "",
    "### Summary",
    "- watched branches: 2",
    "",
    "### Confirmed Conflicts",
    "",
    "#### `feature/a` ↔ `main`",
    "- status: `confirmed_conflict`",
    "",
    "#### `feature/b` ↔ `main`",
    "- status: `confirmed_conflict`",
    "",
    "### Branch Impact",
    "",
    "- `feature/a`"
  ].join("\n"))

  assert.match(messages[0]?.content ?? "", /### Summary/)
  assert.match(
    messages[1]?.content ?? "",
    /^### Confirmed Conflicts\n\n#### `feature\/a` ↔ `main`/
  )
  assert.match(
    messages[2]?.content ?? "",
    /^#### `feature\/b` ↔ `main`/
  )
  assert.match(messages.at(-1)?.content ?? "", /### Branch Impact/)
  assert.equal(messages.every(message => message.content.length <= 2000), true)
  assert.deepEqual(messages.slice(1, 3).map(message => message.pairLabel), [
    "`feature/a` ↔ `main`",
    "`feature/b` ↔ `main`"
  ])
})

// Discord content 제한 경계에서 불필요하거나 누락된 message가 없는지 확인
test("keeps an exact 2000 character message and splits a 2001 character message", () => {
  assert.deepEqual(
    splitDiscordMessages("a".repeat(2000)).map(message => message.content.length),
    [2000]
  )
  assert.deepEqual(
    splitDiscordMessages("a".repeat(2001)).map(message => message.content.length),
    [2000, 1]
  )
})

// 알려지지 않은 Markdown도 길이 기반 fallback으로 원문을 모두 유지하는지 확인
test("falls back to length splitting without dropping unrecognized markdown", () => {
  const markdown = `custom:${"x".repeat(2100)}`
  const messages = splitDiscordMessages(markdown)

  assert.equal(messages.map(message => message.content).join(""), markdown)
})

// AI 분석과 권장 해결 방법을 같은 조합의 독립 message로 분할하는지 확인
test("starts AI analysis and recommended resolution in separate pair messages", () => {
  const messages = splitDiscordMessages([
    "## Merge Risk Report",
    "",
    "### Summary",
    "- watched branches: 1",
    "",
    "### Confirmed Conflicts",
    "",
    "#### `feature/a` ↔ `main`",
    "- status: `confirmed_conflict`",
    "- AI Analysis:",
    "  - status: `predicted`",
    "- Recommended Resolution:",
    "  - strategy: `merge`"
  ].join("\n"))
  const pairMessages = messages.filter(message => message.pairLabel)

  assert.equal(pairMessages.length, 3)
  assert.match(
    pairMessages[0]?.content ?? "",
    /- status: `confirmed_conflict`/
  )
  assert.match(
    pairMessages[1]?.content ?? "",
    /^#### `feature\/a` ↔ `main`\n- AI Analysis:/
  )
  assert.match(
    pairMessages[2]?.content ?? "",
    /^#### `feature\/a` ↔ `main`\n- Recommended Resolution:/
  )
  assert.deepEqual(
    pairMessages.map(message => message.fragmentNumber),
    [1, 2, 3]
  )
})

// AI 상태와 상세 단위를 조합별 순서와 연속된 조각 번호로 유지하는지 확인
test("keeps AI units in pair order with continuous fragment numbers", () => {
  const messages = splitDiscordMessages([
    "## Merge Risk Report",
    "",
    "### Summary",
    "- watched branches: 4",
    "",
    "### Confirmed Conflicts",
    "",
    "#### `feature/a` ↔ `main`",
    "- status: `confirmed_conflict`",
    "- AI Analysis:",
    "  - status: `skipped`",
    "  - reason: `not_target`",
    "",
    "#### `feature/b` ↔ `main`",
    "- status: `confirmed_conflict`",
    "- AI Analysis:",
    "  - status: `failed`",
    "  - error: provider failed",
    "",
    "#### `feature/c` ↔ `main`",
    "- status: `confirmed_conflict`",
    "- AI Analysis:",
    "  - status: `predicted`",
    "- Recommended Resolution:",
    "  - strategy: `merge`",
    "- Suggested Patch:",
    "  - `src/c.ts`: resolve conflict",
    "    ```diff",
    "    +const resolved = true",
    "    ```",
    "",
    "### Potential Risks",
    "",
    "#### `feature/d` ↔ `main`",
    "- status: `potential_overlap`",
    "- AI Analysis:",
    "  - status: `predicted`",
    "- Recommended Resolution:",
    "  - strategy: `rebase`",
    "- Preventive Actions:",
    "  - Separate edits: move changes to another file"
  ].join("\n"))
  const pairMessages = messages.filter(message => message.pairLabel)

  assert.deepEqual(
    pairMessages.map(message => [message.pairLabel, message.fragmentNumber]),
    [
      ["`feature/a` ↔ `main`", 1],
      ["`feature/a` ↔ `main`", 2],
      ["`feature/b` ↔ `main`", 1],
      ["`feature/b` ↔ `main`", 2],
      ["`feature/c` ↔ `main`", 1],
      ["`feature/c` ↔ `main`", 2],
      ["`feature/c` ↔ `main`", 3],
      ["`feature/c` ↔ `main`", 4],
      ["`feature/d` ↔ `main`", 1],
      ["`feature/d` ↔ `main`", 2],
      ["`feature/d` ↔ `main`", 3]
    ]
  )
  assert.match(pairMessages[7]?.content ?? "", /- Suggested Patch:/)
  assert.match(pairMessages[10]?.content ?? "", /- Preventive Actions:/)
  assert.match(
    pairMessages[10]?.content ?? "",
    /^#### `feature\/d` ↔ `main`\n- Recommended Resolution:/
  )
})

// 긴 AI 단위의 후속 조각에도 branch 조합 제목과 연속 번호를 유지하는지 확인
test("repeats the pair heading for continued AI fragments", () => {
  const pairLabel = "`feature/a` ↔ `main`"
  const messages = splitDiscordMessages([
    "## Merge Risk Report",
    "",
    "### Summary",
    "- watched branches: 1",
    "",
    "### Confirmed Conflicts",
    "",
    `#### ${pairLabel}`,
    "- status: `confirmed_conflict`",
    "- AI Analysis:",
    "  - status: `failed`",
    `  - error: ${"x".repeat(4100)}`
  ].join("\n"))
  const pairMessages = messages.filter(message => message.pairLabel)

  assert.equal(pairMessages.every(message => message.content.length <= 2000), true)
  assert.equal(
    pairMessages.slice(1).every(message =>
      message.content.startsWith(`#### ${pairLabel}\n`)
    ),
    true
  )
  assert.deepEqual(
    pairMessages.map(message => message.fragmentNumber),
    pairMessages.map((_, index) => index + 1)
  )
})

// 긴 Suggested Patch에 순번을 붙이고 모든 message의 fence를 닫는지 확인
test("numbers long suggested patch fragments and closes every code fence", () => {
  const patchLines = Array.from({ length: 500 }, (_, index) =>
    `    +const value${index.toString()} = "${"x".repeat(24)}"`
  )
  const messages = splitDiscordMessages(suggestedPatchReportFor([
    {
      descriptionLine: "  - `src/a.ts`: resolve conflict",
      openingFenceLine: "    ```diff",
      patchLines,
      closingFenceLine: "    ```"
    }
  ]))
  const patches = messages.filter(message =>
    message.content.includes("Suggested Patch (")
  )

  assert.equal(9 < patches.length, true)
  assert.equal(patches.every(message => message.content.length <= 2000), true)
  assert.deepEqual(
    patches.map(message =>
      message.content.match(/Suggested Patch \((\d+)\/(\d+)\)/)?.[1]
    ),
    patches.map((_, index) => (index + 1).toString())
  )
  assert.equal(
    patches.every(message =>
      message.content.match(/Suggested Patch \(\d+\/(\d+)\)/)?.[1] ===
        patches.length.toString()
    ),
    true
  )
  assert.equal(
    patches.every(message => hasClosedPatchFence(message.content)),
    true
  )
  assert.deepEqual(
    patches.flatMap(message => patchBodyLinesFor(message.content)),
    patchLines
  )
})

// Suggested Patch block이 정확히 2,000자면 유지하고 2,001자면 분할하는지 확인
test("splits suggested patch only after the 2000 character boundary", () => {
  const exactMarkdown = suggestedPatchReportWithBlockLength(2000)
  const overflowMarkdown = suggestedPatchReportWithBlockLength(2001)
  const exactMessages = splitDiscordMessages(exactMarkdown)
    .filter(message => message.content.includes("Suggested Patch"))
  const overflowMessages = splitDiscordMessages(overflowMarkdown)
    .filter(message => message.content.includes("Suggested Patch"))

  assert.equal(exactMessages.length, 1)
  assert.equal(exactMessages[0]?.content.length, 2000)
  assert.match(exactMessages[0]?.content ?? "", /- Suggested Patch:/)
  assert.doesNotMatch(exactMessages[0]?.content ?? "", /Suggested Patch \(/)
  assert.equal(overflowMessages.length, 2)
  assert.deepEqual(
    overflowMessages.map(message =>
      message.content.match(/Suggested Patch \((\d+)\/2\)/)?.[1]
    ),
    ["1", "2"]
  )
  assert.equal(
    overflowMessages.every(message => message.content.length <= 2000),
    true
  )
  assert.equal(
    overflowMessages.reduce(
      (count, message) => count + (message.content.match(/x/g) ?? []).length,
      0
    ),
    (overflowMarkdown.match(/x/g) ?? []).length
  )
})

// 여러 file patch와 formatter가 선택한 긴 fence를 원래 순서대로 유지하는지 확인
test("keeps multiple patch files and custom fences before the next pair", () => {
  const firstPatchLines = Array.from({ length: 90 }, (_, index) =>
    `    +const first${index.toString()} = "${"a".repeat(20)}"`
  )
  const secondPatchLines = [
    "    ```diff",
    ...Array.from({ length: 90 }, (_, index) =>
      `    +const second${index.toString()} = "${"b".repeat(20)}"`
    ),
    "    ```"
  ]
  const markdown = [
    suggestedPatchReportFor([
      {
        descriptionLine: "  - `src/a.ts`: keep first change",
        openingFenceLine: "    ```diff",
        patchLines: firstPatchLines,
        closingFenceLine: "    ```"
      },
      {
        descriptionLine: "  - `src/b.ts`: keep embedded fence",
        openingFenceLine: "    ````diff",
        patchLines: secondPatchLines,
        closingFenceLine: "    ````"
      }
    ]),
    "",
    "#### `feature/b` ↔ `main`",
    "- status: `confirmed_conflict`"
  ].join("\n")
  const messages = splitDiscordMessages(markdown)
  const patches = messages.filter(message =>
    message.content.includes("Suggested Patch (")
  )
  const descriptions = patches.map(message =>
    message.content.split("\n").find(line => line.startsWith("  - `src/"))
  )
  const secondPatchMessages = patches.filter(message =>
    message.content.includes("`src/b.ts`")
  )
  const nextPairIndex = messages.findIndex(message =>
    message.content.includes("#### `feature/b` ↔ `main`")
  )
  const lastPatchIndex = messages.map(message =>
    message.content.includes("Suggested Patch (")
  ).lastIndexOf(true)

  assert.equal(descriptions.includes("  - `src/a.ts`: keep first change"), true)
  assert.equal(descriptions.includes("  - `src/b.ts`: keep embedded fence"), true)
  assert.equal(
    descriptions.map(line => line?.includes("src/a.ts") ?? false).lastIndexOf(true) <
      descriptions.findIndex(line => line?.includes("src/b.ts")),
    true
  )
  assert.equal(
    secondPatchMessages.every(message =>
      message.content.includes("    ````diff") &&
      message.content.endsWith("    ````")
    ),
    true
  )
  assert.equal(lastPatchIndex < nextPairIndex, true)
})

// 완결되지 않은 patch 구조는 순번 재구성 없이 기존 길이 분할로 처리하는지 확인
test("falls back to generic splitting for an incomplete suggested patch", () => {
  const markdown = [
    "## Merge Risk Report",
    "",
    "### Summary",
    "- watched branches: 1",
    "",
    "### Confirmed Conflicts",
    "",
    "#### `feature/a` ↔ `main`",
    "- Suggested Patch:",
    "  - `src/a.ts`: missing closing fence",
    "    ```diff",
    `    +${"z".repeat(2500)}`
  ].join("\n")
  const messages = splitDiscordMessages(markdown)
  const pairMessages = messages.filter(message => message.pairLabel)

  assert.equal(
    pairMessages.some(message => message.content.includes("Suggested Patch (")),
    false
  )
  assert.equal(pairMessages.every(message => message.content.length <= 2000), true)
  assert.equal(
    pairMessages.reduce(
      (count, message) => count + (message.content.match(/z/g) ?? []).length,
      0
    ),
    2500
  )
})

type PatchInput = {
  descriptionLine: string
  openingFenceLine: string
  patchLines: string[]
  closingFenceLine: string
}

function suggestedPatchReportFor(patches: PatchInput[]): string {
  return [
    "## Merge Risk Report",
    "",
    "### Summary",
    "- watched branches: 1",
    "",
    "### Confirmed Conflicts",
    "",
    "#### `feature/a` ↔ `main`",
    "- Suggested Patch:",
    ...patches.flatMap(patch => [
      patch.descriptionLine,
      patch.openingFenceLine,
      ...patch.patchLines,
      patch.closingFenceLine
    ])
  ].join("\n")
}

function suggestedPatchReportWithBlockLength(length: number): string {
  const lines = [
    "#### `feature/a` ↔ `main`",
    "- Suggested Patch:",
    "  - `src/a.ts`: boundary",
    "    ```diff",
    "",
    "    ```"
  ]
  const fixedLength = lines.join("\n").length
  const patchLinePrefix = "    +"
  lines[4] = `${patchLinePrefix}${"x".repeat(
    length - fixedLength - patchLinePrefix.length
  )}`

  return [
    "## Merge Risk Report",
    "",
    "### Summary",
    "- watched branches: 1",
    "",
    "### Confirmed Conflicts",
    "",
    ...lines
  ].join("\n")
}

function hasClosedPatchFence(content: string): boolean {
  const lines = content.split("\n")
  const openingFenceIndex = lines.findIndex(line => /^    `{3,}diff$/.test(line))
  const openingFence = lines[openingFenceIndex]?.slice(4, -4)

  return openingFenceIndex >= 0 &&
    lines.at(-1) === `    ${openingFence ?? ""}`
}

function patchBodyLinesFor(content: string): string[] {
  const lines = content.split("\n")
  const openingFenceIndex = lines.findIndex(line => /^    `{3,}diff$/.test(line))

  return lines.slice(openingFenceIndex + 1, -1)
}
