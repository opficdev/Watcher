# Watcher

Watcher는 branch 단위로 merge conflict 가능성 분석에 필요한 정보를 수집하는 TypeScript/Node 자동화 도구입니다.

## 사용법

Watcher는 기준이 되는 `baseBranch`와 `defaultBranch`를 제외한 모든 branch를 감시 대상으로 수집합니다.

GitHub repository의 `Settings` > `General` > `Pull Requests`에서 `Automatically delete head branches` 옵션을 반드시 켜야 합니다. 이 옵션을 켜면 merge된 branch가 자동으로 삭제되어 Watcher가 이미 merge된 branch까지 계속 감시하는 상황을 줄일 수 있습니다.

AI prediction은 기본 provider로 Gemini API를 사용합니다. consumer repository에는 `GEMINI_API_KEY` secret을 설정해야 하며 Watcher는 deterministic evidence를 Gemini에 전달해 prediction과 recommended actions를 생성합니다.

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
