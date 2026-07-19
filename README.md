# Watcher

Watcher는 consumer repository의 active branch 조합을 분석하고 merge risk를 report하는 TypeScript/Node 자동화 도구입니다.

consumer repository는 Watcher 코드를 복사하지 않고 workflow 파일 하나만 추가해 reusable workflow를 호출합니다. Watcher repository는 reusable workflow, branch 조합 분석, AI prediction, report channel 구현을 소유합니다.

## 설치

consumer repository에 workflow 파일 하나를 추가합니다. 전체 예시는 `docs/examples/consumer-merge-risk-watch.yml`에 있습니다.

운영 환경에서는 `uses: opficdev/Watcher/.github/workflows/merge-risk-watch.yml@0.1.0`처럼 release tag를 ref로 고정합니다. Watcher는 이 ref를 기준으로 같은 tag의 release asset을 자동으로 다운로드합니다.

예시에서 consumer repository에 맞게 `base_branch`, `default_branch`, secret 이름을 조정합니다.

## Consumer repository secrets

consumer repository의 `Settings` > `Secrets and variables` > `Actions` > `Repository secrets`에 다음 secret을 설정합니다.

| secret | 필수 여부 | 용도 |
| --- | --- | --- |
| `WATCHER_GITHUB_TOKEN` | 필수 | watched repository checkout, branch fetch, PR/check metadata 조회에 사용할 fine-grained PAT |
| `OPENAI_API_KEY` | 필수 | OpenAI prediction 생성 |
| `DISCORD_WEBHOOK_URL` | 선택 | Discord webhook report 추가 전송. 미설정 시 Actions summary 또는 stdout만 사용 |

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
| `base_branch` | 필수 | 없음 | 비교 조합에 포함할 기준 branch |
| `default_branch` | 선택 | 빈 값 | 감시 대상에서 제외할 default branch |
| `watcher_version` | 선택 | 빈 값 | 수동 테스트에 사용할 Watcher release tag. 비워두면 workflow ref 기준 |
| `upload_debug_artifact` | 선택 | `false` | AI prediction 원인 추적용 debug artifact를 consumer workflow run에 업로드할지 여부 |

## Branch 운영 기준

Watcher는 `base_branch`와 `default_branch`를 active branch 선택 대상에서 제외합니다. `base_branch`는 선택된 active branch와 함께 비교 집합에 별도로 포함하고, 이 집합에서 중복 없는 모든 branch 조합을 이름순으로 구성합니다. branch 이름에 맞춰야 하는 prefix나 regex는 요구하지 않습니다.

Watcher는 remote tracking branch의 최신 commit `committer date`가 최근 14일 이내인 branch를 갱신 시각 내림차순, 동률이면 이름순으로 최대 30개 선택합니다. 기간·개수 초과 branch는 `Excluded Branches`에 `stale_branch`, `branch_limit`으로 표시합니다. 14일·30개는 고정 정책이며 조정용 workflow input은 추가하지 않습니다.

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

## Branch 조합 분석

Watcher는 `base_branch`와 선택된 active branch 전체에서 중복 없는 모든 조합을 만들고, 각 조합에 virtual merge와 변경 문맥 수집을 수행합니다. 같은 입력은 항상 같은 조합 순서, 상태, reason을 만들어야 합니다. active branch가 상한인 30개이면 `base_branch`를 포함한 31개 branch에서 `31 × 30 ÷ 2 = 465`개 조합을 비교합니다.

분석 전 `git fetch --prune`으로 local remote tracking ref를 갱신한 뒤, 고정된 commit OID를 `git merge-tree --stdin --name-only --messages`에 전달해 가상 병합 결과를 읽습니다. 이 검사는 현재 branch를 전환하거나 worktree 파일을 수정하지 않으며 merge commit 생성, remote push, PR 수정도 수행하지 않습니다.

