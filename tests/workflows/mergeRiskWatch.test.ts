import test from "node:test"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  githubMetadataClientFor,
  optionsFromEnvironment,
  run
} from "../../src/workflows/mergeRiskWatch.js"

const execFileAsync = promisify(execFile)

// GitHub Actions 환경 변수에서 Watcher 실행 옵션을 구성하는지 확인
test("builds merge risk watch options from environment", () => {
  const options = optionsFromEnvironment({
    WATCHER_REPOSITORY: "opficdev/Watcher",
    WATCHER_REPOSITORY_PATH: "/tmp/repository",
    WATCHER_BASE_BRANCH: "develop",
    WATCHER_DEFAULT_BRANCH: "main",
    WATCHER_GITHUB_API_URL: "https://api.github.test",
    WATCHER_DEBUG_ARTIFACT_DIR: "/tmp/watcher-debug",
    WATCHER_WORKFLOW_REF: "opficdev/Watcher/.github/workflows/merge-risk-watch.yml@develop",
    GITHUB_TOKEN: "github-token"
  })

  assert.deepEqual(options, {
    repository: "opficdev/Watcher",
    repositoryPath: "/tmp/repository",
    baseBranch: "develop",
    defaultBranch: "main",
    remoteName: "origin",
    githubApiUrl: "https://api.github.test",
    githubToken: "github-token",
    debugArtifactDir: "/tmp/watcher-debug",
    workflowRef: "opficdev/Watcher/.github/workflows/merge-risk-watch.yml@develop"
  })
})

// optional 값이 비어 있으면 미설정으로 취급하는지 확인
test("omits empty optional environment values", () => {
  const options = optionsFromEnvironment({
    WATCHER_REPOSITORY: "opficdev/Watcher",
    WATCHER_REPOSITORY_PATH: "/tmp/repository",
    WATCHER_BASE_BRANCH: "develop",
    WATCHER_DEFAULT_BRANCH: "   ",
    GITHUB_TOKEN: "   "
  })

  assert.deepEqual(options, {
    repository: "opficdev/Watcher",
    repositoryPath: "/tmp/repository",
    baseBranch: "develop",
    defaultBranch: undefined,
    remoteName: "origin",
    githubApiUrl: "https://api.github.com",
    githubToken: undefined
  })
})

