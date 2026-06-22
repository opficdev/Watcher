# Watcher

Watcher는 consumer repository의 active branch를 감시하고 merge conflict 가능성을 report하는 TypeScript/Node 자동화 도구입니다.

consumer repository는 Watcher 코드를 복사하지 않고 workflow 파일 하나만 추가해 reusable workflow를 호출합니다. Watcher repository는 reusable workflow, deterministic possibility 계산, AI prediction, report channel 구현을 소유합니다.

## 설치

consumer repository에 workflow 파일 하나를 추가합니다. 전체 예시는 `docs/examples/consumer-merge-risk-watch.yml`에 있습니다.

예시에서 consumer repository에 맞게 `base_branch`, `default_branch`, `critical_file_patterns`, secret 이름을 조정합니다.

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

## 충돌 가능성 점수화

Watcher는 merge 가능/불가능을 단정하지 않고 branch별 signal을 충돌 가능성 score와 reason으로 변환합니다. 이 값은 같은 입력에 대해 항상 같은 결과가 나와야 하는 기본 판단층입니다.

기본 입력은 branch metadata, git merge signal, 변경 파일, 변경 범위입니다. 변경 범위는 같은 파일 안에서 수정된 line range를 뜻하며 여러 branch가 같은 line range를 수정할수록 conflict 가능성을 높게 봅니다. Git diff에서는 이런 변경 범위를 hunk라고 부르며 Watcher는 같은 파일의 hunk line range가 겹치는지를 비교합니다.

| signal | score | 의미 |
| --- | ---: | --- |
| `confirmed_conflict` | 100 | virtual merge에서 실제 conflict가 확인됨 |
| `same_hunk_overlap` | 35 | 여러 branch가 같은 파일의 겹치는 변경 범위를 수정함 |
| `merge_check_failed` | 25 | fetch, merge-base, virtual merge 확인 단계가 실패함 |
| `same_file_overlap` | 20 | 여러 branch가 같은 파일을 수정함 |
| `failed_check` | 15 | branch metadata에 실패한 check가 존재함 |
| `critical_file_changed` | 15 | 설정한 critical file pattern에 해당하는 파일이 수정됨 |
| `clean_merge` | 0 | virtual merge에서 conflict가 확인되지 않음 |

각 branch의 score는 적용된 signal의 점수를 합산하고 최대 100점으로 제한합니다.

| score | status |
| ---: | --- |
| 80-100 | `critical` |
| 50-79 | `high` |
| 25-49 | `medium` |
| 0-24 | `low` |

`confirmed_conflict`는 최상위 signal입니다. 이 signal이 있으면 다른 reason을 추가로 합산하지 않고 `critical` risk로 처리합니다.

각 reason은 report에 code, message, score impact, 관련 file, 관련 branch, 관련 check metadata로 표시됩니다. 이 정보가 AI prediction에 전달되는 정제된 evidence입니다.

## AI-assisted prediction

AI prediction은 deterministic possibility score를 대체하지 않습니다. Watcher는 deterministic evidence를 Gemini API에 전달하고 AI는 실무 관점의 prediction, confidence, recommended actions, false positive notes를 추가합니다.

기본 AI provider는 Gemini API입니다. consumer repository에는 `GEMINI_API_KEY` secret을 설정해야 합니다.

AI prediction 대상은 기본적으로 `medium` 이상 possibility입니다. 현재 기준으로 score가 25점 이상인 branch만 AI prediction 대상으로 선택됩니다. 낮은 score의 branch는 AI 호출을 생략하고 `skipped` 상태로 report에 표시됩니다.

AI prediction 결과는 다음 상태 중 하나입니다.

| status | 의미 |
| --- | --- |
| `predicted` | Gemini API 응답을 검증했고 prediction과 recommended actions를 report에 포함함 |
| `skipped` | deterministic possibility score가 threshold보다 낮아 AI 호출을 생략함 |
| `failed` | provider 호출이나 응답 검증에 실패해 branch 단위 실패로 격리함 |

AI provider가 실패해도 deterministic possibility report는 유지됩니다. 실패한 branch는 `failed` 상태와 error message를 report에 포함합니다.

## Report channel

Merge risk report는 Markdown으로 생성됩니다. consumer repository에 `DISCORD_WEBHOOK_URL` secret이 있으면 Discord webhook으로 전송하고, 없으면 stdout으로 출력합니다.

Discord webhook으로 전송할 때는 Discord message length 제한에 맞춰 긴 report를 여러 메시지로 나눕니다. 전송 실패가 발생해도 webhook URL secret이 error message에 그대로 노출되지 않도록 처리합니다.

## Local development

local 개발에서는 Node 22를 사용합니다.

```sh
npm ci
npm run build
npm test
```

`npm test`는 compiled JavaScript test를 실행합니다. 테스트는 provider와 report channel을 mock으로 검증하므로 실제 GitHub, Gemini, Discord 호출을 수행하지 않습니다.

실제 runner를 local에서 실행하려면 watched repository checkout과 secret 환경 변수가 필요합니다. 이 실행은 GitHub API, Gemini API, Discord webhook을 호출할 수 있으므로 필요한 경우에만 사용합니다.

```sh
WATCHER_REPOSITORY=owner/repo \
WATCHER_REPOSITORY_PATH=/path/to/watched-repository \
WATCHER_BASE_BRANCH=develop \
WATCHER_DEFAULT_BRANCH=main \
WATCHER_CRITICAL_FILE_PATTERNS='package-lock.json
.github/workflows/**' \
GITHUB_TOKEN=github-token \
GEMINI_API_KEY=gemini-api-key \
DISCORD_WEBHOOK_URL=discord-webhook-url \
npm run watch
```

## Local test와 scheduled run 차이

local test는 Watcher 내부 로직이 기대한 입력을 처리하는지 확인합니다. GitHub Actions의 reusable workflow, repository checkout, remote branch fetch, 실제 API 권한, schedule timing은 검증하지 않습니다.

scheduled run은 consumer repository의 실제 remote branch를 fetch하고, `base_branch`와 `default_branch`를 제외한 branch를 대상으로 merge signal과 metadata를 다시 수집합니다. 따라서 local test가 통과해도 consumer repository의 token permission, branch 정리 상태, Gemini API key, Discord webhook 상태가 잘못되면 scheduled run에서 실패할 수 있습니다.

## Troubleshooting

| 증상 | 확인할 항목 |
| --- | --- |
| workflow가 시작되지 않음 | consumer workflow가 `pull_request`, `schedule`, `workflow_dispatch` 중 필요한 trigger를 가지고 있는지 확인 |
| fork PR에서 실행되지 않음 | 예시 workflow의 `github.event.pull_request.head.repo.fork == false` 조건 확인 |
| checkout 또는 fetch 실패 | `WATCHER_GITHUB_TOKEN` 권한과 `contents: read` permission 확인 |
| PR metadata가 비어 있음 | `pull-requests: read` permission과 commit에 연결된 PR 존재 여부 확인 |
| check metadata가 비어 있음 | `checks: read` permission과 해당 branch head SHA의 check run 존재 여부 확인 |
| AI prediction이 `skipped`로 표시됨 | deterministic possibility score가 기본 threshold인 25점 미만인지 확인 |
| AI prediction이 `failed`로 표시됨 | `GEMINI_API_KEY` secret과 Gemini API 응답 형식 확인 |
| Discord 전송이 되지 않음 | `DISCORD_WEBHOOK_URL` secret과 webhook channel 권한 확인 |
| merge된 branch가 계속 감시됨 | GitHub `Automatically delete head branches` 설정과 원격 branch 삭제 상태 확인 |
