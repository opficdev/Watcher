import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { build as buildBranchComparisonPairs } from "../branches/branchPairBuilder.js"
import {
  ACTIVE_BRANCH_WINDOW_DAYS,
  selectWithReasons as selectBranchesWithReasons
} from "../branches/branchSelector.js"
import { collect as collectGitMergeCodeContextResults } from "../git/gitMergeCodeContextCollector.js"
import { collect as collectGitMergeTreeResults } from "../git/gitMergeTreeCollector.js"
import {
  buildEdges as buildBranchConflictGraphEdges,
  buildGraph as buildBranchConflictGraph
} from "../risks/conflictGraphBuilder.js"
import { createDefaultAiPredictionClient } from "../ai/openAiPredictionClient.js"
import { build as buildAiPredictionPairRequests } from "../ai/predictionPairRequestBuilder.js"
import { predict as predictBranchPairsWithAi } from "../ai/predictionPairRunner.js"
import { build as buildBranchPairMergeRiskReport } from "../reports/branchPairReportBuilder.js"
import { format as formatBranchPairMergeRiskReportMarkdown } from "../reports/branchPairMarkdownFormatter.js"
import { send as sendMergeRiskReport } from "../reportChannels/reportChannel.js"
import {
  sanitizeAiPredictionPairFailureDebugEvent,
  sanitizeAiPredictionPairPromptDebugEvent,
  sanitizeAiPredictionPairResponseDebugEvent
} from "../debug/aiPredictionArtifact.js"
import { writerFor as debugArtifactWriterFor } from "../debug/debugArtifact.js"
import type {
  AiPredictionPairEvidencePayload,
  AiPredictionPairResult
} from "../ai/types.js"
import type {
  BranchCheckMetadata,
  BranchPullRequestMetadata,
  RepositoryBranch
} from "../branches/types.js"
import type {
  BranchConflictGraphEdge
} from "../risks/types.js"

const execFileAsync = promisify(execFile)

type MergeRiskWatchOptions = {
  repository: string
  repositoryPath: string
  baseBranch: string
  defaultBranch?: string
  remoteName: string
  githubApiUrl: string
  githubToken?: string
  debugArtifactDir?: string
  workflowRef?: string
  fetch?: typeof fetch
}

type RemoteBranchLine = {
  ref: string
  sha: string
  author?: string
  updatedAt?: Date
}

type GitHubPullRequestResponse = {
  number?: number
  title?: string
  html_url?: string
  user?: {
    login?: string
  }
  head?: {
    ref?: string
  }
}

type GitHubCheckRunResponse = {
  name?: string
  status?: string
  conclusion?: string | null
}

type GitHubCheckRunsResponse = {
  check_runs?: GitHubCheckRunResponse[]
}

// GitHub Actions 환경 변수에서 Watcher 실행 옵션을 구성
export function optionsFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): MergeRiskWatchOptions {
  const repository = requiredEnv(env, "WATCHER_REPOSITORY")
  const repositoryPath = requiredEnv(env, "WATCHER_REPOSITORY_PATH")
  const baseBranch = requiredEnv(env, "WATCHER_BASE_BRANCH")
  const defaultBranch = optionalEnv(env, "WATCHER_DEFAULT_BRANCH")

  const debugArtifactDir = optionalEnv(env, "WATCHER_DEBUG_ARTIFACT_DIR")
  const workflowRef = optionalEnv(env, "WATCHER_WORKFLOW_REF")

  return {
    repository,
    repositoryPath,
    baseBranch,
    defaultBranch,
    remoteName: optionalEnv(env, "WATCHER_REMOTE_NAME") ?? "origin",
    githubApiUrl: optionalEnv(env, "WATCHER_GITHUB_API_URL") ?? "https://api.github.com",
    githubToken: optionalEnv(env, "GITHUB_TOKEN"),
    ...(debugArtifactDir ? { debugArtifactDir } : {}),
    ...(workflowRef ? { workflowRef } : {})
  }
}

// 환경 변수 기반으로 merge risk watch를 실행
export async function runFromEnvironment(): Promise<void> {
  await run(optionsFromEnvironment())
}