// debug directory가 설정되면 pair 분석 artifact를 원문 없이 생성하는지 확인
test("writes pair merge risk debug artifacts", async () => {
  const fixture = await createWorkflowGitFixture()
  const originalFetch = globalThis.fetch
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY
  const originalDiscordWebhookUrl = process.env.DISCORD_WEBHOOK_URL
  let openAiRequestCount = 0
  let openAiUserPrompt: string | undefined

  process.env.OPENAI_API_KEY = "openai-secret"
  process.env.DISCORD_WEBHOOK_URL = "https://discord.test/webhook-secret"
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)

    if (request.url === "https://discord.test/webhook-secret") {
      return new Response(null, { status: 204 })
    }

    openAiRequestCount += 1
    assert.equal(request.url, "https://api.openai.com/v1/responses")
    assert.equal(request.headers.get("Authorization"), "Bearer openai-secret")
    const requestBody = await request.json() as {
      input?: Array<{
        role?: string
        content?: string
      }>
    }
    openAiUserPrompt = requestBody.input
      ?.find(item => item.role === "user")
      ?.content

    return jsonResponse({
      output_text: JSON.stringify(cleanOverlapResponse({
        leftBranchName: "feature/critical",
        rightBranchName: "feature/critical-peer"
      }))
    })
  }

  try {
    await run({
      ...baseOptions(),
      githubToken: undefined,
      repositoryPath: fixture.repositoryPath,
      baseBranch: "main",
      debugArtifactDir: fixture.debugArtifactDir,
      workflowRef: "opficdev/Watcher/.github/workflows/merge-risk-watch.yml@feat/#49"
    })

    const files = (await readdir(fixture.debugArtifactDir)).sort()
    assert.deepEqual(files, [
      "ai-prompt.json",
      "ai-response.json",
      "ai-result.json",
      "ai-target-selection.json",
      "branch-pairs.json",
      "branch-selection.json",
      "deterministic-evidence.json",
      "run.json"
    ])

    const aiPromptArtifact = await readJson<{
      events?: Array<{
        targetPair?: {
          leftBranchName?: string
          rightBranchName?: string
        }
        prompt?: {
          userPrompt?: string
        }
      }>
    }>(fixture.debugArtifactDir, "ai-prompt.json")
    const deterministicArtifact = await readJson<{
      graph?: {
        edges?: Array<{
          pair?: {
            leftBranchName?: string
            rightBranchName?: string
          }
          status?: string
          reasons?: Array<{
            code?: string
          }>
        }>
      }
    }>(fixture.debugArtifactDir, "deterministic-evidence.json")
    const targetArtifact = await readJson<{
      targetPairs?: Array<{
        pair?: {
          leftBranchName?: string
          rightBranchName?: string
        }
        status?: string
      }>
      skippedPairs?: unknown[]
    }>(fixture.debugArtifactDir, "ai-target-selection.json")
    const resultArtifact = await readJson<{
      predictions?: Array<{
        status?: string
        pair?: {
          leftBranchName?: string
          rightBranchName?: string
        }
      }>
    }>(fixture.debugArtifactDir, "ai-result.json")
    const combinedArtifact = (await Promise.all(files.map(file =>
      readFile(join(fixture.debugArtifactDir, file), "utf8")
    ))).join("\n")

    assert.equal(openAiRequestCount, 1)
    assert.ok(openAiUserPrompt)
    assert.equal(aiPromptArtifact.events?.length, 1)
    assert.notEqual(aiPromptArtifact.events?.[0]?.prompt?.userPrompt, openAiUserPrompt)
    assert.deepEqual(aiPromptArtifact.events?.[0]?.targetPair, {
      leftBranchName: "feature/critical",
      rightBranchName: "feature/critical-peer"
    })
    const potentialEdge = deterministicArtifact.graph?.edges?.find(edge =>
      edge.pair?.leftBranchName === "feature/critical" &&
      edge.pair.rightBranchName === "feature/critical-peer"
    )
    assert.equal(potentialEdge?.status, "potential_overlap")
    assert.deepEqual(potentialEdge?.reasons?.map(reason => reason.code), [
      "same_hunk_overlap",
      "same_file_overlap"
    ])
    assert.deepEqual(targetArtifact.targetPairs, [{
      pair: {
        leftBranchName: "feature/critical",
        rightBranchName: "feature/critical-peer"
      },
      status: "potential_overlap"
    }])
    assert.equal(targetArtifact.skippedPairs?.length, 2)
    assert.equal(resultArtifact.predictions?.[0]?.status, "predicted")
    assert.deepEqual(resultArtifact.predictions?.[0]?.pair, {
      leftBranchName: "feature/critical",
      rightBranchName: "feature/critical-peer"
    })
    assert.equal(await git(fixture.repositoryPath, ["status", "--porcelain=v1"]), "")
    assert.doesNotMatch(combinedArtifact, /openai-secret/)
    assert.doesNotMatch(combinedArtifact, /webhook-secret/)
    assert.doesNotMatch(combinedArtifact, /feature critical content/)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey)
    restoreEnv("DISCORD_WEBHOOK_URL", originalDiscordWebhookUrl)
    await fixture.remove()
  }
})

// 확정 conflict 조합을 한 번만 AI로 분석하고 patch 원문은 artifact에서 제거하는지 확인
test("predicts confirmed conflict pair once", async () => {
  const fixture = await createWorkflowGitFixture({
    peerContent: "peer critical content\n"
  })
  const summaryPath = join(fixture.debugArtifactDir, "summary.md")
  const originalFetch = globalThis.fetch
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY
  const originalDiscordWebhookUrl = process.env.DISCORD_WEBHOOK_URL
  let openAiRequestCount = 0
  let discordReport = ""

  process.env.OPENAI_API_KEY = "openai-secret"
  process.env.DISCORD_WEBHOOK_URL = "https://discord.test/webhook-secret"
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)

    if (request.url === "https://discord.test/webhook-secret") {
      discordReport += String((await request.json() as { content?: string }).content ?? "")
      return new Response(null, { status: 204 })
    }

    openAiRequestCount += 1
    return jsonResponse({
      output_text: JSON.stringify(confirmedConflictResponse({
        leftBranchName: "feature/critical",
        rightBranchName: "feature/critical-peer"
      }))
    })
  }

  try {
    await run({
      ...baseOptions(),
      githubToken: undefined,
      repositoryPath: fixture.repositoryPath,
      baseBranch: "main",
      debugArtifactDir: fixture.debugArtifactDir,
      reportDeliveryOptions: {
        githubStepSummaryPath: summaryPath
      }
    })

    const resultArtifact = await readFile(
      join(fixture.debugArtifactDir, "ai-result.json"),
      "utf8"
    )
    const summaryReport = await readFile(summaryPath, "utf8")

    assert.equal(openAiRequestCount, 1)
    assert.match(discordReport, /resolved critical content/)
    assert.match(summaryReport, /`feature\/critical` ↔ `feature\/critical-peer`/)
    assert.match(summaryReport, /resolved critical content/)
    assert.doesNotMatch(resultArtifact, /resolved critical content/)
    assert.equal((await readdir(fixture.debugArtifactDir)).includes("report.md"), false)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey)
    restoreEnv("DISCORD_WEBHOOK_URL", originalDiscordWebhookUrl)
    await fixture.remove()
  }
})

