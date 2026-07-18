import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  sanitizeAiPredictionPairFailureDebugEvent,
  sanitizeAiPredictionPairPromptDebugEvent,
  sanitizeAiPredictionPairResponseDebugEvent
} from "../../src/debug/aiPredictionArtifact.js"

// pair prompt artifact에서 ordered targetPair를 유지하고 코드 원문을 제거
test("sanitizes pair AI prompt debug event", () => {
  const content = "const pairSourceMarker = true\n"
  const event = {
    targetPair: {
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    },
    prompt: {
      systemPrompt: "Review branch pair",
      userPrompt: JSON.stringify({
        snippet: {
          filePath: "Sources/Pair.swift",
          content,
          startLine: 7,
          endLine: 7
        }
      }),
      responseShape: "predictionPairCleanOverlap"
    }
  }

  const artifact = sanitizeAiPredictionPairPromptDebugEvent(event)
  const payload = JSON.parse(artifact.prompt.userPrompt) as {
    snippet?: Record<string, unknown>
  }

  assert.deepEqual(artifact.targetPair, event.targetPair)
  assert.deepEqual(payload.snippet, {
    filePath: "Sources/Pair.swift",
    startLine: 7,
    endLine: 7,
    contentByteLength: Buffer.byteLength(content, "utf8"),
    contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
    lineCount: 1
  })
  assert.doesNotMatch(JSON.stringify(artifact), /pairSourceMarker/)
  assert.equal(JSON.parse(event.prompt.userPrompt).snippet.content, content)
})

// 빈 pair 코드 문맥도 0 byte 원문 대신 line과 hash metadata를 기록하는지 확인
test("records metadata for empty pair AI prompt code context", () => {
  const artifact = sanitizeAiPredictionPairPromptDebugEvent({
    targetPair: {
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    },
    prompt: {
      systemPrompt: "Review branch pair",
      userPrompt: JSON.stringify({
        snippet: {
          filePath: "Sources/Empty.swift",
          content: "",
          startLine: 1,
          endLine: 1,
          truncated: false
        }
      }),
      responseShape: "predictionPairCleanOverlap"
    }
  })
  const payload = JSON.parse(artifact.prompt.userPrompt) as {
    snippet?: Record<string, unknown>
  }

  assert.deepEqual(payload.snippet, {
    filePath: "Sources/Empty.swift",
    startLine: 1,
    endLine: 1,
    truncated: false,
    contentByteLength: 0,
    contentHash: createHash("sha256").update("", "utf8").digest("hex"),
    lineCount: 1
  })
})

// 비정형 pair user prompt도 원문을 저장하지 않고 크기와 hash만 기록하는지 확인
test("redacts non-JSON pair AI user prompt", () => {
  const userPrompt = "consumer repository source"
  const artifact = sanitizeAiPredictionPairPromptDebugEvent({
    targetPair: {
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    },
    prompt: {
      systemPrompt: "Review branch pair",
      userPrompt,
      responseShape: "predictionPairCleanOverlap"
    }
  })

  assert.deepEqual(JSON.parse(artifact.prompt.userPrompt), {
    contentByteLength: Buffer.byteLength(userPrompt, "utf8"),
    contentHash: createHash("sha256").update(userPrompt, "utf8").digest("hex"),
    redacted: true
  })
  assert.doesNotMatch(JSON.stringify(artifact), /consumer repository source/)
})

// pair response artifact에서 ordered targetPair를 유지하고 patch 원문을 제거
test("sanitizes pair AI response debug event", () => {
  const patch = "@@ -1 +1 @@\n-let pairSourceMarker = false\n+let pairSourceMarker = true"
  const event = {
    targetPair: {
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    },
    response: {
      kind: "confirmed_conflict",
      patches: [{
        filePath: "Sources/Pair.swift",
        patch,
        reason: "충돌 상태 갱신"
      }]
    }
  }

  const artifact = sanitizeAiPredictionPairResponseDebugEvent(event)
  const response = artifact.response as {
    patches?: Array<Record<string, unknown>>
  }

  assert.deepEqual(artifact.targetPair, event.targetPair)
  assert.deepEqual(response.patches?.[0], {
    filePath: "Sources/Pair.swift",
    patch: {
      byteLength: Buffer.byteLength(patch, "utf8"),
      lineCount: 3,
      hunkRanges: [{
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 1
      }]
    },
    reason: "충돌 상태 갱신"
  })
  assert.doesNotMatch(JSON.stringify(artifact), /pairSourceMarker/)
  assert.equal(event.response.patches[0]?.patch, patch)
})

// pair AI 실패 원문을 저장하지 않고 metadata만 유지하는지 확인
test("redacts pair AI failure error message", () => {
  const errorMessage = "OpenAI failure echoed RAW_PATCH_MARKER"
  const artifact = sanitizeAiPredictionPairFailureDebugEvent({
    targetPair: {
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    },
    errorMessage
  })

  assert.deepEqual(artifact, {
    targetPair: {
      leftBranchName: "feature/left",
      rightBranchName: "feature/right"
    },
    error: {
      messageByteLength: Buffer.byteLength(errorMessage, "utf8"),
      messageHash: createHash("sha256")
        .update(errorMessage, "utf8")
        .digest("hex"),
      redacted: true
    }
  })
  assert.doesNotMatch(JSON.stringify(artifact), /RAW_PATCH_MARKER/)
})
