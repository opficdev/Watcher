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
    WATCHER_CRITICAL_FILE_PATTERNS: "package-lock.json\n.github/**",
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
    criticalFilePatterns: [
      "package-lock.json",
      ".github/**"
    ],
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
    WATCHER_CRITICAL_FILE_PATTERNS: "\n  \n",
    GITHUB_TOKEN: "   "
  })

  assert.deepEqual(options, {
    repository: "opficdev/Watcher",
    repositoryPath: "/tmp/repository",
    baseBranch: "develop",
    defaultBranch: undefined,
    criticalFilePatterns: [],
    remoteName: "origin",
    githubApiUrl: "https://api.github.com",
    githubToken: undefined
  })
})

// debug directory가 설정되면 workflow 실행 중 consumer artifact용 파일을 생성하는지 확인
test("writes merge risk debug artifacts", async () => {
  const fixture = await createWorkflowGitFixture()
  const originalFetch = globalThis.fetch
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY
  const originalDiscordWebhookUrl = process.env.DISCORD_WEBHOOK_URL
  let openAiRequestCount = 0

  process.env.OPENAI_API_KEY = "openai-secret"
  process.env.DISCORD_WEBHOOK_URL = "https://discord.test/webhook-secret"
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)

    if (request.url === "https://discord.test/webhook-secret") {
      return new Response(null, {
        status: 204
      })
    }

    openAiRequestCount += 1
    assert.equal(request.url, "https://api.openai.com/v1/responses")
    assert.equal(request.headers.get("Authorization"), "Bearer openai-secret")

    return jsonResponse({
      output_text: JSON.stringify({
        predictions: [{
          branchName: "feature/critical",
          baseBranch: "main",
          prediction: "critical file update needs review",
          recommendedActions: []
        }, {
          branchName: "feature/critical-peer",
          baseBranch: "main",
          prediction: "critical file overlap needs review",
          recommendedActions: []
        }]
      })
    })
  }

  try {
    await run({
      repository: "opficdev/Watcher",
      repositoryPath: fixture.repositoryPath,
      baseBranch: "main",
      criticalFilePatterns: ["critical.txt"],
      remoteName: "origin",
      githubApiUrl: "https://api.github.test",
      debugArtifactDir: fixture.debugArtifactDir,
      workflowRef: "opficdev/Watcher/.github/workflows/merge-risk-watch.yml@feat/#35-artifact"
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
      "report.md",
      "run.json"
    ])

    const runArtifact = await readJson<{
      repository?: string
      baseBranch?: string
      workflowRef?: string
    }>(fixture.debugArtifactDir, "run.json")
    const aiResultArtifact = await readJson<{
      predictions?: Array<{
        status?: string
        branchName?: string
      }>
    }>(fixture.debugArtifactDir, "ai-result.json")
    const deterministicArtifact = await readJson<{
      risks?: Array<{
        status?: string
      }>
    }>(fixture.debugArtifactDir, "deterministic-evidence.json")
    const branchSelectionArtifact = await readJson<{
      selectedBranches?: Array<{
        name?: string
        updatedAt?: string
      }>
      excludedBranches?: Array<{
        name?: string
        reason?: string
      }>
    }>(fixture.debugArtifactDir, "branch-selection.json")
    const branchPairsArtifact = await readJson<{
      pairs?: Array<{
        leftBranchName?: string
        rightBranchName?: string
      }>
    }>(fixture.debugArtifactDir, "branch-pairs.json")
    const combinedArtifact = (await Promise.all(files.map(file =>
      readFile(join(fixture.debugArtifactDir, file), "utf8")
    ))).join("\n")

    assert.equal(openAiRequestCount, 1)
    assert.equal(runArtifact.repository, "opficdev/Watcher")
    assert.equal(runArtifact.baseBranch, "main")
    assert.equal(
      runArtifact.workflowRef,
      "opficdev/Watcher/.github/workflows/merge-risk-watch.yml@feat/#35-artifact"
    )
    assert.equal(deterministicArtifact.risks?.[0]?.status, "critical")
    assert.equal(aiResultArtifact.predictions?.[0]?.status, "predicted")
    assert.equal(aiResultArtifact.predictions?.[0]?.branchName, "feature/critical")
    assert.deepEqual(branchSelectionArtifact.selectedBranches?.map(branch => branch.name), [
      "feature/critical",
      "feature/critical-peer"
    ])
    assert.deepEqual(branchSelectionArtifact.selectedBranches?.map(branch => branch.updatedAt), [
      fixture.committerDate,
      fixture.committerDate
    ])
    assert.deepEqual(branchSelectionArtifact.excludedBranches?.map(branch => ({
      name: branch.name,
      reason: branch.reason
    })), [{
      name: "main",
      reason: "base_branch"
    }])
    assert.deepEqual(branchPairsArtifact.pairs, [{
      leftBranchName: "feature/critical",
      rightBranchName: "feature/critical-peer"
    }, {
      leftBranchName: "feature/critical",
      rightBranchName: "main"
    }, {
      leftBranchName: "feature/critical-peer",
      rightBranchName: "main"
    }])
    assert.equal(await git(fixture.repositoryPath, ["status", "--porcelain=v1"]), "")
    assert.equal(
      (await git(fixture.repositoryPath, ["worktree", "list", "--porcelain"]))
        .split("\n")
        .filter(line => line.startsWith("worktree "))
        .length,
      1
    )
    assert.doesNotMatch(combinedArtifact, /openai-secret/)
    assert.doesNotMatch(combinedArtifact, /webhook-secret/)
    assert.doesNotMatch(combinedArtifact, /feature critical content/)
    assert.doesNotMatch(combinedArtifact, /peer critical content/)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey)
    restoreEnv("DISCORD_WEBHOOK_URL", originalDiscordWebhookUrl)
    await fixture.remove()
  }
})