// local git checkout에서 branch 조합을 분석하고 report channel로 전송
export async function run(options: MergeRiskWatchOptions): Promise<void> {
  const generatedAt = new Date()
  const debugArtifactWriter = debugArtifactWriterFor(options.debugArtifactDir)

  await debugArtifactWriter?.writeJson("run.json", {
    repository: options.repository,
    repositoryPath: options.repositoryPath,
    baseBranch: options.baseBranch,
    defaultBranch: options.defaultBranch,
    remoteName: options.remoteName,
    githubApiUrl: options.githubApiUrl,
    workflowRef: options.workflowRef,
    generatedAt
  })

  const repositoryBranches = await branchSourceFor(options).listBranches()
  const branchSelection = selectBranchesWithReasons(repositoryBranches, {
    baseBranch: options.baseBranch,
    defaultBranch: options.defaultBranch
  }, generatedAt)
  const branches = branchSelection.selected
  const pairs = buildBranchComparisonPairs(options.baseBranch, branches)
  const pairResults = await collectGitMergeTreeResults(pairs, {
    repositoryPath: options.repositoryPath,
    remoteName: options.remoteName
  })
  const codeContextResults = await collectGitMergeCodeContextResults(pairResults, {
    repositoryPath: options.repositoryPath
  })
  const edges = buildBranchConflictGraphEdges(
    pairs,
    pairResults,
    codeContextResults
  )
  const graph = buildBranchConflictGraph(options.baseBranch, branches, edges)
  const payloads = buildAiPredictionPairRequests(
    graph.edges,
    pairResults,
    codeContextResults
  )
  const targetPairKeys = new Set(payloads.map(payload => pairKeyFor(payload.pair)))

  await debugArtifactWriter?.writeJson("branch-selection.json", {
    repositoryBranches,
    selectedBranches: branchSelection.selected,
    excludedBranches: branchSelection.excluded
  })
  await debugArtifactWriter?.writeJson("branch-pairs.json", {
    pairs
  })
  await debugArtifactWriter?.writeJson("deterministic-evidence.json", {
    pairResults,
    graph
  })
  await debugArtifactWriter?.writeJson("ai-target-selection.json", {
    targetPairs: payloads.map(aiTargetArtifactFor),
    skippedPairs: graph.edges
      .filter(edge => !targetPairKeys.has(pairKeyFor(edge.pair)))
      .map(aiSkippedArtifactFor)
  })

  const promptEvents: Array<ReturnType<
    typeof sanitizeAiPredictionPairPromptDebugEvent
  >> = []
  const responseEvents: Array<ReturnType<
    typeof sanitizeAiPredictionPairResponseDebugEvent
  >> = []
  const failureEvents: Array<ReturnType<
    typeof sanitizeAiPredictionPairFailureDebugEvent
  >> = []
  const predictions = payloads.length === 0
    ? []
    : await predictBranchPairsWithAi(
      payloads,
      createDefaultAiPredictionClient(),
      {
        debugObserver: debugArtifactWriter
          ? {
            // 생성된 pair prompt에서 코드 원문을 제거한 표현만 누적
            onPromptBuilt: event => {
              promptEvents.push(sanitizeAiPredictionPairPromptDebugEvent(event))
            },
            // 받은 pair response에서 patch 원문을 제거한 표현만 누적
            onResponseReceived: event => {
              responseEvents.push(sanitizeAiPredictionPairResponseDebugEvent(event))
            },
            // pair prediction 실패 원문을 제거한 표현만 누적
            onPredictionFailed: event => {
              failureEvents.push(
                sanitizeAiPredictionPairFailureDebugEvent(event)
              )
            }
          }
          : undefined
      }
    )

  if (debugArtifactWriter && 0 < promptEvents.length) {
    await debugArtifactWriter.writeJson("ai-prompt.json", {
      events: promptEvents
    })
  }

  if (debugArtifactWriter && 0 < responseEvents.length) {
    await debugArtifactWriter.writeJson("ai-response.json", {
      events: responseEvents
    })
  }

  if (debugArtifactWriter && 0 < failureEvents.length) {
    await debugArtifactWriter.writeJson("ai-error.json", {
      events: failureEvents
    })
  }

  await debugArtifactWriter?.writeJson("ai-result.json", {
    predictions: predictions.map(aiResultArtifactFor)
  })

  const report = buildBranchPairMergeRiskReport({
    generatedAt,
    activeBranchWindowDays: ACTIVE_BRANCH_WINDOW_DAYS,
    discoveredBranchCount: repositoryBranches.length,
    watchedBranches: branches,
    excludedBranches: branchSelection.excluded,
    graph,
    mergeResults: pairResults,
    aiResults: predictions
  })
  const markdown = formatBranchPairMergeRiskReportMarkdown(report)
  const result = await sendMergeRiskReport({
    markdown
  })

  if (!result.ok) {
    throw new Error(result.errorMessage)
  }
}

