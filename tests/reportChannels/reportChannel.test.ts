import test from "node:test"
import assert from "node:assert/strict"
import {
  sendMergeRiskReport
} from "../../src/index.js"
import {
  deliver as deliverMergeRiskReport
} from "../../src/reportChannels/reportChannel.js"

// GitHub Actions에서는 전체 Markdown report를 step summary에 기록하는지 확인
test("writes full report to GitHub Actions summary", async () => {
  const appendFile = new AppendFileSpy()
  const stdout = new StdoutSpy()
  const markdown = reportWithTwoPairFragments()
  const result = await deliverMergeRiskReport({
    markdown
  }, {
    discordWebhookUrl: "",
    githubStepSummaryPath: "/tmp/github-step-summary",
    appendFile: appendFile.write,
    stdout
  })

  assert.deepEqual(result, {
    ok: true
  })
  assert.deepEqual(appendFile.writes, [{
    path: "/tmp/github-step-summary",
    content: `${markdown}\n`
  }])
  assert.equal(stdout.output, "")
})

// Discord 설정이 있어도 Actions summary와 Discord에 report를 모두 전달하는지 확인
test("writes Actions summary and sends Discord report", async () => {
  const appendFile = new AppendFileSpy()
  const fetcher = fetchSpy({})
  const result = await deliverMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    githubStepSummaryPath: "/tmp/github-step-summary",
    appendFile: appendFile.write,
    fetch: fetcher
  })

  assert.deepEqual(result, {
    ok: true
  })
  assert.deepEqual(appendFile.writes, [{
    path: "/tmp/github-step-summary",
    content: "## Merge Risk Report\n"
  }])
  assert.equal(fetcher.requests.length, 1)
})

// Actions summary 경로가 없으면 stdout과 설정된 Discord에 모두 전달하는지 확인
test("falls back to stdout and sends Discord report outside Actions", async () => {
  const fetcher = fetchSpy({})
  const stdout = new StdoutSpy()
  const result = await deliverMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    githubStepSummaryPath: "",
    fetch: fetcher,
    stdout
  })

  assert.deepEqual(result, {
    ok: true
  })
  assert.equal(stdout.output, "## Merge Risk Report\n")
  assert.equal(fetcher.requests.length, 1)
})

// 빈 Markdown report는 Actions summary, stdout, Discord 어디에도 쓰지 않는지 확인
test("skips every workflow report delivery for empty report", async () => {
  const appendFile = new AppendFileSpy()
  const fetcher = fetchSpy({})
  const stdout = new StdoutSpy()
  const result = await deliverMergeRiskReport({
    markdown: " \n\t"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    githubStepSummaryPath: "/tmp/github-step-summary",
    appendFile: appendFile.write,
    fetch: fetcher,
    stdout
  })

  assert.deepEqual(result, {
    ok: true
  })
  assert.deepEqual(appendFile.writes, [])
  assert.equal(fetcher.requests.length, 0)
  assert.equal(stdout.output, "")
})

// Actions summary 기록이 실패해도 stdout fallback과 Discord 전송을 계속하는지 확인
test("continues stdout and Discord delivery after summary failure", async () => {
  const fetcher = fetchSpy({})
  const stdout = new StdoutSpy()
  const result = await deliverMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    githubStepSummaryPath: "/tmp/github-step-summary",
    appendFile: async () => {
      throw new Error("summary unavailable")
    },
    fetch: fetcher,
    stdout
  })

  assert.deepEqual(result, {
    ok: false,
    errorMessage: "GitHub Actions summary write failed: summary unavailable"
  })
  assert.equal(stdout.output, "## Merge Risk Report\n")
  assert.equal(fetcher.requests.length, 1)
})

// Discord 전송이 실패해도 Actions summary에 전체 report가 남는지 확인
test("keeps Actions summary when Discord delivery fails", async () => {
  const appendFile = new AppendFileSpy()
  const result = await deliverMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    githubStepSummaryPath: "/tmp/github-step-summary",
    appendFile: appendFile.write,
    fetch: fetchSpy({}, {
      ok: false,
      status: 500
    })
  })

  assert.deepEqual(result, {
    ok: false,
    errorMessage: "Discord webhook request for report fragment 1 failed with status 500"
  })
  assert.deepEqual(appendFile.writes, [{
    path: "/tmp/github-step-summary",
    content: "## Merge Risk Report\n"
  }])
})