| status | reason | 의미 |
| --- | --- | --- |
| `confirmed_conflict` | `confirmed_conflict` | virtual merge에서 conflict가 확인됨 |
| `error` | `merge_check_failed` | merge 결과를 수집하지 못함 |
| `error` | `code_context_failed` | 변경 문맥을 수집하지 못함 |
| `potential_overlap` | `same_hunk_overlap` | clean merge 조합이 같은 파일의 겹치는 hunk를 수정함 |
| `potential_overlap` | `same_file_overlap` | clean merge 조합이 같은 파일을 수정함 |
| `clean` | `clean_merge` | conflict와 변경 겹침이 확인되지 않음 |

`confirmed_conflict`는 code context 결과보다 우선합니다. merge 검사 실패와 clean merge의 변경 문맥 수집 실패는 해당 조합만 `error`로 격리합니다.

Report의 `Summary`에는 active period, base branch, 발견·감시 branch 수, 비교·clean 조합 수를 표시합니다. 상세 결과는 `Confirmed Conflicts`, `Potential Risks`, `Branch Impact`, `Excluded Branches`, `Merge Errors`로 나눕니다. 확정 conflict와 잠재 위험 항목에는 branch 조합, 상태, commit OID, reason, 관련 파일, conflict type, AI 결과를 표시합니다.

## AI-assisted prediction

AI prediction은 결정론적 status와 reason을 대체하지 않고 분석과 해결 방안을 report 제안으로만 추가합니다. 검증된 응답과 `Suggested Patch`도 worktree에 적용하지 않으며 commit, push, PR 수정, conflict 자동 해결을 수행하지 않습니다.

기본 AI provider는 OpenAI Responses API입니다. consumer repository에는 `OPENAI_API_KEY` secret을 설정해야 합니다.

OpenAI API에는 대상 조합의 branch 이름·commit OID·status·reason·conflict 정보와 관련 파일의 merge base, left branch, right branch, virtual merge 결과 코드 원문을 JSON으로 전달합니다. 32 KiB 이하이면서 400줄 이하인 파일은 전체 내용을 사용할 수 있고, 그 밖의 파일은 대상 hunk의 함수 범위 또는 전후 40줄을 version별 최대 400줄까지 수집합니다. 네 version 코드 원문은 조합당 최대 128 KiB이며, 초과 hunk를 제외하고 포함·제외 file 및 hunk 수를 함께 전달합니다.

AI prediction 대상은 모든 `confirmed_conflict` 조합과 `same_hunk_overlap` reason이 있는 `potential_overlap` 조합입니다. `same_file_overlap`만 있는 `potential_overlap` 조합은 호출 대상에서 제외하고 `skipped` 상태로 표시합니다. `clean`은 Summary의 개수로만 집계하고 `error`는 `Merge Errors`에 표시하며 AI 상태를 붙이지 않습니다. 대상 조합이 없으면 AI client를 만들거나 provider를 호출하지 않습니다.

선택된 조합은 정렬된 순서대로 하나씩 provider에 요청합니다. 한 조합의 provider 호출이나 응답 검증이 실패해도 다음 조합 분석과 결정론적 report는 유지합니다.

AI prediction 결과는 다음 상태 중 하나입니다.

| status | 의미 |
| --- | --- |
| `predicted` | OpenAI API 응답을 검증했고 conflict 또는 overlap 원인, 통합 순서, patch 또는 예방 조치를 report에 포함함 |
| `skipped` | AI prediction 대상이 아니어서 provider 호출을 생략함 |
| `failed` | provider 호출이나 응답 검증에 실패해 조합 단위 실패로 격리함 |

AI provider가 실패해도 조합의 결정론적 상태와 reason은 유지됩니다. `confirmed_conflict` 분석에는 conflict 원인, merge 또는 rebase 순서, 해결 단계, `Suggested Patch`를 포함합니다. `same_hunk_overlap` 분석에는 overlap 원인, 통합 순서, 예방 조치를 포함합니다.

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
| `run.json` | repository, repository path, base branch, default branch, remote, GitHub API URL, Watcher workflow ref, 생성 시각 |
| `branch-selection.json` | 수집된 branch, 감시 대상 branch, 제외된 branch와 사유 |
| `branch-pairs.json` | base branch와 감시 대상 branch 전체의 이름순 비교 조합 |
| `deterministic-evidence.json` | 조합별 merge 결과와 conflict graph |
| `ai-target-selection.json` | AI 호출 대상 조합과 제외된 조합의 상태·reason |
| `ai-prompt.json` | OpenAI 요청 대상 조합과 코드 원문을 제외한 file·line range·길이·hash·잘림 여부. prompt가 있을 때만 생성 |
| `ai-response.json` | provider response와 제안 patch 원문을 제외한 byte length·line count·hunk range |
| `ai-error.json` | provider 호출 또는 response validation 실패 요약. 실패가 없으면 생성되지 않을 수 있음 |
| `ai-result.json` | response validation 이후 대상 조합의 `predicted`, `failed` 결과. 대상이 없어도 생성 |

