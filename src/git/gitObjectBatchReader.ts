import { GitObjectConflictMarkerStream } from "./gitObjectConflictMarkerCollector.js"
import {
  checkObjects,
  readObjects
} from "./gitObjectBatchProcess.js"
import type { GitObjectRequestGroup } from "./gitObjectBatchProcess.js"
import {
  GitObjectSnippetStream,
  SNIPPET_MAX_LINES,
  unavailableSnippet
} from "./gitObjectSnippetCollector.js"
import type {
  GitObjectSnippetRequest,
  MergeCodeContextLineRange,
  MergeCodeContextSnippet
} from "./types.js"

// 여러 Git object의 file 내용을 checkout 없이 묶음 조회
export async function readGitObjectSnippets(
  requests: GitObjectSnippetRequest[],
  options: { repositoryPath: string }
): Promise<ReadonlyMap<string, MergeCodeContextSnippet>> {
  if (!requests.length) {
    return new Map()
  }

  validateRequests(requests)
  const groups = groupRequests(requests)
  const checks = await checkObjects(groups, options.repositoryPath)
  const snippets = new Map<string, MergeCodeContextSnippet>()
  const readable = checks.filter(check => check.objectType === "blob")

  for (const check of checks) {
    if (check.objectType === "blob") {
      continue
    }

    for (const request of check.group.requests) {
      snippets.set(request.key, unavailableSnippet(request))
    }
  }

  await readObjects(
    readable,
    options.repositoryPath,
    new GitObjectSnippetStream(snippets)
  )

  return snippets
}

// merged object를 흘려 읽으며 conflict marker block의 line range만 수집
export async function readGitObjectConflictMarkerRanges(
  requests: GitObjectSnippetRequest[],
  options: { repositoryPath: string }
): Promise<ReadonlyMap<string, MergeCodeContextLineRange[]>> {
  if (!requests.length) {
    return new Map()
  }

  validateRequests(requests)
  const groups = groupRequests(requests)
  const checks = await checkObjects(groups, options.repositoryPath)
  const ranges = new Map<string, MergeCodeContextLineRange[]>()
  const readable = checks.filter(check => check.objectType === "blob")

  for (const check of checks) {
    if (check.objectType === "blob") {
      continue
    }

    for (const request of check.group.requests) {
      ranges.set(request.key, [])
    }
  }

  await readObjects(
    readable,
    options.repositoryPath,
    new GitObjectConflictMarkerStream(ranges)
  )

  return ranges
}

// 요청 key, OID, line range가 묶음 protocol에 안전한지 확인
function validateRequests(requests: GitObjectSnippetRequest[]): void {
  const keys = new Set<string>()

  for (const request of requests) {
    if (keys.has(request.key)) {
      throw new Error(`Duplicate Git object snippet key: ${request.key}`)
    }

    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(request.objectOid)) {
      throw new Error(`Invalid Git object OID for key ${request.key}`)
    }

    if (request.filePath.includes("\u0000")) {
      throw new Error(`Invalid Git object path for key ${request.key}`)
    }

    if (
      request.range.startLine < 1 ||
      request.range.endLine < request.range.startLine ||
      SNIPPET_MAX_LINES < request.range.endLine - request.range.startLine + 1
    ) {
      throw new Error(`Invalid Git object line range for key ${request.key}`)
    }

    keys.add(request.key)
  }
}

// 같은 object와 file 조합을 한 번만 읽도록 요청을 묶음
function groupRequests(
  requests: GitObjectSnippetRequest[]
): GitObjectRequestGroup[] {
  const groupsBySpec = new Map<string, GitObjectRequestGroup>()

  for (const request of requests) {
    const objectSpec = `${request.objectOid}:${request.filePath}`
    const group = groupsBySpec.get(objectSpec)

    if (group) {
      group.requests.push(request)
    } else {
      groupsBySpec.set(objectSpec, {
        objectSpec,
        requests: [request]
      })
    }
  }

  return [...groupsBySpec.values()]
}
