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
