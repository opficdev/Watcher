# Watcher

Watcher는 consumer repository의 active branch를 감시하고 merge conflict 가능성을 report하는 TypeScript/Node 자동화 도구입니다.

consumer repository는 Watcher 코드를 복사하지 않고 workflow 파일 하나만 추가해 reusable workflow를 호출합니다. Watcher repository는 reusable workflow, deterministic possibility 계산, AI prediction, report channel 구현을 소유합니다.

## 설치

consumer repository에 workflow 파일 하나를 추가합니다. 전체 예시는 `docs/examples/consumer-merge-risk-watch.yml`에 있습니다.

운영 환경에서는 `uses: opficdev/Watcher/.github/workflows/merge-risk-watch.yml@0.1.0`처럼 release tag를 ref로 고정합니다. Watcher는 이 ref를 기준으로 같은 tag의 release asset을 자동으로 다운로드합니다.

예시에서 consumer repository에 맞게 `base_branch`, `default_branch`, `critical_file_patterns`, secret 이름을 조정합니다.

## Consumer repository secrets

consumer repository의 `Settings` > `Secrets and variables` > `Actions` > `Repository secrets`에 다음 secret을 설정합니다.

| secret | 필수 여부 | 용도 |
| --- | --- | --- |
| `WATCHER_GITHUB_TOKEN` | 필수 | watched repository checkout, branch fetch, PR/check metadata 조회에 사용할 fine-grained PAT |
| `OPENAI_API_KEY` | 필수 | OpenAI prediction 생성 |
| `DISCORD_WEBHOOK_URL` | 선택 | Discord webhook report 전송. 미설정 시 stdout으로 출력 |

`WATCHER_GITHUB_TOKEN`은 fine-grained personal access token을 권장합니다. public repository라도 checkout, branch fetch, check metadata, pull request metadata 조회를 같은 방식으로 처리하기 위해 explicit token을 사용합니다.

### `WATCHER_GITHUB_TOKEN` 권한

fine-grained PAT는 GitHub `Settings` > `Developer settings` > `Personal access tokens` > `Fine-grained tokens`에서 생성합니다. 생성 시 Repository access는 감시 대상 repository만 선택합니다. 모든 repository 접근 권한은 필요하지 않습니다.

| 설정 | 값 |
| --- | --- |
| Repository access | 감시 대상 repository만 선택 |
| Contents | Read-only |
| Pull requests | Read-only |
| Metadata | Read-only. GitHub가 자동 포함 |

`Contents: Read-only`는 checkout과 branch fetch에 필요합니다. `Pull requests: Read-only`는 commit에 연결된 PR metadata 조회에 필요합니다.

### Consumer workflow permissions

consumer workflow에는 다음 `permissions`가 필요합니다. 이 값은 GitHub Actions workflow token 권한이며, 위의 fine-grained PAT repository permission과 별개입니다.

| permission | 용도 |
| --- | --- |
| `contents: read` | Watcher source checkout 또는 release asset 다운로드 |

## Inputs

reusable workflow는 다음 input을 받습니다.

| input | 필수 여부 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `repository` | 필수 | 없음 | 감시할 repository. `owner/repo` 형식 |
| `base_branch` | 필수 | 없음 | merge risk를 비교할 기준 branch |
| `default_branch` | 선택 | 빈 값 | 감시 대상에서 제외할 default branch |
| `critical_file_patterns` | 선택 | 빈 값 | score에 반영할 critical file wildcard pattern 목록. 줄바꿈으로 구분 |
| `watcher_version` | 선택 | 빈 값 | 수동 테스트에 사용할 Watcher release tag. 비워두면 workflow ref 기준 |
| `upload_debug_artifact` | 선택 | `false` | AI prediction 원인 추적용 debug artifact를 consumer workflow run에 업로드할지 여부 |

`critical_file_patterns`에서 `*`는 단일 path segment 내부를 매칭하고 `**`는 path separator를 포함해 매칭합니다.

## Branch 운영 기준

Watcher는 `base_branch`와 `default_branch`를 제외한 remote branch를 감시 대상으로 수집합니다. branch 이름에 맞춰야 하는 prefix나 regex는 요구하지 않습니다.

Watcher는 merge된 branch를 직접 삭제하지 않습니다. consumer repository의 `Settings` > `General` > `Pull Requests`에서 `Automatically delete head branches` 옵션을 켜야 합니다. 이 옵션을 켜면 merge된 branch가 자동으로 삭제되어 이미 merge된 branch를 계속 감시하는 상황을 줄일 수 있습니다.

