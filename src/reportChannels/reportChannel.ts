import {
  DISCORD_WEBHOOK_URL_ENV_NAME,
  type ReportChannelInput,
  type ReportChannelOptions,
  type ReportChannelResult
} from "./types.js"
import { splitDiscordMessages } from "./discordMessageSplitter.js"

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
        body: JSON.stringify({ content: message.content })
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

// unknown error를 report 가능한 문자열로 변환
function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// webhook URL이 Error message에 섞여도 secret 값이 노출되지 않도록 제거
function redactedErrorMessageFor(error: unknown, webhookUrl: string): string {
  return errorMessageFor(error).replaceAll(webhookUrl, "[REDACTED_DISCORD_WEBHOOK_URL]")
}
