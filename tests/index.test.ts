import test from "node:test"
import assert from "node:assert/strict"
import { watcherRuntimeDescription, watcherRuntimeName } from "../src/index.js"

test("exports Watcher runtime identity", () => {
  assert.equal(watcherRuntimeName, "Watcher")
  assert.equal(watcherRuntimeDescription(), "Watcher merge conflict probability automation")
})
