# pinboard

Claude Code mod: 대화 중에 나온 표, 아티팩트 링크, 답변을 핀으로 저장해 두고 옆 패널(Pins)에서 언제든 다시 보는 플러그인입니다.
Pin tables, artifact links and answers from a Claude Code conversation into a side pane you can reopen any time.

긴 대화에서 "아까 그 표"를 찾으려고 위로 한참 스크롤하는 일을 없애려고 만들었습니다. 핀은 세션이 끝나도 남습니다.

## 설치

GitHub 저장소를 마켓플레이스로 등록해 설치합니다. Claude Code 프롬프트에서:

```
/plugin install pinboard --marketplace Young-in/pinboard
```

`Add marketplace?`에 `y`, 범위는 user를 고르면 됩니다. 개발 중이거나 로컬 폴더에서 바로 쓰려면:

```
claude --plugin-dir /path/to/pinboard
```

터미널 플래그를 줄 수 없는 환경(데스크톱 앱 등)에서는 `~/.claude/settings.json`의 `env`에 `CLAUDE_CODE_PLUGIN_DIRS=/path/to/pinboard`를 넣습니다.

## 사용법

### 저장하기

| 입력 | 동작 |
| --- | --- |
| `/pin` | 마우스로 선택한 텍스트가 있으면 그것을 저장. 없으면 마지막 답변의 표와 아티팩트 링크를 저장. 둘 다 없으면 답변 전체 저장 |
| `/pin 제목` | 위와 같되 제목을 지정 |
| `/pin all [제목]` | 마지막 답변 전체 |
| `/pin tables` / `/pin links` | 마지막 답변의 표만 / 링크만 (일반 https 링크 포함) |
| 패널의 "이번 세션의 후보" | 답변이 올 때마다 표와 `claude.ai/artifact` 링크를 감지해 띄움. 한 번 누르면 저장 |
| 모델에게 말로 | "이 표 저장해줘", "핀해줘" 하면 모델이 `pin` 도구를 호출 |

### 보기·쓰기

패널은 이렇게 생겼습니다. 색은 사용자의 Claude Code 테마를 따릅니다.

```
Pins 3                                      f: 다음 필터
전체 3  표 1  아티팩트 1  링크 1  이 프로젝트 3
────────────────────────────────────────────────────────
▍ 1: 모델별 벤치마크 점수                         ▤ 5분
  2: Benchmark Scorecard                          ◈ 3분
  3: Claude Code 플러그인 문서                     ⇗ 3분

╭──────────────────────────────────────────────────────╮
│ ▤ 모델별 벤치마크 점수                                │
│ 표 · youngin · 2026-10-08 17:42                      │
│                                                      │
│  (표가 마크다운으로 다시 그려짐)                       │
│                                                      │
│ c: 복사  p: 프롬프트에 넣기  x: 삭제                  │
╰──────────────────────────────────────────────────────╯

─ 이번 세션의 후보 · 누르면 저장 ────────────────────────
+ a: 실험 결과                                    ▤ 방금
────────────────────────────────────────────────────────
Esc 프롬프트로 · /pin help 도움말
```

- `/pins`: 패널 열기/닫기. fullscreen 터미널(110열 이상)에서는 대화 오른쪽에 도킹되고, 그 외에는 프롬프트 위 인라인 블록으로 열립니다.
- `ctrl+x tab`으로 패널에 포커스를 주면 단축키가 동작합니다. 버튼마다 단축키가 `c: 복사`처럼 붙어 있습니다. `1`~`9` 핀 선택, `a/s/d/g/h` 후보 저장, `c` 복사, `p` 프롬프트에 넣기, `x` 삭제(한 번 더 눌러 확인), `u` 되돌리기, `f` 다음 필터, `Esc` 프롬프트로. 필터 탭은 마우스로 눌러도 됩니다.
- 선택한 핀은 종류별 색 테두리 카드 안에 마크다운으로 다시 그려집니다. 링크 핀은 클릭할 수 있는 하이퍼링크입니다.
- 제목은 한글 폭(2칸)을 계산해 패널 폭에 맞게 말줄임됩니다.
- `/pin show 3`: 3번 핀의 내용을 대화에 출력합니다. 모델도 읽으므로 "이걸로 다시 해줘"가 됩니다.

### 지우기·관리

