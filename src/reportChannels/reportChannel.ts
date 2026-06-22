import {
  DISCORD_WEBHOOK_URL_ENV_NAME,
  type ReportChannelInput,
  type ReportChannelOptions,
  type ReportChannelResult
} from "./types.js"

const DISCORD_CONTENT_LIMIT = 2000

// Discord webhook URL이 있으면 Discord channel로 보내고 없으면 stdout으로 fallback
export async function send(
  input: ReportChannelInput,
  options: ReportChannelOptions = {}
): Promise<ReportChannelResult> {
  const webhookUrl = options.discordWebhookUrl ?? process.env[DISCORD_WEBHOOK_URL_ENV_NAME]
  const target = webhookUrl ? "discord" : "stdout"

  if (!input.markdown.trim()) {
    return {
      ok: true,
      target,
      messageCount: 0
    }
  }

  if (webhookUrl) {
    return sendDiscord(input.markdown, webhookUrl, options)
  }

  return sendStdout(input.markdown, options)
}

// local 실행과 CI log에서 확인할 수 있도록 Markdown report를 stdout에 기록
async function sendStdout(
  markdown: string,
  options: ReportChannelOptions
): Promise<ReportChannelResult> {
  try {
    const stdout = options.stdout ?? process.stdout
    stdout.write(`${markdown}\n`)

    return {
      ok: true,
      target: "stdout",
      messageCount: 1
    }
  } catch (error) {
    return {
      ok: false,
      target: "stdout",
      errorMessage: errorMessageFor(error)
    }
  }
}

// Discord content 제한을 넘지 않도록 Markdown report를 여러 메시지로 나눠 전송
async function sendDiscord(
  markdown: string,
  webhookUrl: string,
  options: ReportChannelOptions
): Promise<ReportChannelResult> {
  const fetcher = options.fetch ?? fetch
  const messages = splitDiscordMessages(markdown)

  try {
    for (const message of messages) {
      const response = await fetcher(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: message })
      })

      if (!response.ok) {
        return {
          ok: false,
          target: "discord",
          errorMessage: `Discord webhook request failed with status ${response.status}`
        }
      }
    }

    return {
      ok: true,
      target: "discord",
      messageCount: messages.length
    }
  } catch (error) {
    return {
      ok: false,
      target: "discord",
      errorMessage: redactedErrorMessageFor(error, webhookUrl)
    }
  }
}

// Discord content 최대 길이를 넘는 report를 줄 단위로 최대한 보존하며 분할
function splitDiscordMessages(markdown: string): string[] {
  if (markdown.length <= DISCORD_CONTENT_LIMIT) {
    return [markdown]
  }

  const messages: string[] = []
  let current = ""

  for (const line of markdown.split("\n")) {
    const next = current.length === 0 ? line : `${current}\n${line}`

    if (next.length <= DISCORD_CONTENT_LIMIT) {
      current = next
      continue
    }

    if (current.length) {
      messages.push(current)
    }

    if (line.length <= DISCORD_CONTENT_LIMIT) {
      current = line
      continue
    }

    messages.push(...chunksFor(line))
    current = ""
  }

  if (current.length) {
    messages.push(current)
  }

  return messages
}

// 한 줄 자체가 Discord 제한보다 길면 고정 길이 chunk로 분리
function chunksFor(value: string): string[] {
  const chunks: string[] = []

  for (let index = 0; index < value.length; index += DISCORD_CONTENT_LIMIT) {
    chunks.push(value.slice(index, index + DISCORD_CONTENT_LIMIT))
  }

  return chunks
}

// unknown error를 report 가능한 문자열로 변환
function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// webhook URL이 Error message에 섞여도 secret 값이 노출되지 않도록 제거
function redactedErrorMessageFor(error: unknown, webhookUrl: string): string {
  return errorMessageFor(error).replaceAll(webhookUrl, "[REDACTED_DISCORD_WEBHOOK_URL]")
}
