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

function errorMessageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function jsonValueFor(_key: string, value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return value
}
