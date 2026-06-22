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