예시 workflow는 `schedule`, `workflow_dispatch`에서 실행됩니다. 일반 branch push나 PR 생성만으로는 실행되지 않으며 scheduled run에서 active branch 상태를 다시 확인합니다.

consumer repository의 예시 workflow는 `workflow_dispatch`를 지원하므로 Actions 화면에서 수동 테스트 실행이 가능합니다. `watcher_version`을 비워두면 `uses` ref 기준 release asset을 사용하고 특정 release tag를 입력하면 해당 version으로 테스트합니다.

## Release 배포

Watcher는 CD workflow에서 입력한 semantic version 기준으로 배포본을 생성합니다. Actions에서 `CD` workflow를 수동 실행하고 `version`에 `0.1.0` 같은 값을 입력하면 build와 test를 실행한 뒤 tag, GitHub Release, `watcher-deploy.tar.gz` asset을 생성합니다.

| input | 필수 여부 | 용도 |
| --- | --- | --- |
| `version` | 필수 | 생성할 release version. prefix 없는 semantic version. 예: `0.1.0` |
| `release_notes` | 선택 | GitHub Release 본문. 비어 있으면 GitHub release note 생성 사용 |

release asset에는 실행에 필요한 `dist/src`와 `package.json`이 포함됩니다. consumer repository가 reusable workflow를 release tag로 호출하면 Watcher는 같은 tag의 release asset을 다운로드해 실행합니다.

branch나 SHA ref로 reusable workflow를 호출하면 개발용 fallback으로 Watcher source를 checkout하고 `npm ci`, `npm run build`를 실행합니다.

## 충돌 가능성 점수화

Watcher는 merge 가능/불가능을 단정하지 않고 branch별 signal을 충돌 가능성 score와 reason으로 변환합니다. 이 값은 같은 입력에 대해 항상 같은 결과가 나와야 하는 기본 판단층입니다.

기본 입력은 branch metadata, git merge signal, 변경 파일, 변경 범위입니다. 변경 범위는 같은 파일 안에서 수정된 line range를 뜻하며 여러 branch가 같은 line range를 수정할수록 conflict 가능성을 높게 봅니다. Git diff에서는 이런 변경 범위를 hunk라고 부르며 Watcher는 같은 파일의 hunk line range가 겹치는지를 비교합니다.

| signal | score | 의미 |
| --- | ---: | --- |
| `confirmed_conflict` | 100 | virtual merge에서 실제 conflict가 확인됨 |
| `same_hunk_overlap` | 55 | 여러 branch가 같은 파일의 겹치는 변경 범위를 수정함 |
| `merge_check_failed` | 40 | fetch, merge-base, virtual merge 확인 단계가 실패함 |
| `same_file_overlap` | 30 | 여러 branch가 같은 파일을 수정함 |
| `critical_file_changed` | 25 | 설정한 critical file pattern에 해당하는 파일이 수정됨 |
| `failed_check` | 20 | branch metadata에 실패한 check가 존재함 |
| `clean_merge` | 0 | virtual merge에서 conflict가 확인되지 않음 |

각 branch의 score는 적용된 signal의 점수를 합산하고 최대 100점으로 제한합니다.

| score | status |
| ---: | --- |
| 80-100 | `critical` |
| 50-79 | `high` |
| 25-49 | `medium` |
| 0-24 | `low` |

`confirmed_conflict`는 최상위 signal입니다. 이 signal이 있으면 다른 reason을 추가로 합산하지 않고 `critical` risk로 처리합니다.

각 reason은 report에 code, message, score impact, 관련 file, 관련 branch, 관련 check metadata로 표시됩니다. 다만 `same_hunk_overlap`이 있는 branch에서는 중복되는 `same_file_overlap`의 file, branch 목록을 다시 반복하지 않습니다. 이 정보가 AI prediction에 전달되는 정제된 evidence입니다.

## AI-assisted prediction

AI prediction은 deterministic possibility score를 대체하지 않습니다. Watcher는 deterministic evidence를 OpenAI API에 전달하고 AI는 실무 관점의 prediction과 recommended actions를 추가합니다.

기본 AI provider는 OpenAI Responses API입니다. consumer repository에는 `OPENAI_API_KEY` secret을 설정해야 합니다.

AI prediction 대상은 기본적으로 `critical` possibility입니다. 이미 virtual merge에서 conflict가 확정된 branch는 AI 호출 없이 deterministic report만 사용합니다. 그 외 낮은 status의 branch는 AI 호출을 생략하고 `skipped` 상태로 report에 표시됩니다.

