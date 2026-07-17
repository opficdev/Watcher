import { createHash } from "node:crypto"

type AiPredictionPromptDebugEventInput = {
  targetBranches: Array<{
    branchName: string
    baseBranch: string
  }>
  prompt: {
    systemPrompt: string
    userPrompt: string
    responseShape?: string
  }
}

type AiPredictionResponseDebugEventInput = {
  targetBranches: Array<{
    branchName: string
    baseBranch: string
  }>
  response: unknown
}

export type AiPredictionPromptDebugArtifact = {
  targetBranches: Array<{
    branchName: string
    baseBranch: string
  }>
  prompt: {
    systemPrompt: string
    userPrompt: string
    responseShape?: string
  }
}

export type AiPredictionResponseDebugArtifact = {
  targetBranches: Array<{
    branchName: string
    baseBranch: string
  }>
  response: unknown
}

// OpenAI에 전달된 prompt event에서 consumer repository 코드 원문만 metadata로 치환
export function sanitizeAiPredictionPromptDebugEvent(
  event: AiPredictionPromptDebugEventInput
): AiPredictionPromptDebugArtifact {
  return {
    targetBranches: event.targetBranches.map(target => ({
      branchName: target.branchName,
      baseBranch: target.baseBranch
    })),
    prompt: {
      systemPrompt: event.prompt.systemPrompt,
      userPrompt: sanitizedUserPromptFor(event.prompt.userPrompt),
      ...(event.prompt.responseShape
        ? { responseShape: event.prompt.responseShape }
        : {})
    }
  }
}

// provider response에서 제안 patch 원문만 크기와 hunk metadata로 치환
export function sanitizeAiPredictionResponseDebugEvent(
  event: AiPredictionResponseDebugEventInput
): AiPredictionResponseDebugArtifact {
  return {
    targetBranches: event.targetBranches.map(target => ({
      branchName: target.branchName,
      baseBranch: target.baseBranch
    })),
    response: sanitizedResponseValueFor(event.response)
  }
}

// JSON prompt는 구조를 유지하고 비정형 prompt는 원문 없이 크기와 hash만 기록
function sanitizedUserPromptFor(userPrompt: string): string {
  try {
    return JSON.stringify(sanitizedJsonValueFor(JSON.parse(userPrompt)), null, 2)
  } catch {
    return JSON.stringify(contentMetadataFor(userPrompt, true), null, 2)
  }
}

// 중첩된 AI evidence에서 content 문자열을 제거하고 추적용 metadata를 추가
function sanitizedJsonValueFor(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizedJsonValueFor)
  }

  if (!isJsonObject(value)) {
    return value
  }

  const sanitized = Object.fromEntries(Object.entries(value)
    .filter(([name, item]) => name !== "content" || typeof item !== "string")
    .map(([name, item]) => [name, sanitizedJsonValueFor(item)]))
  const content = typeof value.content === "string" ? value.content : undefined

  if (content === undefined) {
    return sanitized
  }

  const startLine = typeof value.startLine === "number" ? value.startLine : undefined
  const endLine = typeof value.endLine === "number" ? value.endLine : undefined

  return {
    ...sanitized,
    ...contentMetadataFor(content),
    ...(startLine !== undefined && endLine !== undefined
      ? { lineCount: Math.max(endLine - startLine + 1, 0) }
      : {})
  }
}

// 코드 원문을 재현하지 않고 동일 문맥 여부와 크기만 비교할 metadata 구성
function contentMetadataFor(content: string, redacted = false): {
  contentByteLength: number
  contentHash: string
  redacted?: true
} {
  return {
    contentByteLength: Buffer.byteLength(content, "utf8"),
    contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
    ...(redacted ? { redacted: true as const } : {})
  }
}

// 중첩된 provider response에서 patch 문자열만 metadata로 변환
function sanitizedResponseValueFor(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizedResponseValueFor)
  }

  if (!isJsonObject(value)) {
    return value
  }

  return Object.fromEntries(Object.entries(value).map(([name, item]) => [
    name,
    name === "patch" && typeof item === "string"
      ? patchMetadataFor(item)
      : sanitizedResponseValueFor(item)
  ]))
}

// unified diff 원문을 저장하지 않고 크기와 변경 범위만 추적할 metadata 구성
function patchMetadataFor(patch: string): {
  byteLength: number
  lineCount: number
  hunkRanges: Array<{
    oldStart: number
    oldCount: number
    newStart: number
    newCount: number
  }>
} {
  return {
    byteLength: Buffer.byteLength(patch, "utf8"),
    lineCount: lineCountFor(patch),
    hunkRanges: hunkRangesFor(patch)
  }
}

// 마지막 줄바꿈은 별도 빈 줄로 세지 않고 patch 줄 수를 계산
function lineCountFor(value: string): number {
  if (value.length === 0) {
    return 0
  }

  const lines = value.split(/\r\n|\n|\r/)
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length
}

// unified diff hunk header의 기존/변경 line 범위를 입력 순서대로 추출
function hunkRangesFor(patch: string): Array<{
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}> {
  const ranges: Array<{
    oldStart: number
    oldCount: number
    newStart: number
    newCount: number
  }> = []
  const pattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm

  for (const match of patch.matchAll(pattern)) {
    ranges.push({
      oldStart: Number(match[1]),
      oldCount: Number(match[2] ?? "1"),
      newStart: Number(match[3]),
      newCount: Number(match[4] ?? "1")
    })
  }

  return ranges
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