`ai-response.json`은 응답이 있을 때만, `ai-error.json`은 실패가 있을 때만 생성합니다. debug artifact에는 `GITHUB_TOKEN`, `WATCHER_GITHUB_TOKEN`, `OPENAI_API_KEY`, `DISCORD_WEBHOOK_URL`을 기록하지 않습니다. raw source, raw patch, provider 오류 원문도 포함하지 않습니다.

## Report channel

Merge risk report는 Markdown으로 생성되어 GitHub Actions의 `GITHUB_STEP_SUMMARY`에 기록되고, 경로가 없거나 기록에 실패하면 stdout으로 출력됩니다. `DISCORD_WEBHOOK_URL`이 있으면 같은 report를 Discord에도 전송합니다.

현재 webhook report channel은 Discord incoming webhook 전용입니다. Slack incoming webhook은 payload 형식이 달라 `DISCORD_WEBHOOK_URL`에 Slack URL을 넣어도 동작하지 않습니다.

Discord 전송은 report를 메시지당 2,000자 이하로 나누되 `Summary`, section, branch 조합, AI 분석, 해결 순서, `Suggested Patch` 경계와 code fence, 조각 번호를 보존합니다. `429` 응답에는 숫자 형식의 `Retry-After` header를 우선하고, 해당 값이 없거나 유효하지 않으면 숫자 형식의 JSON `retry_after`를 사용해 같은 fragment를 최대 3회 재시도합니다. 성공 응답의 `X-RateLimit-Remaining`이 `0`이고 다음 fragment가 있으면 `X-RateLimit-Reset-After`만큼 기다린 뒤 전송합니다. `429` 재시도 대기와 bucket reset 대기는 모든 fragment가 공유하는 Discord 전송 전체 60초 예산에 합산합니다. 필요한 대기값이 없거나 유효하지 않은 경우, 다음 대기가 남은 예산을 초과하는 경우, 재시도 횟수를 소진한 경우에는 추가 요청 없이 Discord 전송 실패를 반환해 Watcher job을 실패로 종료합니다. Discord 전송이 최종 실패해도 이미 기록된 GitHub Actions `Summary`의 전체 report는 유지되며, 오류에는 webhook URL과 Discord 응답 본문을 포함하지 않습니다.

### Report 예시

```markdown
## Merge Risk Report

### Summary
- active period: `2026-07-03T00:00:00.000Z` - `2026-07-17T00:00:00.000Z` (`14 days`)
- base branch: `develop`
- discovered branches: 1
- watched branches: 0
- compared pairs: 0
- clean pairs: 0

### Confirmed Conflicts

없음

### Potential Risks

없음

### Branch Impact

없음

### Excluded Branches

없음

### Merge Errors

없음
```

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
| `base_branch` | 비교 조합에 포함할 branch. 예: `develop` |
| `default_branch` | 제외할 default branch. 예: `main` |
| `watcher_version` | 테스트할 Watcher release tag. 비워두면 workflow ref 기준 |
| `upload_debug_artifact` | 문제 원인 추적이 필요할 때만 `true` |

3. consumer repository secret을 설정합니다.

| secret | 테스트 기준 |
| --- | --- |
| `WATCHER_GITHUB_TOKEN` | 테스트 repository만 Repository access로 선택한 fine-grained PAT |
| `OPENAI_API_KEY` | OpenAI API 호출 가능한 key |
| `DISCORD_WEBHOOK_URL` | 처음에는 설정하지 않음 |

