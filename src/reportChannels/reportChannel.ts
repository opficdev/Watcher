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
const DISCORD_RATE_LIMIT_STATUS = 429
const DISCORD_MAX_RETRY_COUNT = 3
const DISCORD_WAIT_BUDGET_MILLISECONDS = 60_000
const MILLISECONDS_PER_SECOND = 1_000

type AppendFileOperation = (
  path: string,
  content: string,
  encoding: BufferEncoding
) => Promise<void>

type DiscordWaitOperation = (milliseconds: number) => Promise<void>

type DiscordReportDeliveryOptions = ReportChannelOptions & {
  wait?: DiscordWaitOperation
}

type WorkflowReportDeliveryOptions = DiscordReportDeliveryOptions & {
  githubStepSummaryPath?: string
  appendFile?: AppendFileOperation
}

type DiscordWaitBudget = {
  remainingMilliseconds: number
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
  options: DiscordReportDeliveryOptions
): Promise<ReportChannelResult> {
  const fetcher = options.fetch ?? fetch
  const wait = options.wait ?? waitFor
  const messages = splitDiscordMessages(markdown)
  const waitBudget: DiscordWaitBudget = {
    remainingMilliseconds: DISCORD_WAIT_BUDGET_MILLISECONDS
  }

  for (const [index, message] of messages.entries()) {
    let retryCount = 0

    while (true) {
      try {
        const response = await fetcher(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ content: message.content })
        })

        if (response.ok) {
          const nextMessage = messages[index + 1]

          if (nextMessage) {
            const remaining = response.headers.get("X-RateLimit-Remaining")

            if (remaining?.trim() && Number(remaining) === 0) {
              const milliseconds = millisecondsForSeconds(
                response.headers.get("X-RateLimit-Reset-After")
              )

              if (milliseconds === undefined) {
                return discordUnsentFailureFor(
                  nextMessage,
                  "Discord rate limit reset delay unavailable"
                )
              }

              const hasWaitBudget = await consumeDiscordWaitBudget(
                milliseconds,
                waitBudget,
                wait
              )

              if (!hasWaitBudget) {
                return discordUnsentFailureFor(
                  nextMessage,
                  "Discord wait budget of 60 seconds exhausted"
                )
              }
            }
          }

          break
        }

        if (response.status !== DISCORD_RATE_LIMIT_STATUS) {
          return discordStatusFailureFor(message, response.status)
        }

        if (DISCORD_MAX_RETRY_COUNT <= retryCount) {
          return {
            ok: false,
            target: "discord",
            errorMessage: `${failureLocationFor(message)} failed with status ${response.status} after ${DISCORD_MAX_RETRY_COUNT} retries`
          }
        }

        const retryAfterMilliseconds = await retryAfterMillisecondsFor(response)

        if (retryAfterMilliseconds === undefined) {
          return {
            ok: false,
            target: "discord",
            errorMessage: `${failureLocationFor(message)} failed with status ${response.status}: retry delay unavailable`
          }
        }

        const hasWaitBudget = await consumeDiscordWaitBudget(
          retryAfterMilliseconds,
          waitBudget,
          wait
        )

        if (!hasWaitBudget) {
          return {
            ok: false,
            target: "discord",
            errorMessage: `${failureLocationFor(message)} failed with status ${response.status}: Discord wait budget of 60 seconds exhausted`
          }
        }

        retryCount += 1
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
  }

  return {
    ok: true,
    target: "discord",
    messageCount: messages.length
  }
}

// Discord 429 response에서 numeric seconds retry delay를 millisecond로 변환
async function retryAfterMillisecondsFor(
  response: Response
): Promise<number | undefined> {
  const headerMilliseconds = millisecondsForSeconds(
    response.headers.get("Retry-After")
  )

  if (headerMilliseconds !== undefined) {
    return headerMilliseconds
  }

  try {
    const body = await response.json() as unknown

    if (!body || typeof body !== "object") {
      return undefined
    }

    const retryAfter = (body as Record<string, unknown>).retry_after

    if (typeof retryAfter !== "number") {
      return undefined
    }

    return millisecondsForSeconds(retryAfter)
  } catch {
    return undefined
  }
}

// seconds 값을 일찍 재시도하지 않도록 올림한 millisecond로 변환
function millisecondsForSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") {
    return undefined
  }

  if (typeof value === "string" && !value.trim()) {
    return undefined
  }

  const seconds = Number(value)

  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined
  }

  return Math.ceil(seconds * MILLISECONDS_PER_SECOND)
}

// 전체 Discord delivery 대기 예산 안에서만 다음 delay를 소비
async function consumeDiscordWaitBudget(
  milliseconds: number,
  budget: DiscordWaitBudget,
  wait: DiscordWaitOperation
): Promise<boolean> {
  if (budget.remainingMilliseconds < milliseconds) {
    return false
  }

  await wait(milliseconds)
  budget.remainingMilliseconds -= milliseconds
  return true
}

// 실제 timer 대기 구현
async function waitFor(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

// Discord non-429 status 실패 형식을 기존과 동일하게 유지
function discordStatusFailureFor(
  message: DiscordMessage,
  status: number
): ReportChannelResult {
  return {
    ok: false,
    target: "discord",
    errorMessage: `${failureLocationFor(message)} failed with status ${status}`
  }
}

// 아직 요청하지 않은 다음 Discord fragment의 전송 중단 사유를 반환
function discordUnsentFailureFor(
  message: DiscordMessage,
  reason: string
): ReportChannelResult {
  return {
    ok: false,
    target: "discord",
    errorMessage: `${failureLocationFor(message)} was not sent: ${reason}`
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