// AI 대상 artifact에 ordered pair와 deterministic 상태만 기록
function aiTargetArtifactFor(payload: AiPredictionPairEvidencePayload): {
  pair: AiPredictionPairEvidencePayload["pair"]
  status: AiPredictionPairEvidencePayload["targetStatus"]
} {
  return {
    pair: payload.pair,
    status: payload.targetStatus
  }
}

// AI 대상이 아닌 edge의 상태와 reason code만 기록
function aiSkippedArtifactFor(edge: BranchConflictGraphEdge): {
  pair: BranchConflictGraphEdge["pair"]
  status: BranchConflictGraphEdge["status"]
  reasons: Array<BranchConflictGraphEdge["reasons"][number]["code"]>
  reason: "not_target"
} {
  return {
    pair: edge.pair,
    status: edge.status,
    reasons: edge.reasons.map(reason => reason.code),
    reason: "not_target"
  }
}

// validated pair 결과에서 patch와 실패 원문을 제거한 artifact를 구성
function aiResultArtifactFor(result: AiPredictionPairResult): unknown {
  if (result.status === "failed") {
    const failure = sanitizeAiPredictionPairFailureDebugEvent({
      targetPair: result.pair,
      errorMessage: result.errorMessage
    })

    return {
      status: result.status,
      pair: result.pair,
      error: failure.error
    }
  }

  return {
    ...result,
    response: sanitizeAiPredictionPairResponseDebugEvent({
      targetPair: result.pair,
      response: result.response
    }).response
  }
}

// 좌우 branch 순서를 보존하는 artifact 선택 key를 구성
function pairKeyFor(pair: {
  leftBranchName: string
  rightBranchName: string
}): string {
  return `${pair.leftBranchName}\u0000${pair.rightBranchName}`
}

// remote tracking branch 목록을 BranchSource로 제공
function branchSourceFor(options: MergeRiskWatchOptions): {
  listBranches(): Promise<RepositoryBranch[]>
} {
  const github = options.githubToken
    ? githubMetadataClientFor(options)
    : undefined

  return {
    // remote tracking branch와 선택적 GitHub metadata를 함께 수집
    listBranches: async () => {
      const lines = await gitLines(options.repositoryPath, [
        "for-each-ref",
        `refs/remotes/${options.remoteName}`,
        "--format=%(refname:short)%09%(objectname)%09%(authorname)%09%(committerdate:iso-strict)"
      ])

      const branches = lines
        .map(line => remoteBranchLineFrom(line))
        .filter(line => line.ref !== `${options.remoteName}/HEAD`)
        .map(line => {
          const name = branchNameFrom(line.ref, options.remoteName)

          return {
            name,
            sha: line.sha,
            author: line.author,
            updatedAt: line.updatedAt
          }
        })

      return Promise.all(branches.map(async branch => ({
        ...branch,
        checks: github ? await github.checksFor(branch.sha) : [],
        pullRequest: github ? await github.pullRequestFor(branch.sha, branch.name) : undefined
      })))
    }
  }
}

