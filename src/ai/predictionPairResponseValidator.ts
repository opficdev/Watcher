import type { BranchComparisonPair } from "../branches/types.js"
import type {
  AiCleanOverlapResponse,
  AiConfirmedConflictResponse,
  AiPredictionPairEvidencePayload,
  AiPredictionPairIntegrationOrder,
  AiPredictionPairPatch,
  AiPredictionPairPreventiveAction,
  AiPredictionPairResponse
} from "./types.js"

// unknown provider 응답을 branch 조합 상태에 맞는 결과로 검증
export function validate(
  response: unknown,
  payload: AiPredictionPairEvidencePayload
): AiPredictionPairResponse {
  return payload.targetStatus === "confirmed_conflict"
    ? confirmedConflictResponseFor(response, payload)
    : cleanOverlapResponseFor(response, payload)
}

// 확정 conflict 응답의 구조와 evidence 참조 범위 검증
function confirmedConflictResponseFor(
  response: unknown,
  payload: AiPredictionPairEvidencePayload
): AiConfirmedConflictResponse {
  const value = objectFor(response, "response")
  literalFor(value.kind, "response.kind", "confirmed_conflict")
  assertOnlyKeys(value, "response", [
    "kind",
    "pair",
    "conflictCause",
    "integrationOrder",
    "patches"
  ])
  const pair = pairFor(value.pair, "response.pair")
  assertMatchingPair(pair, payload.pair)
  const conflictCause = causeFor(
    value.conflictCause,
    "response.conflictCause",
    evidenceFilesFor(payload)
  )
  const integrationOrder = integrationOrderFor(
    value.integrationOrder,
    "response.integrationOrder",
    payload.pair
  )
  const patchFiles = patchFilesFor(payload)
  const patches = nonEmptyArrayFor(value.patches, "response.patches")
    .map((patch, index) => patchFor(
      patch,
      `response.patches[${index}]`,
      patchFiles
    ))

  return {
    kind: "confirmed_conflict",
    pair,
    conflictCause,
    integrationOrder,
    patches
  }
}

// clean overlap 응답의 구조와 evidence 참조 범위 검증
function cleanOverlapResponseFor(
  response: unknown,
  payload: AiPredictionPairEvidencePayload
): AiCleanOverlapResponse {
  const value = objectFor(response, "response")
  literalFor(value.kind, "response.kind", "clean_overlap")
  assertOnlyKeys(value, "response", [
    "kind",
    "pair",
    "overlapCause",
    "integrationOrder",
    "preventiveActions"
  ])
  const pair = pairFor(value.pair, "response.pair")
  assertMatchingPair(pair, payload.pair)
  const files = evidenceFilesFor(payload)
  const overlapCause = causeFor(
    value.overlapCause,
    "response.overlapCause",
    files
  )
  const integrationOrder = integrationOrderFor(
    value.integrationOrder,
    "response.integrationOrder",
    payload.pair
  )
  const preventiveActions = nonEmptyArrayFor(
    value.preventiveActions,
    "response.preventiveActions"
  ).map((action, index) => preventiveActionFor(
    action,
    `response.preventiveActions[${index}]`,
    files
  ))

  return {
    kind: "clean_overlap",
    pair,
    overlapCause,
    integrationOrder,
    preventiveActions
  }
}

// 응답의 ordered pair가 요청한 branch 조합과 같은지 검증
function pairFor(
  response: unknown,
  path: string
): BranchComparisonPair {
  const value = objectFor(response, path)
  assertOnlyKeys(value, path, ["leftBranchName", "rightBranchName"])

  return {
    leftBranchName: stringFor(value.leftBranchName, `${path}.leftBranchName`),
    rightBranchName: stringFor(value.rightBranchName, `${path}.rightBranchName`)
  }
}

// conflict 또는 overlap 원인과 관련 파일 목록 검증
function causeFor(
  response: unknown,
  path: string,
  evidenceFiles: ReadonlySet<string>
): {
  summary: string
  files: string[]
} {
  const value = objectFor(response, path)
  assertOnlyKeys(value, path, ["summary", "files"])
  const files = nonEmptyStringArrayFor(value.files, `${path}.files`)
  assertEvidenceFiles(files, `${path}.files`, evidenceFiles)

  return {
    summary: stringFor(value.summary, `${path}.summary`),
    files
  }
}

// merge 또는 rebase 순서가 대상 branch 두 개만 사용하는지 검증
function integrationOrderFor(
  response: unknown,
  path: string,
  pair: BranchComparisonPair
): AiPredictionPairIntegrationOrder {
  const value = objectFor(response, path)
  assertOnlyKeys(value, path, [
    "strategy",
    "firstBranchName",
    "secondBranchName",
    "reason",
    "steps"
  ])
  const strategy = strategyFor(value.strategy, `${path}.strategy`)
  const firstBranchName = stringFor(
    value.firstBranchName,
    `${path}.firstBranchName`
  )
  const secondBranchName = stringFor(
    value.secondBranchName,
    `${path}.secondBranchName`
  )
  assertIntegrationBranches(firstBranchName, secondBranchName, pair)

  return {
    strategy,
    firstBranchName,
    secondBranchName,
    reason: stringFor(value.reason, `${path}.reason`),
    steps: nonEmptyStringArrayFor(value.steps, `${path}.steps`)
  }
}

