import { appendFile } from "node:fs/promises"
import {
  DISCORD_WEBHOOK_URL_ENV_NAME,
  type ReportChannelInput,
  type ReportChannelOptions,
  type ReportChannelResult
} from "./types.js"
import {
  splitDiscordMessages,
  type DiscordMessage
} from "./discordMessageSplitter.js"

const GITHUB_STEP_SUMMARY_ENV_NAME = "GITHUB_STEP_SUMMARY"

type AppendFileOperation = (
  path: string,
  content: string,
  encoding: BufferEncoding
) => Promise<void>

type WorkflowReportDeliveryOptions = ReportChannelOptions & {
  githubStepSummaryPath?: string
  appendFile?: AppendFileOperation
}

type WorkflowReportDeliveryResult =
  | { ok: true }
  | {
      ok: false
      errorMessage: string
    }

// workflow에서는 Actions summary 또는 stdout을 기본으로 기록하고 Discord를 추가 전송
export async function deliver(
  input: ReportChannelInput,
  options: WorkflowReportDeliveryOptions = {}
): Promise<WorkflowReportDeliveryResult> {
  if (!input.markdown.trim()) {
    return {
      ok: true
    }
  }

  const errorMessages: string[] = []
  const summaryPath = options.githubStepSummaryPath ??
    process.env[GITHUB_STEP_SUMMARY_ENV_NAME]

  if (summaryPath?.trim()) {
    const summaryResult = await sendGitHubActionsSummary(
      input.markdown,
      summaryPath,
      options
    )

    if (!summaryResult.ok) {
      errorMessages.push(summaryResult.errorMessage)

      const stdoutResult = await sendStdout(input.markdown, options)

      if (!stdoutResult.ok) {
        errorMessages.push(
          `stdout report write failed: ${stdoutResult.errorMessage}`
        )
      }
    }
  } else {
    const stdoutResult = await sendStdout(input.markdown, options)

    if (!stdoutResult.ok) {
      errorMessages.push(
        `stdout report write failed: ${stdoutResult.errorMessage}`
      )
    }
  }

  const webhookUrl = options.discordWebhookUrl ?? process.env[DISCORD_WEBHOOK_URL_ENV_NAME]

  if (webhookUrl) {
    const discordResult = await sendDiscord(input.markdown, webhookUrl, options)

    if (!discordResult.ok) {
      errorMessages.push(discordResult.errorMessage)
    }
  }

  if (0 < errorMessages.length) {
    return {
      ok: false,
      errorMessage: errorMessages.join("\n")
    }
  }

  return {
    ok: true
  }
}

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

// GitHub Actions가 제공한 step summary 파일에 전체 Markdown report를 추가 기록
async function sendGitHubActionsSummary(
  markdown: string,
  path: string,
  options: WorkflowReportDeliveryOptions
): Promise<WorkflowReportDeliveryResult> {
  try {
    const write = options.appendFile ?? appendFile
    await write(path, `${markdown}\n`, "utf8")

    return {
      ok: true
    }
  } catch (error) {
    return {
      ok: false,
      errorMessage: `GitHub Actions summary write failed: ${errorMessageFor(error)}`
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

  for (const message of messages) {
    try {
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
          errorMessage: `${failureLocationFor(message)} failed with status ${response.status}`
        }
      }
    } catch (error) {
      return {
        ok: false,
        target: "discord",
        errorMessage: `${failureLocationFor(message)} failed: ${
          redactedErrorMessageFor(error, webhookUrl)
        }`
      }
    }
  }

  return {
    ok: true,
    target: "discord",
    messageCount: messages.length
  }
}

// 실패한 Discord request를 branch 조합 또는 report 조각 위치로 표시
function failureLocationFor(message: DiscordMessage): string {
  if (message.pairLabel) {
    return `Discord webhook request for pair ${message.pairLabel} fragment ${message.fragmentNumber}`
  }

  return `Discord webhook request for report fragment ${message.fragmentNumber}`
}

// unknown error를 report 가능한 문자열로 변환
function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// webhook URL이 Error message에 섞여도 secret 값이 노출되지 않도록 제거
function redactedErrorMessageFor(error: unknown, webhookUrl: string): string {
  return errorMessageFor(error).replaceAll(webhookUrl, "[REDACTED_DISCORD_WEBHOOK_URL]")
}