// Actions summary와 Discord가 모두 실패하면 두 channel 오류를 순서대로 반환하는지 확인
test("reports summary and Discord delivery failures together", async () => {
  const fetcher = fetchSpy({}, {
    ok: false,
    status: 500
  })
  const stdout = new StdoutSpy()
  const result = await deliverMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    githubStepSummaryPath: "/tmp/github-step-summary",
    appendFile: async () => {
      throw new Error("summary unavailable")
    },
    fetch: fetcher,
    stdout
  })

  assert.deepEqual(result, {
    ok: false,
    errorMessage: [
      "GitHub Actions summary write failed: summary unavailable",
      "Discord webhook request for report fragment 1 failed with status 500"
    ].join("\n")
  })
  assert.equal(stdout.output, "## Merge Risk Report\n")
  assert.equal(fetcher.requests.length, 1)
})

// local stdout 실패가 설정된 Discord 전송을 막지 않는지 확인
test("continues Discord delivery after stdout failure", async () => {
  const fetcher = fetchSpy({})
  const result = await deliverMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    githubStepSummaryPath: "",
    fetch: fetcher,
    stdout: {
      write: () => {
        throw new Error("stdout unavailable")
      }
    }
  })

  assert.deepEqual(result, {
    ok: false,
    errorMessage: "stdout report write failed: stdout unavailable"
  })
  assert.equal(fetcher.requests.length, 1)
})

// Discord webhook URL이 없으면 Markdown report를 stdout으로 출력하는지 확인
test("sends report to stdout when discord webhook is missing", async () => {
  const stdout = new StdoutSpy()
  const result = await sendMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    stdout
  })

  assert.deepEqual(result, {
    ok: true,
    target: "stdout",
    messageCount: 1
  })
  assert.equal(stdout.output, "## Merge Risk Report\n")
})

// Discord webhook URL이 있으면 stdout 대신 Discord webhook으로 출력하는지 확인
test("sends report to discord webhook", async () => {
  const fetcher = fetchSpy({})
  const stdout = new StdoutSpy()
  const result = await sendMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    fetch: fetcher,
    stdout
  })

  assert.deepEqual(result, {
    ok: true,
    target: "discord",
    messageCount: 1
  })
  assert.equal(stdout.output, "")
  assert.equal(fetcher.requests.length, 1)
  assert.equal(fetcher.requests[0]?.url, "https://discord.test/webhook")
  assert.deepEqual(fetcher.requests[0]?.body, {
    content: "## Merge Risk Report"
  })
})

// 빈 Markdown report는 stdout write 없이 성공으로 처리되는지 확인
test("skips stdout write for empty report", async () => {
  const stdout = new StdoutSpy()
  const result = await sendMergeRiskReport({
    markdown: "   "
  }, {
    stdout
  })

  assert.deepEqual(result, {
    ok: true,
    target: "stdout",
    messageCount: 0
  })
  assert.equal(stdout.output, "")
})

// 빈 Markdown report는 Discord request 없이 성공으로 처리되는지 확인
test("skips discord request for empty report", async () => {
  const fetcher = fetchSpy({})
  const result = await sendMergeRiskReport({
    markdown: "\n\t"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    fetch: fetcher
  })

  assert.deepEqual(result, {
    ok: true,
    target: "discord",
    messageCount: 0
  })
  assert.equal(fetcher.requests.length, 0)
})

// Discord HTTP 실패를 진단 가능한 channel failure로 반환하는지 확인
test("returns failure when discord webhook responds with error", async () => {
  const result = await sendMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    fetch: fetchSpy({}, {
      ok: false,
      status: 500
    })
  })

  assert.deepEqual(result, {
    ok: false,
    target: "discord",
    errorMessage: "Discord webhook request for report fragment 1 failed with status 500"
  })
})

// fetch 예외 message에 webhook URL이 섞여도 secret 값이 노출되지 않는지 확인
test("redacts discord webhook url from thrown errors", async () => {
  const result = await sendMergeRiskReport({
    markdown: "## Merge Risk Report"
  }, {
    discordWebhookUrl: "https://discord.test/secret-token",
    fetch: failingFetch("request failed for https://discord.test/secret-token")
  })

  assert.equal(result.ok, false)
  assert.equal(result.target, "discord")
  assert.match(
    result.ok ? "" : result.errorMessage,
    /^Discord webhook request for report fragment 1 failed:/
  )
  assert.match(
    result.ok ? "" : result.errorMessage,
    /\[REDACTED_DISCORD_WEBHOOK_URL\]/
  )
  assert.doesNotMatch(
    result.ok ? "" : result.errorMessage,
    /secret-token/
  )
})