provider 호출량을 줄이기 위해 선택된 branch prediction은 report 단위 batch 요청으로 한 번에 실행합니다.

AI prediction 결과는 다음 상태 중 하나입니다.

| status | 의미 |
| --- | --- |
| `predicted` | OpenAI API 응답을 검증했고 prediction과 recommended actions를 report에 포함함 |
| `skipped` | AI prediction 대상이 아니어서 provider 호출을 생략함 |
| `failed` | provider 호출이나 응답 검증에 실패해 branch 단위 실패로 격리함 |

AI provider가 실패해도 deterministic possibility report는 유지됩니다. 실패한 branch는 `failed` 상태와 error message를 report에 포함합니다.

Report에는 `Low` section, AI prediction `skipped` 상태, branch `updated` 시각, provider error 요약을 유지합니다. Pull Request metadata는 내부 evidence로만 사용할 수 있으며 Markdown report에는 출력하지 않습니다.

## Debug artifact

AI prediction 입력이나 provider 응답을 확인해야 할 때 consumer workflow에서 `upload_debug_artifact`를 `true`로 설정합니다.

```yaml
with:
  upload_debug_artifact: true
```

이 옵션을 켜면 consumer repository의 해당 GitHub Actions run에 `watcher-debug` artifact가 업로드됩니다. Watcher repository가 아니라 reusable workflow를 호출한 consumer repository의 Actions 화면에서 다운로드합니다.

artifact에는 다음 파일이 포함됩니다.

| 파일 | 내용 |
| --- | --- |
| `run.json` | repository, base branch, default branch, critical file patterns, Watcher workflow ref |
| `branch-selection.json` | 수집된 branch, 감시 대상 branch, 제외된 branch와 사유 |
| `branch-pairs.json` | base branch와 감시 대상 branch 전체의 이름순 비교 조합 |
| `deterministic-evidence.json` | git merge signal, changed files, changed hunks, check/PR metadata, deterministic risk 결과 |
| `ai-target-selection.json` | AI 호출 대상 branch와 skipped branch 사유 |
| `ai-prompt.json` | OpenAI 요청 대상 branch, system prompt, response shape, 코드 원문을 제외한 file·line range·길이·hash·잘림 여부 |
| `ai-response.json` | provider response와 제안 patch 원문을 제외한 byte length·line count·hunk range |
| `ai-error.json` | provider 호출 또는 response validation 실패 요약. 실패가 없으면 생성되지 않을 수 있음 |
| `ai-result.json` | response validation 이후 branch별 AI prediction, skipped, failed 매핑 결과 |
| `report.md` | 최종 Markdown report |

debug artifact에는 `GITHUB_TOKEN`, `WATCHER_GITHUB_TOKEN`, `OPENAI_API_KEY`, `DISCORD_WEBHOOK_URL`을 기록하지 않습니다. raw file content와 raw diff 전문도 포함하지 않습니다.

## Report channel

Merge risk report는 Markdown으로 생성됩니다. consumer repository에 `DISCORD_WEBHOOK_URL` secret이 있으면 Discord webhook으로 전송하고, 없으면 stdout으로 출력합니다.

현재 webhook report channel은 Discord incoming webhook 전용입니다. Slack incoming webhook은 payload 형식이 달라 `DISCORD_WEBHOOK_URL`에 Slack URL을 넣어도 동작하지 않습니다.

Discord webhook으로 전송할 때는 Discord message length 제한에 맞춰 긴 report를 여러 메시지로 나눕니다. 전송 실패가 발생해도 webhook URL secret이 error message에 그대로 노출되지 않도록 처리합니다.

## Local development

local 개발에서는 Node 22를 사용합니다.

```sh
npm ci
npm run build
npm test
```

`npm test`는 compiled JavaScript test를 실행합니다. 테스트는 provider와 report channel을 mock으로 검증하므로 실제 GitHub, OpenAI, Discord 호출을 수행하지 않습니다.

실제 runner를 local에서 실행하려면 watched repository checkout과 secret 환경 변수가 필요합니다. 이 실행은 GitHub API, OpenAI API, Discord webhook을 호출할 수 있으므로 필요한 경우에만 사용합니다.

local 실행에서는 consumer repository secret 이름인 `WATCHER_GITHUB_TOKEN`이 아니라 runner가 읽는 환경 변수 `GITHUB_TOKEN`에 같은 fine-grained PAT 값을 넣습니다.

