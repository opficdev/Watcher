const DISCORD_CONTENT_LIMIT = 2000
const REPORT_TITLE = "## Merge Risk Report"
const SUMMARY_HEADING = "### Summary"
const SECTION_HEADING_PREFIX = "### "
const PAIR_HEADING_PREFIX = "#### "
const PAIR_SECTION_HEADINGS = new Set([
  "### Confirmed Conflicts",
  "### Potential Risks"
])
const PAIR_UNIT_BOUNDARIES = new Set([
  "- AI Analysis:",
  "- Recommended Resolution:",
  "- Suggested Patch:"
])

// Discord 전송 내용과 branch 조합별 조각 위치
export type DiscordMessage = {
  content: string
  pairLabel?: string
  fragmentNumber: number
}

type DiscordMessageBlock = {
  lines: string[]
  pairLabel?: string
}

// report 구조를 인식하면 section과 branch 조합 단위로, 아니면 길이만으로 분할
export function splitDiscordMessages(markdown: string): DiscordMessage[] {
  const blocks = structuralBlocksFor(markdown)

  if (!blocks) {
    return messagesFor({ lines: [markdown] })
  }

  return numberedPairMessagesFor(blocks.flatMap(messagesFor))
}

// Summary, section, branch 조합 경계를 원래 line 순서대로 block으로 구성
function structuralBlocksFor(markdown: string): DiscordMessageBlock[] | undefined {
  const lines = markdown.split("\n")

  if (lines[0] !== REPORT_TITLE || !lines.includes(SUMMARY_HEADING)) {
    return undefined
  }

  const blocks: DiscordMessageBlock[] = []
  let block: DiscordMessageBlock = { lines: [] }

  for (const line of lines) {
    if (line.startsWith(SECTION_HEADING_PREFIX) && line !== SUMMARY_HEADING) {
      appendBlock(blocks, block)
      block = { lines: [line] }
      continue
    }

    if (line.startsWith(PAIR_HEADING_PREFIX)) {
      const pairLabel = line.slice(PAIR_HEADING_PREFIX.length)

      if (isPairSectionPreamble(block)) {
        block.lines.push(line)
        block.pairLabel = pairLabel
        continue
      }

      appendBlock(blocks, block)
      block = {
        lines: [line],
        pairLabel
      }
      continue
    }

    if (block.pairLabel && PAIR_UNIT_BOUNDARIES.has(line)) {
      appendBlock(blocks, block)
      block = {
        lines: [
          `${PAIR_HEADING_PREFIX}${block.pairLabel}`,
          line
        ],
        pairLabel: block.pairLabel
      }
      continue
    }

    block.lines.push(line)
  }

  appendBlock(blocks, block)
  return blocks
}

// branch 조합 section 제목과 빈 line을 첫 조합 message 앞에 유지
function isPairSectionPreamble(block: DiscordMessageBlock): boolean {
  const [heading, ...lines] = block.lines

  return block.pairLabel === undefined &&
    heading !== undefined &&
    PAIR_SECTION_HEADINGS.has(heading) &&
    lines.every(line => line.length === 0)
}

// 빈 block은 제외하고 원래 line을 가진 block만 결과에 추가
function appendBlock(
  blocks: DiscordMessageBlock[],
  block: DiscordMessageBlock
): void {
  if (block.lines.length) {
    blocks.push(block)
  }
}

// 한 구조 block을 Discord 길이 제한에 맞는 message로 변환
function messagesFor(block: DiscordMessageBlock): DiscordMessage[] {
  const continuationHeading = continuationHeadingFor(block.pairLabel)

  return contentsFor(
    block.lines.join("\n"),
    continuationHeading
  ).map((content, index) => ({
    content,
    pairLabel: block.pairLabel,
    fragmentNumber: index + 1
  }))
}

// 같은 branch 조합의 message에 입력 순서대로 연속된 조각 번호를 부여
function numberedPairMessagesFor(messages: DiscordMessage[]): DiscordMessage[] {
  const fragmentNumbers = new Map<string, number>()

  return messages.map(message => {
    if (!message.pairLabel) {
      return message
    }

    const fragmentNumber = (fragmentNumbers.get(message.pairLabel) ?? 0) + 1
    fragmentNumbers.set(message.pairLabel, fragmentNumber)

    return {
      ...message,
      fragmentNumber
    }
  })
}

// 후속 message에서 반복해도 content 제한을 지킬 수 있는 조합 제목만 반환
function continuationHeadingFor(pairLabel: string | undefined): string | undefined {
  if (!pairLabel) {
    return undefined
  }

  const heading = `${PAIR_HEADING_PREFIX}${pairLabel}`
  return heading.length + 1 < DISCORD_CONTENT_LIMIT ? heading : undefined
}

// Discord content 최대 길이를 넘지 않도록 줄 단위로 최대한 보존하며 분할
function contentsFor(
  markdown: string,
  continuationHeading?: string
): string[] {
  if (markdown.length <= DISCORD_CONTENT_LIMIT) {
    return [markdown]
  }

  const contents: string[] = []
  let current = ""
  let isFirst = true

  for (const line of markdown.split("\n")) {
    const next = current.length === 0
      ? continuedContentFor(line, isFirst, continuationHeading)
      : `${current}\n${line}`

    if (next.length <= DISCORD_CONTENT_LIMIT) {
      current = next
      continue
    }

    if (current.length) {
      contents.push(current)
      isFirst = false
    }

    const continued = continuedContentFor(line, isFirst, continuationHeading)

    if (continued.length <= DISCORD_CONTENT_LIMIT) {
      current = continued
      continue
    }

    for (const chunk of chunksFor(line, isFirst, continuationHeading)) {
      contents.push(chunk)
      isFirst = false
    }

    current = ""
  }

  if (current.length) {
    contents.push(current)
  }

  return contents
}

// 두 번째 조각부터 branch 조합 제목을 앞에 다시 붙여 문맥을 유지
function continuedContentFor(
  value: string,
  isFirst: boolean,
  continuationHeading?: string
): string {
  if (isFirst || !continuationHeading) {
    return value
  }

  return `${continuationHeading}\n${value}`
}

// 한 줄 자체가 제한보다 길면 반복 제목을 포함한 고정 길이 chunk로 분리
function chunksFor(
  value: string,
  isFirst: boolean,
  continuationHeading?: string
): string[] {
  const chunks: string[] = []
  let remaining = value

  while (remaining.length) {
    const headingLength = isFirst || !continuationHeading
      ? 0
      : continuationHeading.length + 1
    const contentLength = DISCORD_CONTENT_LIMIT - headingLength
    const chunk = remaining.slice(0, contentLength)

    chunks.push(continuedContentFor(chunk, isFirst, continuationHeading))
    remaining = remaining.slice(contentLength)
    isFirst = false
  }

  return chunks
}
