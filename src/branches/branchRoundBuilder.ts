import { compareBranchNames } from "./branchPairBuilder.js"
import type {
  BranchComparisonPair,
  BranchComparisonRound
} from "./types.js"

// 중복 없는 branch 비교 조합을 같은 branch가 겹치지 않는 원형 라운드로 구성
export function build(pairs: BranchComparisonPair[]): BranchComparisonRound[] {
  const pairByKey = new Map(pairs.map(pair => {
    const normalized = normalize(pair)

    return [keyFor(normalized), normalized]
  }))
  const branchNames = [...new Set(
    [...pairByKey.values()].flatMap(pair => [
      pair.leftBranchName,
      pair.rightBranchName
    ])
  )].sort(compareBranchNames)

  if (branchNames.length < 2) {
    return []
  }

  const positions: Array<string | undefined> = [...branchNames]

  if (positions.length % 2 === 1) {
    positions.push(undefined)
  }

  const rounds: BranchComparisonRound[] = []

  for (let roundIndex = 0; roundIndex < positions.length - 1; roundIndex += 1) {
    const roundPairs: BranchComparisonPair[] = []

    for (let index = 0; index < positions.length / 2; index += 1) {
      const leftBranchName = positions[index]
      const rightBranchName = positions[positions.length - index - 1]

      if (leftBranchName === undefined || rightBranchName === undefined) {
        continue
      }

      const pair = pairByKey.get(keyFor(normalize({
        leftBranchName,
        rightBranchName
      })))

      if (pair) {
        roundPairs.push(pair)
      }
    }

    if (roundPairs.length) {
      rounds.push({
        roundIndex: rounds.length,
        pairs: roundPairs
      })
    }

    positions.splice(1, 0, positions.pop())
  }

  return rounds
}

// 방향이 다른 같은 조합을 동일한 이름순 조합으로 정규화
function normalize(pair: BranchComparisonPair): BranchComparisonPair {
  if (compareBranchNames(pair.leftBranchName, pair.rightBranchName) <= 0) {
    return pair
  }

  return {
    leftBranchName: pair.rightBranchName,
    rightBranchName: pair.leftBranchName
  }
}

// branch 이름 조합을 충돌 없는 내부 식별자로 변환
function keyFor(pair: BranchComparisonPair): string {
  return `${pair.leftBranchName}\u0000${pair.rightBranchName}`
}