```sh
WATCHER_REPOSITORY=owner/repo \
WATCHER_REPOSITORY_PATH=/path/to/watched-repository \
WATCHER_BASE_BRANCH=develop \
WATCHER_DEFAULT_BRANCH=main \
WATCHER_CRITICAL_FILE_PATTERNS='package-lock.json
.github/workflows/**' \
WATCHER_DEBUG_ARTIFACT_DIR=/tmp/watcher-debug \
GITHUB_TOKEN=fine-grained-pat \
OPENAI_API_KEY=openai-api-key \
DISCORD_WEBHOOK_URL=discord-webhook-url \
npm run watch
```

## 실서비스 연결 전 테스트

consumer repository에 Discord webhook 전송을 붙이거나 scheduled run을 운영하기 전에 다음 순서로 확인합니다.

1. Watcher repository에서 local 검증을 먼저 실행합니다.

```sh
npm ci
npm run build
npm test
```

2. Watcher repository의 `docs/examples/consumer-merge-risk-watch.yml` 예시를 consumer repository의 workflow 파일로 추가합니다.

| 설정 | 테스트 값 |
| --- | --- |
| `base_branch` | 기준 branch. 예: `develop` |
| `default_branch` | 제외할 default branch. 예: `main` |
| `watcher_version` | 테스트할 Watcher release tag. 비워두면 workflow ref 기준 |
| `critical_file_patterns` | 테스트할 critical file pattern. 예: `package-lock.json`, `.github/workflows/**` |
| `upload_debug_artifact` | 문제 원인 추적이 필요할 때만 `true` |

3. consumer repository secret을 설정합니다.

| secret | 테스트 기준 |
| --- | --- |
| `WATCHER_GITHUB_TOKEN` | 테스트 repository만 Repository access로 선택한 fine-grained PAT |
| `OPENAI_API_KEY` | OpenAI API 호출 가능한 key |
| `DISCORD_WEBHOOK_URL` | 처음에는 설정하지 않음 |

4. consumer repository의 Actions 화면에서 `Merge Risk Watch` workflow를 `workflow_dispatch`로 수동 실행하고 stdout report를 확인합니다.

`DISCORD_WEBHOOK_URL`을 비워 두면 Discord로 전송하지 않고 GitHub Actions log에 Markdown report를 출력합니다. 이 단계에서 branch 수집, merge signal 수집, OpenAI prediction, report 생성이 정상인지 확인합니다.

5. stdout report가 정상일 때만 consumer repository secret에 `DISCORD_WEBHOOK_URL`을 추가하고 같은 workflow를 다시 수동 실행합니다.

Discord 메시지가 정상적으로 도착하면 consumer repository의 예시 workflow에 `schedule` trigger를 유지하거나 운영 시간에 맞게 조정해 실서비스 실행으로 전환합니다.

## Local test와 scheduled run 차이

local test는 Watcher 내부 로직이 기대한 입력을 처리하는지 확인합니다. GitHub Actions의 reusable workflow, repository checkout, remote branch fetch, 실제 API 권한, schedule timing은 검증하지 않습니다.

scheduled run은 consumer repository의 실제 remote branch를 fetch하고, `base_branch`와 `default_branch`를 제외한 branch를 대상으로 merge signal과 metadata를 다시 수집합니다. 따라서 local test가 통과해도 consumer repository의 token permission, branch 정리 상태, OpenAI API key, Discord webhook 상태가 잘못되면 scheduled run에서 실패할 수 있습니다.

## Troubleshooting

| 증상 | 확인할 항목 |
| --- | --- |
| workflow가 시작되지 않음 | consumer workflow가 `schedule`, `workflow_dispatch` 중 필요한 trigger를 가지고 있는지 확인 |
| checkout 또는 fetch 실패 | `WATCHER_GITHUB_TOKEN`의 Repository access, `Contents: Read-only`, workflow `contents: read` 확인 |
| PR metadata가 비어 있음 | `WATCHER_GITHUB_TOKEN`의 `Pull requests: Read-only`, commit에 연결된 PR 존재 여부 확인 |
| check metadata가 비어 있음 | 해당 branch head SHA의 check run 존재 여부 확인 |
| AI prediction이 `skipped`로 표시됨 | deterministic possibility status가 `critical`인지와 `confirmed_conflict`가 아닌지 확인 |
| AI prediction이 `failed`로 표시됨 | `OPENAI_API_KEY` secret, OpenAI API 응답 형식, rate limit 상태 확인 |
| Discord 전송이 되지 않음 | `DISCORD_WEBHOOK_URL` secret, Discord incoming webhook URL, webhook channel 권한 확인 |
| merge된 branch가 계속 감시됨 | GitHub `Automatically delete head branches` 설정과 원격 branch 삭제 상태 확인 |