// 확정 conflict의 patch가 제공된 파일만 대상으로 하는지 검증
function patchFor(
  response: unknown,
  path: string,
  evidenceFiles: ReadonlySet<string>
): AiPredictionPairPatch {
  const value = objectFor(response, path)
  assertOnlyKeys(value, path, ["filePath", "patch", "reason"])
  const filePath = stringFor(value.filePath, `${path}.filePath`)
  assertEvidenceFiles([filePath], `${path}.filePath`, evidenceFiles)

  return {
    filePath,
    patch: stringFor(value.patch, `${path}.patch`),
    reason: stringFor(value.reason, `${path}.reason`)
  }
}

// clean overlap 예방 조치가 제공된 파일만 참조하는지 검증
function preventiveActionFor(
  response: unknown,
  path: string,
  evidenceFiles: ReadonlySet<string>
): AiPredictionPairPreventiveAction {
  const value = objectFor(response, path)
  assertOnlyKeys(value, path, ["title", "description", "files"])
  const files = nonEmptyStringArrayFor(value.files, `${path}.files`)
  assertEvidenceFiles(files, `${path}.files`, evidenceFiles)

  return {
    title: stringFor(value.title, `${path}.title`),
    description: stringFor(value.description, `${path}.description`),
    files
  }
}

// 응답 pair의 좌우 이름과 순서가 요청과 같은지 검증
function assertMatchingPair(
  pair: BranchComparisonPair,
  expected: BranchComparisonPair
): void {
  if (
    pair.leftBranchName !== expected.leftBranchName ||
    pair.rightBranchName !== expected.rightBranchName
  ) {
    throw new Error(
      "AI prediction pair response must use matching ordered branch pair"
    )
  }
}

// 작업 순서가 대상 branch 두 개를 중복 없이 포함하는지 검증
function assertIntegrationBranches(
  firstBranchName: string,
  secondBranchName: string,
  pair: BranchComparisonPair
): void {
  const branchNames = new Set([
    pair.leftBranchName,
    pair.rightBranchName
  ])

  if (
    firstBranchName === secondBranchName ||
    !branchNames.has(firstBranchName) ||
    !branchNames.has(secondBranchName)
  ) {
    throw new Error(
      "AI prediction pair response integration order must use both target branches"
    )
  }
}

// 응답에 포함된 파일이 제공된 evidence 범위를 벗어나지 않는지 검증
function assertEvidenceFiles(
  files: string[],
  path: string,
  evidenceFiles: ReadonlySet<string>
): void {
  if (files.some(file => !evidenceFiles.has(file))) {
    throw new Error(
      `AI prediction pair response ${path} must use provided evidence files`
    )
  }
}

// 원인과 예방 조치가 참조할 수 있는 모든 evidence 파일 구성
function evidenceFilesFor(
  payload: AiPredictionPairEvidencePayload
): ReadonlySet<string> {
  return new Set([
    ...payload.reasons.flatMap(reason => reason.files ?? []),
    ...payload.merge.conflictFiles,
    ...payload.merge.conflicts.flatMap(conflict => conflict.paths),
    ...payload.codeContext.overlapFiles,
    ...payload.codeContext.evidence.map(evidence => evidence.filePath)
  ])
}

// patch가 참조할 수 있는 conflict와 코드 문맥 파일 구성
function patchFilesFor(
  payload: AiPredictionPairEvidencePayload
): ReadonlySet<string> {
  return new Set([
    ...payload.merge.conflictFiles,
    ...payload.merge.conflicts.flatMap(conflict => conflict.paths),
    ...payload.codeContext.overlapFiles,
    ...payload.codeContext.evidence.map(evidence => evidence.filePath)
  ])
}

// 응답 object가 상태별 schema key만 포함하는지 검증
function assertOnlyKeys(
  value: Record<string, unknown>,
  path: string,
  allowedKeys: string[]
): void {
  const allowed = new Set(allowedKeys)

  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new Error(
      `AI prediction pair response ${path} contains unsupported fields`
    )
  }
}

// unknown 값이 key 접근 가능한 object인지 검증
function objectFor(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`AI prediction pair response ${path} must be an object`)
  }

  return value as Record<string, unknown>
}

// unknown 배열이 한 개 이상의 항목을 포함하는지 검증
function nonEmptyArrayFor(
  value: unknown,
  path: string
): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `AI prediction pair response ${path} must be a non-empty array`
    )
  }

  return value
}

// unknown 배열이 비어 있지 않은 문자열만 포함하는지 검증
function nonEmptyStringArrayFor(
  value: unknown,
  path: string
): string[] {
  return nonEmptyArrayFor(value, path)
    .map((item, index) => stringFor(item, `${path}[${index}]`))
}

// unknown 값이 비어 있지 않은 문자열인지 검증
function stringFor(
  value: unknown,
  path: string
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `AI prediction pair response ${path} must be a non-empty string`
    )
  }

  return value
}

// 응답 상태 문자열이 요청한 상태와 같은지 검증
function literalFor<T extends string>(
  value: unknown,
  path: string,
  expected: T
): T {
  if (value !== expected) {
    throw new Error(
      `AI prediction pair response ${path} must be ${expected}`
    )
  }

  return expected
}

// 작업 방식이 merge 또는 rebase인지 검증
function strategyFor(
  value: unknown,
  path: string
): "merge" | "rebase" {
  if (value !== "merge" && value !== "rebase") {
    throw new Error(
      `AI prediction pair response ${path} must be merge or rebase`
    )
  }

  return value
}
