# Watcher

Watcher는 consumer repository의 active branch를 감시하고 merge conflict 가능성을 report하는 TypeScript/Node 자동화 도구입니다.

consumer repository는 Watcher 코드를 복사하지 않고 workflow 파일 하나만 추가해 reusable workflow를 호출합니다. Watcher repository는 reusable workflow, deterministic possibility 계산, AI prediction, report channel 구현을 소유합니다.

## 설치

consumer repository에 workflow 파일을 추가합니다.

```yml
name: Merge Risk Watch

on:
  pull_request:
    types:
      - opened
      - synchronize
      - reopened
      - ready_for_review
  schedule:
    - cron: "0 0 * * 1-5"
  workflow_dispatch:

permissions:
  contents: read
  actions: read
  checks: read
  pull-requests: read

jobs:
  watch:
    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.fork == false
    uses: opficdev/Watcher/.github/workflows/merge-risk-watch.yml@develop
    with:
      repository: ${{ github.repository }}
      base_branch: develop
      default_branch: main
      critical_file_patterns: |
        package-lock.json
        .github/workflows/**
    secrets:
      watcher_github_token: ${{ secrets.WATCHER_GITHUB_TOKEN }}
      gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
      discord_webhook_url: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

같은 예시는 `docs/examples/consumer-merge-risk-watch.yml`에도 있습니다.

## Secrets

consumer repository에는 다음 secret을 설정합니다.

| secret | 필수 여부 | 용도 |
| --- | --- | --- |
| `WATCHER_GITHUB_TOKEN` | 필수 | watched repository checkout, branch fetch, PR/check metadata 조회 |
| `GEMINI_API_KEY` | 필수 | Gemini prediction 생성 |
| `DISCORD_WEBHOOK_URL` | 선택 | Discord webhook report 전송 |

`WATCHER_GITHUB_TOKEN`은 watched repository를 checkout하고 branch, check, pull request metadata를 읽을 수 있어야 합니다. public repository라도 metadata 조회와 private repository 확장을 고려해 explicit token을 사용합니다.

## Permissions

consumer workflow에는 다음 permission이 필요합니다.

| permission | 용도 |
| --- | --- |
| `contents: read` | repository checkout과 branch fetch |
| `actions: read` | workflow 실행 context 조회 |
| `checks: read` | branch check metadata 조회 |
| `pull-requests: read` | commit에 연결된 PR metadata 조회 |

## Inputs

reusable workflow는 다음 input을 받습니다.

| input | 필수 여부 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `repository` | 필수 | 없음 | 감시할 repository. `owner/repo` 형식 |
| `base_branch` | 필수 | 없음 | merge risk를 비교할 기준 branch |
| `default_branch` | 선택 | 빈 값 | 감시 대상에서 제외할 default branch |
| `critical_file_patterns` | 선택 | 빈 값 | score에 반영할 critical file wildcard pattern 목록. 줄바꿈으로 구분 |

`critical_file_patterns`에서 `*`는 단일 path segment 내부를 매칭하고 `**`는 path separator를 포함해 매칭합니다.

## Branch 운영 기준

Watcher는 `base_branch`와 `default_branch`를 제외한 remote branch를 감시 대상으로 수집합니다. branch 이름에 맞춰야 하는 prefix나 regex는 요구하지 않습니다.

Watcher는 merge된 branch를 직접 삭제하지 않습니다. consumer repository의 `Settings` > `General` > `Pull Requests`에서 `Automatically delete head branches` 옵션을 켜야 합니다. 이 옵션을 켜면 merge된 branch가 자동으로 삭제되어 이미 merge된 branch를 계속 감시하는 상황을 줄일 수 있습니다.

예시 workflow는 `pull_request`, `schedule`, `workflow_dispatch`에서 실행됩니다. 일반 branch push만으로는 실행되지 않으며 PR 업데이트와 scheduled run에서 active branch 상태를 다시 확인합니다.

## 충돌 가능성 판단 방식

Watcher는 merge 가능/불가능을 단정하지 않고 branch별 signal을 점수와 reason으로 변환합니다.

기본 입력은 branch metadata, git merge signal, 변경 파일, 변경 범위입니다. 변경 범위는 같은 파일 안에서 수정된 line range를 뜻하며 여러 branch가 같은 line range를 수정할수록 conflict 가능성을 높게 봅니다.
Git diff에서는 이런 변경 범위를 hunk라고 부르며 Watcher는 같은 파일의 hunk line range가 겹치는지를 비교합니다.

| signal | score | 의미 |
| --- | ---: | --- |
| `confirmed_conflict` | 100 | virtual merge에서 실제 conflict가 확인됨 |
| `merge_check_failed` | 25 | fetch, merge-base, virtual merge 확인 단계가 실패함 |
| `same_hunk_overlap` | 35 | 여러 branch가 같은 파일의 겹치는 변경 범위를 수정함 |
| `same_file_overlap` | 20 | 여러 branch가 같은 파일을 수정함 |
| `failed_check` | 15 | branch metadata에 실패한 check가 존재함 |
| `critical_file_changed` | 15 | 설정한 critical file pattern에 해당하는 파일이 수정됨 |
| `clean_merge` | 0 | virtual merge에서 conflict가 확인되지 않음 |

각 branch의 score는 적용된 signal의 점수를 합산하고 최대 100점으로 제한합니다.

| score | status |
| ---: | --- |
| 0-24 | `low` |
| 25-49 | `medium` |
| 50-79 | `high` |
| 80-100 | `critical` |

`confirmed_conflict`는 최상위 signal입니다. 이 signal이 있으면 다른 reason을 추가로 합산하지 않고 `critical` risk로 처리합니다.

## 검증

```sh
npm ci
npm run build
npm test
```
