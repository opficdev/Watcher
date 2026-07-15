import type {
  BranchComparisonPair,
  BranchContext
} from "./types.js"

// base branch와 활성 branch에서 중복 없는 비교 조합을 이름순으로 구성
export function build(
  baseBranch: string,
  branches: BranchContext[]
): BranchComparisonPair[] {
  const branchNames = [...new Set([
    baseBranch,
    ...branches.map(branch => branch.name)
  ])].sort(compareBranchNames)
  const pairs: BranchComparisonPair[] = []

  for (let leftIndex = 0; leftIndex < branchNames.length; leftIndex += 1) {
    const leftBranchName = branchNames[leftIndex]!

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < branchNames.length;
      rightIndex += 1
    ) {
      pairs.push({
        leftBranchName,
        rightBranchName: branchNames[rightIndex]!
      })
    }
  }

  return pairs
}

// 실행 환경에 무관한 문자열 비교로 branch 이름 순서를 결정
function compareBranchNames(branchName: string, otherBranchName: string): number {
  if (branchName < otherBranchName) {
    return -1
  }

  if (otherBranchName < branchName) {
    return 1
  }

  return 0
}
