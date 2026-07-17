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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