4. consumer repository의 Actions 화면에서 `Merge Risk Watch` workflow를 `workflow_dispatch`로 실행해 `Summary`의 report를 확인하고, 기록에 실패하면 `Run Watcher` step의 stdout을 확인합니다. 이 단계에서 branch 수집, merge signal 수집, OpenAI prediction, report 생성을 점검합니다.

5. Actions summary 또는 stdout report가 정상일 때만 consumer repository secret에 `DISCORD_WEBHOOK_URL`을 추가하고 같은 workflow를 다시 수동 실행합니다.

Discord 메시지가 정상적으로 도착하면 consumer repository의 예시 workflow에 `schedule` trigger를 유지하거나 운영 시간에 맞게 조정해 실서비스 실행으로 전환합니다.

## Local test와 scheduled run 차이

local test는 Watcher 내부 로직이 기대한 입력을 처리하는지 확인합니다. GitHub Actions의 reusable workflow, repository checkout, remote branch fetch, 실제 API 권한, schedule timing은 검증하지 않습니다.

scheduled run은 consumer repository의 실제 remote branch를 fetch하고, `base_branch`와 선택된 active branch의 모든 조합을 대상으로 merge signal과 변경 문맥을 다시 수집합니다. `default_branch`는 active branch 선택 대상에서 제외합니다. 따라서 local test가 통과해도 consumer repository의 token permission, branch 정리 상태, OpenAI API key, Discord webhook 상태가 잘못되면 scheduled run에서 실패할 수 있습니다.

## Troubleshooting

| 증상 | 확인할 항목 |
| --- | --- |
| workflow가 시작되지 않음 | consumer workflow가 `schedule`, `workflow_dispatch` 중 필요한 trigger를 가지고 있는지 확인 |
| checkout 또는 fetch 실패 | `WATCHER_GITHUB_TOKEN`의 Repository access, `Contents: Read-only`, workflow `contents: read` 확인 |
| PR metadata가 비어 있음 | `WATCHER_GITHUB_TOKEN`의 `Pull requests: Read-only`, commit에 연결된 PR 존재 여부 확인 |
| check metadata가 비어 있음 | 해당 branch head SHA의 check run 존재 여부 확인 |
| 예상한 branch가 감시되지 않음 | report의 `Excluded Branches`에서 `stale_branch`, `branch_limit` 확인. `base_branch`, `default_branch`는 active branch 선택 대상에서 제외됨 |
| 비교 조합 수가 예상과 다름 | `watched branches` 수에 `base_branch` 1개를 더한 값을 `n`이라 할 때, 중복 없는 조합 수를 `n × (n - 1) ÷ 2`로 계산. 최대값은 465개 |
| 모든 조합이 `merge_check_failed`로 표시됨 | runner의 Git이 `git merge-tree --stdin`을 지원하는지 확인 |
| AI prediction이 `skipped`로 표시됨 | 조합이 `confirmed_conflict`인지 또는 `potential_overlap`에 `same_hunk_overlap` reason이 있는지 확인 |
| AI prediction이 `failed`로 표시됨 | `OPENAI_API_KEY` secret, OpenAI API 응답 형식, rate limit 상태 확인 |
| Discord 전송이 되지 않음 | `DISCORD_WEBHOOK_URL` secret, Discord incoming webhook URL, webhook channel 권한 확인 |
| Actions `Summary`에 report가 보이지 않음 | `Run Watcher` step의 stdout fallback과 `GitHub Actions summary write failed` 오류 확인 |
| Discord report가 여러 메시지로 나뉨 | 메시지당 2,000자 제한에 따른 정상 동작. branch 조합명과 조각 번호로 순서 확인 |
| Discord report가 일부만 전송된 뒤 `429`로 실패함 | `Run Watcher` step 오류에서 `retry delay unavailable`, `after 3 retries`, `Discord wait budget of 60 seconds exhausted` 중 해당 원인을 확인하고, 최종 실패 시 GitHub Actions `Summary`에 먼저 기록된 전체 report 확인 |
| merge된 branch가 계속 감시됨 | GitHub `Automatically delete head branches` 설정과 원격 branch 삭제 상태 확인 |