| 입력 | 동작 |
| --- | --- |
| `/pin rm 3`, `/unpin 3`, `/pin rm last` | 패널 번호 또는 가장 최근 핀 삭제 |
| `/pin undo` | 마지막 삭제 되돌리기 (`/pin clear`도 되돌릴 수 있음) |
| `/pin clear` | 전체 삭제 (확인 후) |
| `/pin export` | `~/.claude/pins/pins-<날짜>.md`로 내보내기 |
| `/pin auto on\|off` | 세션 시작·새 후보 감지 시 패널 자동 열기 (기본 on). 패널을 직접 닫으면 그 세션에서는 다시 자동으로 열지 않음 |
| `/pin help` | 도움말 |

모델용 도구는 `pin`, `unpin`, `list` 세 개입니다. "핀 목록 보여줘", "둘째 핀 지워줘" 같은 요청을 모델이 처리합니다.

## 동작 방식

[Claude Code 함수 훅 플러그인](https://docs.claude.com/en/docs/claude-code/plugins)입니다. `hooks/register.tsx` 하나가 다음 이벤트를 받습니다.

- `session.start`: 커맨드와 도구를 등록하고, 저장소(`$.store`)의 핀을 세션 상태로 불러옵니다.
- `command.run`: `/pin`, `/unpin`, `/pins`.
- `tool.call`: `mcp__pinboard__pin|unpin|list`.
- `session.append` (door `response`): 답변의 각 텍스트 블록에서 표와 아티팩트 링크를 뽑아 후보로 둡니다.
- `ui.render` (`Pane`): 패널을 그립니다. 상태는 `$.state` atom에 두어 바뀔 때마다 패널이 다시 그려집니다.
- `ui.close`: 사용자가 패널을 닫으면 그 세션에서는 자동으로 다시 열지 않습니다.

핀은 `$.store`의 `pins` 키에 JSON으로 보관됩니다. 최대 200개, 본문은 20 KB에서 잘립니다. 같은 내용(공백 차이 무시)은 두 번 저장되지 않습니다.

표 추출은 `hooks/extract.ts`의 순수 함수입니다. 헤더 줄 다음에 `|---|` 구분 줄이 오는 마크다운 표를 찾고, 바로 위의 짧은 줄이나 헤딩, 콜론으로 끝나는 줄을 제목으로 씁니다.

## 제약

- 오른쪽 도킹과 마우스 선택 읽기는 fullscreen 터미널 레이아웃에서만 됩니다. 일반 화면에서는 패널이 프롬프트 위에 인라인으로 열리고, `/pin`은 마지막 답변 추출로 동작합니다.
- 패널의 버튼과 단축키는 패널이 키보드를 잡고 있을 때(`ctrl+x tab` 또는 클릭) 눌립니다.
- 플러그인 API는 early access입니다. Claude Code 2.1.294에서 작성·검증했고, 이후 빌드에서 바뀔 수 있습니다.

## 개발

```
claude plugin validate .   # 매니페스트와 훅 모듈을 엔진 기준으로 검사
claude plugin test .       # hooks/*.test.ts(x) 를 엔진 위에서 실행
```

Claude Code가 이 폴더를 로드하면 `.claude-plugin/types/`에 API 타입 선언과 `tsconfig.json`을 생성합니다(둘 다 `.gitignore` 대상). 그 뒤 `tsc -p .`로 타입 검사가 됩니다(TypeScript 5.5 이상, Node 20 이상).

엔진은 `$`(엔진 인터페이스)를 훅 모듈과 같은 파일에 선언된 함수로만 따라가고 import 경계를 넘기지 못합니다. 그래서 `$`를 쓰는 코드는 `register.tsx` 한 파일에 섹션으로 나뉘어 있고, 순수 함수만 `extract.ts`로 분리돼 있습니다.

```
.claude-plugin/plugin.json      매니페스트
.claude-plugin/marketplace.json 이 저장소를 마켓플레이스로 쓰기 위한 파일
hooks/hooks.json                훅 모듈 지정
hooks/register.tsx              상태·저장소, 커맨드, 패널, 훅 등록
hooks/extract.ts                표·링크 추출, 제목 생성 (순수 함수)
hooks/format.ts                 터미널 폭(한글 2칸) 계산, 말줄임, 시간 표기 (순수 함수)
hooks/*.test.ts(x)              테스트
types/index.d.ts                세션 상태 계약 (PluginState)
```

변경 내역은 [CHANGELOG.md](CHANGELOG.md)에 있습니다. 이전 버전으로 돌아가려면 태그를 씁니다(예: `git checkout v0.1.0`).

## 라이선스

[MIT](LICENSE)