// GitHub REST API에서 branch optional metadata를 조회하는 client를 구성
export function githubMetadataClientFor(options: MergeRiskWatchOptions): {
  checksFor(ref: string): Promise<BranchCheckMetadata[]>
  pullRequestFor(sha: string, branchName: string): Promise<BranchPullRequestMetadata | undefined>
} {
  const [owner, repo] = repositoryPartsFrom(options.repository)

  return {
    // commit ref의 GitHub check run metadata를 조회하고 실패 시 빈 목록으로 격리
    checksFor: async ref => {
      try {
        const response = await githubJson<GitHubCheckRunsResponse>(options, [
          "repos",
          owner,
          repo,
          "commits",
          ref,
          "check-runs"
        ], {
          per_page: "100"
        })

        return (response.check_runs ?? [])
          .map(check => ({
            name: check.name ?? "unknown",
            status: check.status ?? "unknown",
            conclusion: check.conclusion ?? undefined
          }))
      } catch (error) {
        console.warn(`GitHub check metadata request failed: ${warningMessageFor(error)}`)
        return []
      }
    },
    // commit과 연결된 pull request에서 branch 일치 항목을 우선하고 없으면 첫 metadata를 사용
    pullRequestFor: async (sha, branchName) => {
      const pulls = await githubJson<GitHubPullRequestResponse[]>(options, [
        "repos",
        owner,
        repo,
        "commits",
        sha,
        "pulls"
      ])
      const pull = pulls.find(candidate => candidate.head?.ref === branchName) ?? pulls[0]

      if (!pull?.number || !pull.title || !pull.html_url) {
        return undefined
      }

      return {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        author: pull.user?.login
      }
    }
  }
}

// unknown error를 경고에 사용할 문자열로 변환
function warningMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// raw git line을 remote branch metadata로 변환
function remoteBranchLineFrom(line: string): RemoteBranchLine {
  const [ref = "", sha = "", author, rawUpdatedAt] = line.split("\t")
  const updatedAt = rawUpdatedAt ? new Date(rawUpdatedAt) : undefined

  return {
    ref,
    sha,
    author: author || undefined,
    updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : undefined
  }
}

// refs/remotes/origin/name에서 branch name만 추출
function branchNameFrom(ref: string, remoteName: string): string {
  const prefix = `${remoteName}/`
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : ref
}

// owner/repo 형식의 repository 입력을 REST API path segment로 분리
function repositoryPartsFrom(repository: string): [string, string] {
  const [owner, repo] = repository.split("/")
  if (!owner || !repo) {
    throw new Error("WATCHER_REPOSITORY must use owner/repo format")
  }

  return [owner, repo]
}

// GitHub REST API response를 JSON으로 읽고 실패 status를 명확한 오류로 변환
async function githubJson<T>(
  options: MergeRiskWatchOptions,
  segments: string[],
  query: Record<string, string> = {}
): Promise<T> {
  const fetcher = options.fetch ?? fetch
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  }

  if (options.githubToken) {
    headers["Authorization"] = `Bearer ${options.githubToken}`
  }

  const response = await fetcher(githubUrlFor(options.githubApiUrl, segments, query), {
    headers
  })

  if (!response.ok) {
    throw new Error(`GitHub metadata request failed with status ${response.status}`)
  }

  return await response.json() as T
}

// base API URL과 path segment, query를 안전하게 조합
function githubUrlFor(
  apiUrl: string,
  segments: string[],
  query: Record<string, string>
): string {
  const base = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`
  const url = new URL(segments.map(encodeURIComponent).join("/"), base)

  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value)
  }

  return url.toString()
}

// stdout을 단일 문자열로 반환하는 git command helper
async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd })
  return stdout.trim()
}

// stdout을 빈 줄 없이 line 단위로 반환하는 git command helper
async function gitLines(cwd: string, args: string[]): Promise<string[]> {
  const output = await gitOutput(cwd, args)
  return output ? output.split("\n").filter(Boolean) : []
}

// 필수 환경 변수가 비어 있으면 실행 전에 명확히 실패
function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = optionalEnv(env, name)
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

// 공백뿐인 환경 변수는 미설정으로 취급
function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

// package script로 직접 실행된 경우에만 runner를 시작
function isDirectExecution(): boolean {
  return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")
}

if (isDirectExecution()) {
  runFromEnvironment().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
