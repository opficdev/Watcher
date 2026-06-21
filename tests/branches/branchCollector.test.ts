import test from "node:test"
import assert from "node:assert/strict"
import { collectBranchContexts } from "../../src/branches/branchCollector.js"
import type { BranchSource, RepositoryBranch } from "../../src/index.js"

// source에서 수집한 branch 목록을 Watcher 내부 branch context로 변환하는지 확인
test("collects watched branch contexts from source", async () => {
  const source = new InMemoryBranchSource([
    branch("main"),
    branch("feature/watch"),
    branch("bot/dependency")
  ])

  const contexts = await collectBranchContexts(source, {
    baseBranch: "main",
    excludePatterns: ["bot/*"]
  })

  assert.deepEqual(contexts.map(context => context.name), ["feature/watch"])
  assert.equal(contexts[0]?.baseBranch, "main")
  assert.equal(contexts[0]?.headSha, "feature/watch-sha")
})

class InMemoryBranchSource implements BranchSource {
  constructor(private readonly branches: RepositoryBranch[]) {}

  async listBranches(): Promise<RepositoryBranch[]> {
    return this.branches
  }
}

function branch(name: string): RepositoryBranch {
  return {
    name,
    sha: `${name}-sha`
  }
}
