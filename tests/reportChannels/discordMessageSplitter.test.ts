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
