# Watcher

Watcher는 branch 단위로 merge conflict 가능성 분석에 필요한 정보를 수집하는 TypeScript/Node 자동화 도구입니다.

## 사용법

Watcher는 기준이 되는 `baseBranch`와 `defaultBranch`를 제외한 모든 branch를 감시 대상으로 수집합니다.

GitHub repository의 `Settings` > `General` > `Pull Requests`에서 `Automatically delete head branches` 옵션을 반드시 켜야 합니다. 이 옵션을 켜면 merge된 branch가 자동으로 삭제되어, Watcher가 이미 merge된 branch까지 계속 감시하는 상황을 줄일 수 있습니다.

## 검증

```sh
npm ci
npm run build
npm test
```
