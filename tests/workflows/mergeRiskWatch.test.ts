import test from "node:test"
import assert from "node:assert/strict"
import {
  githubMetadataClientFor,
  optionsFromEnvironment
} from "../../src/workflows/mergeRiskWatch.js"

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