// provider 오류 원문이 실패 artifact에 기록되지 않는지 확인
test("redacts provider error detail from debug artifacts", async () => {
  const fixture = await createWorkflowGitFixture()
  const originalFetch = globalThis.fetch
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY
  const originalDiscordWebhookUrl = process.env.DISCORD_WEBHOOK_URL
  const marker = "RAW_PATCH_MARKER"

  process.env.OPENAI_API_KEY = "openai-secret"
  process.env.DISCORD_WEBHOOK_URL = "https://discord.test/webhook-secret"
  globalThis.fetch = async input => {
    const request = new Request(input)

    if (request.url === "https://discord.test/webhook-secret") {
      return new Response(null, { status: 204 })
    }

    return new Response(JSON.stringify({
      error: {
        message: marker
      }
    }), { status: 500 })
  }

  try {
    await run({
      ...baseOptions(),
      githubToken: undefined,
      repositoryPath: fixture.repositoryPath,
      baseBranch: "main",
      debugArtifactDir: fixture.debugArtifactDir
    })

    const errorArtifact = await readFile(
      join(fixture.debugArtifactDir, "ai-error.json"),
      "utf8"
    )
    const resultArtifact = await readFile(
      join(fixture.debugArtifactDir, "ai-result.json"),
      "utf8"
    )

    assert.doesNotMatch(errorArtifact, new RegExp(marker))
    assert.doesNotMatch(resultArtifact, new RegExp(marker))
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey)
    restoreEnv("DISCORD_WEBHOOK_URL", originalDiscordWebhookUrl)
    await fixture.remove()
  }
})

// same-file-only와 clean 조합은 API key 없이도 AI 호출을 생략하는지 확인
test("skips AI calls for same-file-only and clean pairs", async () => {
  const fixture = await createWorkflowGitFixture({
    separateHunks: true
  })
  const originalFetch = globalThis.fetch
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY
  const originalDiscordWebhookUrl = process.env.DISCORD_WEBHOOK_URL

  delete process.env.OPENAI_API_KEY
  process.env.DISCORD_WEBHOOK_URL = "https://discord.test/webhook-secret"
  globalThis.fetch = async input => {
    assert.equal(new Request(input).url, "https://discord.test/webhook-secret")
    return new Response(null, { status: 204 })
  }

  try {
    await run({
      ...baseOptions(),
      githubToken: undefined,
      repositoryPath: fixture.repositoryPath,
      baseBranch: "main",
      debugArtifactDir: fixture.debugArtifactDir
    })

    const artifact = await readJson<{
      targetPairs?: unknown[]
      skippedPairs?: Array<{
        status?: string
        reasons?: string[]
      }>
    }>(fixture.debugArtifactDir, "ai-target-selection.json")

    assert.deepEqual(artifact.targetPairs, [])
    assert.equal(artifact.skippedPairs?.length, 3)
    assert.equal(artifact.skippedPairs?.some(pair =>
      pair.status === "potential_overlap" &&
      pair.reasons?.includes("same_file_overlap")
    ), true)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey)
    restoreEnv("DISCORD_WEBHOOK_URL", originalDiscordWebhookUrl)
    await fixture.remove()
  }
})

