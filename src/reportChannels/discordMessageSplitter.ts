const DISCORD_CONTENT_LIMIT = 2000
const REPORT_TITLE = "## Merge Risk Report"
const SUMMARY_HEADING = "### Summary"
const SECTION_HEADING_PREFIX = "### "
const PAIR_HEADING_PREFIX = "#### "
const PAIR_SECTION_HEADINGS = new Set([
  "### Confirmed Conflicts",
  "### Potential Risks"
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

  return blocks.flatMap(messagesFor)
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
  return contentsFor(block.lines.join("\n")).map((content, index) => ({
    content,
    pairLabel: block.pairLabel,
    fragmentNumber: index + 1
  }))
}

// Discord content 최대 길이를 넘지 않도록 줄 단위로 최대한 보존하며 분할
function contentsFor(markdown: string): string[] {
  if (markdown.length <= DISCORD_CONTENT_LIMIT) {
    return [markdown]
  }

  const contents: string[] = []
  let current = ""

  for (const line of markdown.split("\n")) {
    const next = current.length === 0 ? line : `${current}\n${line}`

    if (next.length <= DISCORD_CONTENT_LIMIT) {
      current = next
      continue
    }

    if (current.length) {
      contents.push(current)
    }

    if (line.length <= DISCORD_CONTENT_LIMIT) {
      current = line
      continue
    }

    contents.push(...chunksFor(line))
    current = ""
  }

  if (current.length) {
    contents.push(current)
  }

  return contents
}

// 한 줄 자체가 Discord 제한보다 길면 고정 길이 chunk로 분리
function chunksFor(value: string): string[] {
  const chunks: string[] = []

  for (let index = 0; index < value.length; index += DISCORD_CONTENT_LIMIT) {
    chunks.push(value.slice(index, index + DISCORD_CONTENT_LIMIT))
  }

  return chunks
}
