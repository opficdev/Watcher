import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type DebugArtifactWriter = {
  writeJson(name: string, value: unknown): Promise<void>
  writeText(name: string, value: string): Promise<void>
}

// directory가 설정된 경우에만 파일 기반 debug artifact writer를 생성
export function writerFor(directory: string | undefined): DebugArtifactWriter | undefined {
  return directory
    ? new FileDebugArtifactWriter(directory)
    : undefined
}

class FileDebugArtifactWriter implements DebugArtifactWriter {
  // debug artifact를 저장할 directory를 보관
  constructor(private readonly directory: string) {}

  // 값을 날짜 변환 규칙이 적용된 JSON 문자열로 직렬화해 저장
  async writeJson(name: string, value: unknown): Promise<void> {
    await this.writeText(name, `${JSON.stringify(value, jsonValueFor, 2)}\n`)
  }

  // debug artifact directory를 준비하고 text 파일을 쓰되 실패는 경고로 격리
  async writeText(name: string, value: string): Promise<void> {
    try {
      await mkdir(this.directory, {
        recursive: true
      })
      await writeFile(join(this.directory, name), value, "utf8")
    } catch (error) {
      console.warn(`Failed to write debug artifact ${name}: ${errorMessageFor(error)}`)
    }
  }
}

// unknown error를 경고에 사용할 문자열로 변환
function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// JSON 직렬화 과정에서 Date를 ISO 문자열로 변환
function jsonValueFor(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return value
}