// fetch 실패 조합은 API key 없이 error로 유지하고 AI 호출을 만들지 않는지 확인
test("keeps pair merge errors without AI calls", async () => {
  const fixture = await createWorkflowGitFixture()
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY
  const originalDiscordWebhookUrl = process.env.DISCORD_WEBHOOK_URL
  const originalFetch = globalThis.fetch

  delete process.env.OPENAI_API_KEY
  process.env.DISCORD_WEBHOOK_URL = "https://discord.test/webhook-secret"
  globalThis.fetch = async input => {
    assert.equal(new Request(input).url, "https://discord.test/webhook-secret")
    return new Response(null, { status: 204 })
  }

  try {
    await git(fixture.repositoryPath, [
      "remote",
      "set-url",
      "origin",
      join(fixture.repositoryPath, "missing-remote.git")
    ])
    await run({
      ...baseOptions(),
      githubToken: undefined,
      repositoryPath: fixture.repositoryPath,
      baseBranch: "main",
      debugArtifactDir: fixture.debugArtifactDir
    })

    const artifact = await readJson<{
      pairResults?: Array<{
        status?: string
      }>
      graph?: {
        edges?: Array<{
          status?: string
        }>
      }
    }>(fixture.debugArtifactDir, "deterministic-evidence.json")
    const targetArtifact = await readJson<{
      targetPairs?: unknown[]
    }>(fixture.debugArtifactDir, "ai-target-selection.json")

    assert.equal(artifact.pairResults?.length, 3)
    assert.equal(artifact.pairResults?.every(result =>
      result.status === "merge_check_failed"
    ), true)
    assert.equal(artifact.graph?.edges?.every(edge => edge.status === "error"), true)
    assert.deepEqual(targetArtifact.targetPairs, [])
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey)
    restoreEnv("DISCORD_WEBHOOK_URL", originalDiscordWebhookUrl)
    await fixture.remove()
  }
})

// 필수 환경 변수가 없으면 실행 전에 명확한 오류로 실패하는지 확인
test("throws when required environment is missing", () => {
  assert.throws(
    () => optionsFromEnvironment({
      WATCHER_REPOSITORY: "opficdev/Watcher",
      WATCHER_BASE_BRANCH: "develop"
    }),
    /WATCHER_REPOSITORY_PATH is required/
  )
})

// GitHub Check Runs API 응답을 branch check metadata로 변환하는지 확인
test("collects check metadata from GitHub check runs API", async () => {
  const requests: Request[] = []
  const client = githubMetadataClientFor({
    ...baseOptions(),
    fetch: async (input, init) => {
      requests.push(new Request(input, init))

      return jsonResponse({
        check_runs: [{
          name: "CI / Test",
          status: "completed",
          conclusion: "success"
        }]
      })
    }
  })

  const checks = await client.checksFor("abc123")

  assert.equal(
    requests[0]?.url,
    "https://api.github.test/repos/opficdev/Watcher/commits/abc123/check-runs?per_page=100"
  )
  assert.equal(requests[0]?.headers.get("Authorization"), "Bearer github-token")
  assert.deepEqual(checks, [{
    name: "CI / Test",
    status: "completed",
    conclusion: "success"
  }])
})

// check run metadata 조회 실패가 branch 수집 실패로 전파되지 않는지 확인
test("returns empty check metadata when GitHub check runs request fails", async () => {
  const client = githubMetadataClientFor({
    ...baseOptions(),
    fetch: async () => new Response("{}", {
      status: 403,
      headers: {
        "Content-Type": "application/json"
      }
    })
  })

  const checks = await suppressConsoleWarn(() => client.checksFor("abc123"))

  assert.deepEqual(checks, [])
})

// commit에 연결된 PR 목록에서 branch와 맞는 Pull Request metadata를 선택하는지 확인
test("collects pull request metadata for matching branch", async () => {
  const client = githubMetadataClientFor({
    ...baseOptions(),
    fetch: async () => jsonResponse([{
      number: 10,
      title: "other branch",
      html_url: "https://github.test/pull/10",
      head: {
        ref: "feature/other"
      }
    }, {
      number: 11,
      title: "feature branch",
      html_url: "https://github.test/pull/11",
      user: {
        login: "opfic"
      },
      head: {
        ref: "feature/watch"
      }
    }])
  })

  const pullRequest = await client.pullRequestFor("abc123", "feature/watch")

  assert.deepEqual(pullRequest, {
    number: 11,
    title: "feature branch",
    url: "https://github.test/pull/11",
    author: "opfic"
  })
})

// GitHub token이 없으면 빈 Authorization header를 보내지 않는지 확인
test("omits authorization header when GitHub token is missing", async () => {
  const requests: Request[] = []
  const client = githubMetadataClientFor({
    ...baseOptions(),
    githubToken: undefined,
    fetch: async (input, init) => {
      requests.push(new Request(input, init))

      return jsonResponse({
        check_runs: []
      })
    }
  })

  await client.checksFor("abc123")

  assert.equal(requests[0]?.headers.has("Authorization"), false)
})

function baseOptions() {
  return {
    repository: "opficdev/Watcher",
    repositoryPath: "/tmp/repository",
    baseBranch: "develop",
    remoteName: "origin",
    githubApiUrl: "https://api.github.test",
    githubToken: "github-token",
    reportDeliveryOptions: {
      githubStepSummaryPath: "",
      stdout: {
        write: () => true
      }
    }
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  })
}