// 중간 request 실패에 branch 조합과 연속된 조각 번호를 포함하는지 확인
test("reports the branch pair and fragment number for a middle webhook failure", async () => {
  const fetcher = fetchSpy({}, {
    outcomes: [
      { ok: true, status: 204 },
      { ok: true, status: 204 },
      { ok: false, status: 500 },
      { ok: true, status: 204 }
    ]
  })
  const result = await sendMergeRiskReport({
    markdown: reportWithTwoPairFragments()
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    fetch: fetcher
  })

  assert.deepEqual(result, {
    ok: false,
    target: "discord",
    errorMessage: "Discord webhook request for pair `feature/a` ↔ `main` fragment 2 failed with status 500"
  })
  assert.equal(fetcher.requests.length, 3)
})

// fetch 예외에도 실패 조각 문맥을 유지하면서 webhook URL을 제거하는지 확인
test("reports the pair fragment and redacts webhook url from a fetch error", async () => {
  const webhookUrl = "https://discord.test/secret-token"
  const fetcher = fetchSpy({}, {
    outcomes: [
      { ok: true, status: 204 },
      { ok: true, status: 204 },
      new Error(`request failed for ${webhookUrl}`),
      { ok: true, status: 204 }
    ]
  })
  const result = await sendMergeRiskReport({
    markdown: reportWithTwoPairFragments()
  }, {
    discordWebhookUrl: webhookUrl,
    fetch: fetcher
  })

  assert.equal(result.ok, false)
  assert.equal(result.target, "discord")
  assert.match(
    result.ok ? "" : result.errorMessage,
    /^Discord webhook request for pair `feature\/a` ↔ `main` fragment 2 failed:/
  )
  assert.match(
    result.ok ? "" : result.errorMessage,
    /\[REDACTED_DISCORD_WEBHOOK_URL\]/
  )
  assert.doesNotMatch(
    result.ok ? "" : result.errorMessage,
    /secret-token/
  )
  assert.equal(fetcher.requests.length, 3)
})

// Discord message length 제한을 넘는 report를 여러 메시지로 나눠 보내는지 확인
test("splits long discord report into multiple messages", async () => {
  const fetcher = fetchSpy({})
  const result = await sendMergeRiskReport({
    markdown: "a".repeat(2001)
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    fetch: fetcher
  })

  assert.deepEqual(result, {
    ok: true,
    target: "discord",
    messageCount: 2
  })
  assert.equal(fetcher.requests[0]?.body.content.length, 2000)
  assert.equal(fetcher.requests[1]?.body.content.length, 1)
})

// 긴 Suggested Patch request마다 길이 제한과 닫힌 code fence를 유지하는지 확인
test("sends long suggested patch in bounded closed-fence requests", async () => {
  const fetcher = fetchSpy({})
  const patchLines = Array.from({ length: 300 }, (_, index) =>
    `    +const value${index.toString()} = "${"x".repeat(24)}"`
  )
  const result = await sendMergeRiskReport({
    markdown: [
      "## Merge Risk Report",
      "",
      "### Summary",
      "- watched branches: 1",
      "",
      "### Confirmed Conflicts",
      "",
      "#### `feature/a` ↔ `main`",
      "- Suggested Patch:",
      "  - `src/a.ts`: resolve conflict",
      "    ```diff",
      ...patchLines,
      "    ```"
    ].join("\n")
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    fetch: fetcher
  })
  const patchRequests = fetcher.requests.filter(request =>
    request.body.content.includes("Suggested Patch (")
  )

  assert.equal(result.ok, true)
  assert.equal(1 < patchRequests.length, true)
  assert.equal(
    fetcher.requests.every(request => request.body.content.length <= 2000),
    true
  )
  assert.equal(
    patchRequests.every(request => {
      const lines = request.body.content.split("\n")
      return lines.includes("    ```diff") && lines.at(-1) === "    ```"
    }),
    true
  )
})

