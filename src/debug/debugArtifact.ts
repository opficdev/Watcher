import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type DebugArtifactWriter = {
  writeJson(name: string, value: unknown): Promise<void>
  writeText(name: string, value: string): Promise<void>
}

export function writerFor(directory: string | undefined): DebugArtifactWriter | undefined {
  return directory
    ? new FileDebugArtifactWriter(directory)
    : undefined
}

class FileDebugArtifactWriter implements DebugArtifactWriter {
  constructor(private readonly directory: string) {}

  async writeJson(name: string, value: unknown): Promise<void> {
    await this.writeText(name, `${JSON.stringify(value, jsonValueFor, 2)}\n`)
  }

  async writeText(name: string, value: string): Promise<void> {
    await mkdir(this.directory, {
      recursive: true
    })
    await writeFile(join(this.directory, name), value, "utf8")
  }
}

function jsonValueFor(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return value
}