async function createWorkflowGitFixture(options: {
  peerContent?: string
  separateHunks?: boolean
} = {}): Promise<{
  repositoryPath: string
  debugArtifactDir: string
  committerDate: string
  remove(): Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), "watcher-workflow-fixture-"))
  const repositoryPath = join(root, "repository")
  const remotePath = join(root, "remote.git")
  const debugArtifactDir = join(root, "debug")
  const committerDate = new Date(Math.floor(Date.now() / 1_000) * 1_000).toISOString()
  const commitDates = {
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00.000Z",
    GIT_COMMITTER_DATE: committerDate
  }
  const baseContent = options.separateHunks
    ? "first line\nshared line\nthird line\n"
    : "base content\n"
  const featureContent = options.separateHunks
    ? "feature line\nshared line\nthird line\n"
    : "feature critical content\n"
  const peerContent = options.separateHunks
    ? "first line\nshared line\npeer line\n"
    : options.peerContent ?? "feature critical content\n"

  await git(root, ["init", "--initial-branch=main", repositoryPath])
  await git(repositoryPath, ["config", "user.email", "opfic@example.com"])
  await git(repositoryPath, ["config", "user.name", "opfic"])

  await writeFile(join(repositoryPath, "critical.txt"), baseContent)
  await git(repositoryPath, ["add", "critical.txt"])
  await git(repositoryPath, ["commit", "-m", "initial"])

  await git(repositoryPath, ["checkout", "-b", "feature/critical"])
  await writeFile(join(repositoryPath, "critical.txt"), featureContent)
  await git(repositoryPath, ["commit", "-am", "feature critical"], commitDates)

  await git(repositoryPath, ["checkout", "main"])
  await git(repositoryPath, ["checkout", "-b", "feature/critical-peer"])
  await writeFile(
    join(repositoryPath, "critical.txt"),
    peerContent
  )
  await git(repositoryPath, ["commit", "-am", "feature critical peer"], commitDates)

  await git(repositoryPath, ["checkout", "main"])
  await git(root, ["init", "--bare", remotePath])
  await git(repositoryPath, ["remote", "add", "origin", remotePath])
  await git(repositoryPath, ["push", "--quiet", "origin", "main", "feature/critical", "feature/critical-peer"])
  await git(repositoryPath, ["fetch", "--quiet", "origin", "+refs/heads/*:refs/remotes/origin/*"])
  await mkdir(debugArtifactDir)

  return {
    repositoryPath,
    debugArtifactDir,
    committerDate,
    async remove(): Promise<void> {
      await rm(root, { recursive: true, force: true })
    }
  }
}

function cleanOverlapResponse(pair: {
  leftBranchName: string
  rightBranchName: string
}) {
  return {
    kind: "clean_overlap",
    pair,
    overlapCause: {
      summary: "같은 변경 범위를 수정함",
      files: ["critical.txt"]
    },
    integrationOrder: {
      strategy: "merge",
      firstBranchName: pair.leftBranchName,
      secondBranchName: pair.rightBranchName,
      reason: "먼저 반영한 변경을 기준으로 확인함",
      steps: ["첫 branch merge", "두 번째 branch 갱신"]
    },
    preventiveActions: [{
      title: "통합 동작 확인",
      description: "두 변경이 함께 동작하는지 확인함",
      files: ["critical.txt"]
    }]
  }
}

function confirmedConflictResponse(pair: {
  leftBranchName: string
  rightBranchName: string
}) {
  return {
    kind: "confirmed_conflict",
    pair,
    conflictCause: {
      summary: "같은 줄을 다르게 수정함",
      files: ["critical.txt"]
    },
    integrationOrder: {
      strategy: "rebase",
      firstBranchName: pair.leftBranchName,
      secondBranchName: pair.rightBranchName,
      reason: "첫 변경을 기준으로 충돌을 해결함",
      steps: ["첫 branch 반영", "두 번째 branch rebase"]
    },
    patches: [{
      filePath: "critical.txt",
      patch: "@@ -1 +1 @@\n-old\n+resolved critical content",
      reason: "두 변경을 하나의 결과로 정리함"
    }]
  }
}

async function readJson<T>(directory: string, file: string): Promise<T> {
  return JSON.parse(await readFile(join(directory, file), "utf8")) as T
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}

async function suppressConsoleWarn<T>(operation: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn

  console.warn = () => {}

  try {
    return await operation()
  } finally {
    console.warn = originalWarn
  }
}

async function git(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    maxBuffer: 10 * 1024 * 1024
  })

  return result.stdout.trim()
}
