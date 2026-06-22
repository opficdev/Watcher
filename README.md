# Watcher

Watcher는 branch 단위로 merge conflict 가능성 분석에 필요한 정보를 수집하는 TypeScript/Node 자동화 도구입니다.

## 사용법

Watcher는 기준이 되는 `baseBranch`와 `defaultBranch`를 제외한 모든 branch를 감시 대상으로 수집합니다.

GitHub repository의 `Settings` > `General` > `Pull Requests`에서 `Automatically delete head branches` 옵션을 반드시 켜야 합니다. 이 옵션을 켜면 merge된 branch가 자동으로 삭제되어 Watcher가 이미 merge된 branch까지 계속 감시하는 상황을 줄일 수 있습니다.

AI prediction은 기본 provider로 Gemini API를 사용합니다. consumer repository에는 `GEMINI_API_KEY` secret을 설정해야 하며 Watcher는 deterministic evidence를 Gemini에 전달해 prediction과 recommended actions를 생성합니다.

Merge risk report는 report channel을 통해 출력됩니다. consumer repository에 `DISCORD_WEBHOOK_URL` secret이 있으면 Discord webhook으로 report를 전송합니다. `DISCORD_WEBHOOK_URL`이 없으면 같은 Markdown report를 stdout으로 출력하므로 local 실행이나 CI log에서 결과를 확인할 수 있습니다.

Discord webhook으로 전송할 때는 Discord message length 제한에 맞춰 긴 report를 여러 메시지로 나눕니다. 전송 실패가 발생해도 webhook URL secret이 error message에 그대로 노출되지 않도록 처리합니다.

## Reusable Workflow

consumer repository는 workflow 파일 하나만 추가해 Watcher를 호출할 수 있습니다.

예시는 `docs/examples/consumer-merge-risk-watch.yml`에 있습니다. 이 예시는 `pull_request`, `schedule`, `workflow_dispatch`에서 reusable workflow를 호출하며 일반 branch push만으로는 실행되지 않습니다.

consumer repository에는 다음 secret을 설정해야 합니다.

| secret | 필수 여부 | 용도 |
| --- | --- | --- |
| `WATCHER_GITHUB_TOKEN` | 필수 | watched repository checkout, branch fetch, PR/check metadata 조회 |
| `GEMINI_API_KEY` | 필수 | Gemini prediction 생성 |
| `DISCORD_WEBHOOK_URL` | 선택 | Discord webhook report 전송 |

consumer workflow에는 다음 permission이 필요합니다.

| permission | 용도 |
| --- | --- |
| `contents: read` | repository checkout과 branch fetch |
| `actions: read` | workflow 실행 context 조회 |
| `checks: read` | branch check metadata 조회 |
| `pull-requests: read` | commit에 연결된 PR metadata 조회 |

Watcher는 merge된 branch를 직접 삭제하지 않습니다. 감시 대상 branch 정리는 GitHub의 `Automatically delete head branches` 설정에 위임합니다.

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
