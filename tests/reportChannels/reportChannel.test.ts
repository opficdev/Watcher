import test from "node:test"
import assert from "node:assert/strict"
import {
  sendMergeRiskReport
} from "../../src/index.js"

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
    errorMessage: "Discord webhook request failed with status 500"
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
    /\[REDACTED_DISCORD_WEBHOOK_URL\]/
  )
  assert.doesNotMatch(
    result.ok ? "" : result.errorMessage,
    /secret-token/
  )
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

    return {
      ok: options.ok ?? true,
      status: options.status ?? 204,
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