// fetch 실패 시 오래된 remote ref에서 changed file과 hunk를 다시 만들지 않는지 확인
test("keeps deterministic evidence empty after pair fetch failure", async () => {
  const fixture = await createWorkflowGitFixture()
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY
  const originalDiscordWebhookUrl = process.env.DISCORD_WEBHOOK_URL
  const originalFetch = globalThis.fetch

  process.env.OPENAI_API_KEY = "openai-secret"
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
      repository: "opficdev/Watcher",
      repositoryPath: fixture.repositoryPath,
      baseBranch: "main",
      criticalFilePatterns: [],
      remoteName: "origin",
      githubApiUrl: "https://api.github.test",
      debugArtifactDir: fixture.debugArtifactDir
    })

    const artifact = await readJson<{
      inputs?: Array<{
        gitSignal?: {
          status?: string
          mergeBaseSha?: string
          changedFiles?: string[]
        }
        changedHunks?: unknown[]
      }>
    }>(fixture.debugArtifactDir, "deterministic-evidence.json")

    assert.equal(artifact.inputs?.length, 2)
    assert.equal(artifact.inputs?.every(input =>
      input.gitSignal?.status === "merge_check_failed" &&
      input.gitSignal.mergeBaseSha === undefined &&
      input.gitSignal.changedFiles?.length === 0 &&
      input.changedHunks?.length === 0
    ), true)
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
    criticalFilePatterns: [],
    remoteName: "origin",
    githubApiUrl: "https://api.github.test",
    githubToken: "github-token"
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

async function createWorkflowGitFixture(): Promise<{
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

  await git(root, ["init", "--initial-branch=main", repositoryPath])
  await git(repositoryPath, ["config", "user.email", "opfic@example.com"])
  await git(repositoryPath, ["config", "user.name", "opfic"])

  await writeFile(join(repositoryPath, "critical.txt"), "base content\n")
  await git(repositoryPath, ["add", "critical.txt"])
  await git(repositoryPath, ["commit", "-m", "initial"])

  await git(repositoryPath, ["checkout", "-b", "feature/critical"])
  await writeFile(join(repositoryPath, "critical.txt"), "feature critical content\n")
  await git(repositoryPath, ["commit", "-am", "feature critical"], commitDates)

  await git(repositoryPath, ["checkout", "main"])
  await git(repositoryPath, ["checkout", "-b", "feature/critical-peer"])
  await writeFile(join(repositoryPath, "critical.txt"), "peer critical content\n")
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