// report section과 branch 조합을 원래 순서대로 모두 Discord에 전송하는지 확인
test("sends report sections and branch pairs in source order", async () => {
  const fetcher = fetchSpy({})
  const result = await sendMergeRiskReport({
    markdown: [
      "## Merge Risk Report",
      "",
      "### Summary",
      "- watched branches: 2",
      "",
      "### Confirmed Conflicts",
      "",
      "#### `feature/a` ↔ `main`",
      "- status: `confirmed_conflict`",
      "",
      "#### `feature/b` ↔ `main`",
      "- status: `confirmed_conflict`",
      "",
      "### Branch Impact",
      "",
      "- `feature/a`",
      "",
      "### Excluded Branches",
      "",
      "- `feature/old`: `stale_branch`",
      "",
      "### Merge Errors",
      "",
      "없음"
    ].join("\n")
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    fetch: fetcher
  })

  assert.deepEqual(result, {
    ok: true,
    target: "discord",
    messageCount: 6
  })
  assert.match(fetcher.requests[0]?.body.content ?? "", /### Summary/)
  assert.match(fetcher.requests[1]?.body.content ?? "", /`feature\/a` ↔ `main`/)
  assert.match(fetcher.requests[2]?.body.content ?? "", /`feature\/b` ↔ `main`/)
  assert.match(fetcher.requests[3]?.body.content ?? "", /### Branch Impact/)
  assert.match(fetcher.requests[4]?.body.content ?? "", /### Excluded Branches/)
  assert.match(fetcher.requests[5]?.body.content ?? "", /### Merge Errors/)
})

// 이전 Discord request가 끝난 뒤에만 다음 message 전송을 시작하는지 확인
test("waits for each discord request before sending the next message", async () => {
  const fetcher = new DeferredFetchSpy()
  const result = sendMergeRiskReport({
    markdown: [
      "## Merge Risk Report",
      "",
      "### Summary",
      "- watched branches: 2",
      "",
      "### Confirmed Conflicts",
      "",
      "#### `feature/a` ↔ `main`",
      "- status: `confirmed_conflict`",
      "",
      "#### `feature/b` ↔ `main`",
      "- status: `confirmed_conflict`"
    ].join("\n")
  }, {
    discordWebhookUrl: "https://discord.test/webhook",
    fetch: fetcher.fetch
  })

  assert.equal(fetcher.requests.length, 1)

  fetcher.resolveNext()
  await nextEventLoopTurn()
  assert.equal(fetcher.requests.length, 2)

  fetcher.resolveNext()
  await nextEventLoopTurn()
  assert.equal(fetcher.requests.length, 3)

  fetcher.resolveNext()
  assert.deepEqual(await result, {
    ok: true,
    target: "discord",
    messageCount: 3
  })
})

class StdoutSpy {
  output = ""

  write(value: string | Uint8Array): boolean {
    this.output += String(value)
    return true
  }
}

class AppendFileSpy {
  readonly writes: Array<{
    path: string
    content: string
  }> = []

  readonly write = async (path: string, content: string): Promise<void> => {
    this.writes.push({
      path,
      content
    })
  }
}

type FetchSpy = typeof fetch & {
  requests: Array<{
    url: string
    body: {
      content: string
    }
  }>
}

function fetchSpy(
  body: unknown,
  options: {
    ok?: boolean
    status?: number
    outcomes?: Array<{
      ok: boolean
      status: number
    } | Error>
  } = {}
): FetchSpy {
  const requests: FetchSpy["requests"] = []
  const spy = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as { content: string }
    })
    const outcome = options.outcomes?.[requests.length - 1]

    if (options.outcomes && !outcome) {
      throw new Error("Unexpected fetch request")
    }

    if (outcome instanceof Error) {
      throw outcome
    }

    return {
      ok: outcome?.ok ?? options.ok ?? true,
      status: outcome?.status ?? options.status ?? 204,
      json: async () => body
    } as Response
  }) as FetchSpy

  spy.requests = requests
  return spy
}

function failingFetch(message: string): typeof fetch {
  return (async (): Promise<Response> => {
    throw new Error(message)
  }) as typeof fetch
}

class DeferredFetchSpy {
  readonly requests: Request[] = []
  private readonly resolvers: Array<(response: Response) => void> = []

  readonly fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    this.requests.push(new Request(input, init))

    return new Promise(resolve => {
      this.resolvers.push(resolve)
    })
  }) as typeof fetch

  resolveNext(): void {
    this.resolvers.shift()?.({
      ok: true,
      status: 204
    } as Response)
  }
}

function nextEventLoopTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function reportWithTwoPairFragments(): string {
  return [
    "## Merge Risk Report",
    "",
    "### Summary",
    "- watched branches: 1",
    "",
    "### Confirmed Conflicts",
    "",
    "#### `feature/a` ↔ `main`",
    "- status: `confirmed_conflict`",
    "- AI Analysis:",
    "  - status: `predicted`"
  ].join("\n")
}
