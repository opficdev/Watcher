export const DISCORD_WEBHOOK_URL_ENV_NAME = "DISCORD_WEBHOOK_URL"

export type ReportChannelTarget =
  | "stdout"
  | "discord"

export type ReportChannelResult =
  | ReportChannelSuccess
  | ReportChannelFailure

export type ReportChannelSuccess = {
  ok: true
  target: ReportChannelTarget
  messageCount: number
}

export type ReportChannelFailure = {
  ok: false
  target: ReportChannelTarget
  errorMessage: string
}

// report channel 전송에 필요한 sink와 외부 I/O를 테스트에서 교체하기 위한 설정
export type ReportChannelOptions = {
  discordWebhookUrl?: string
  fetch?: typeof fetch
  stdout?: Pick<NodeJS.WriteStream, "write">
}

// channel로 보낼 Markdown report 문자열
export type ReportChannelInput = {
  markdown: string
}
