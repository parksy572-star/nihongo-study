# 나만의 일본어 공부 — Claude Code 작업 안내

1인용 일본어 학습 웹앱. 사용자는 한국어 화자이며 2026-11-14(토) 문화복장학원(文化服装学院) 복장과 유학 입시(2인 1조 약 10분 그룹 면접 + 약 400자 작문)를 준비 중이다.

- 기획서(전체 요구사항의 기준): https://claude.ai/code/artifact/3d613811-f32d-4354-a5d6-aaa61cf20b5a
  기능을 만들거나 바꾸기 전에 기획서의 해당 섹션을 따른다. 기획서와 코드가 다르면 기획서가 기준이다.
  링크를 열 수 없으면 저장소의 `docs/기획서.md`(2026-10-21 사본, 그림 제외)를 읽는다.
- 화면과 대화는 한국어. 일본어 표기는 일본 상용한자표(新字体) 기준.

## 구조

| 경로 | 역할 |
| --- | --- |
| `public/` | 빌드 없이 그대로 배포되는 정적 파일(HTML·CSS·ES 모듈). 프레임워크 없음 |
| `public/index.html`, `public/js/app.js` | 앱 진입점. 로그인 → 데이터 불러오기 → 해시 라우터(`#/words` 등)로 화면을 그린다 |
| `public/js/` | 공통 모듈: `core`(DOM·시트·모달·라우터), `db`(Supabase 동기화·오프라인 대기열·체험 모드), `ai`(Gemini 호출·캐시·재시도), `tts`(Gemini 음성·기기 음성), `kana`(가나·한글 발음 키), `kanji`(한자 정보 창), `furigana`(자동 후리가나), `genko`(원고지 검사), `photo`(자르기·회전·조각), `deck`(판 단위 반복) |
| `public/js/views/` | 화면: 단어장·테스트·문법·회화·면접(`talk*.js`)·작문(`writing*.js`)·검색·설정 |
| `public/ai-rules.js` | **AI 분석 가이드라인 코드판.** 모든 AI 요청은 `COMMON_RULES`를 앞에 붙이고, 응답 스키마와 사후 검사 함수, 무료 모델 목록(`FREE_*_MODELS`)을 여기에 둔다 |
| `public/audio.js` | 녹음(MediaRecorder) → 16kHz 모노 WAV 변환, 말소리 유무 검사 |
| `public/data/kanji/` | 한자 데이터(KANJIDIC2·KanjiVG·常用漢字表 대조) 32개 묶음 + `radicals.json` + `joyo.txt`. `tools/build_kanji.py`로 다시 만든다 |
| `public/check.html`, `check.js` | 0단계 점검 페이지(보존) |
| `src/worker.js`, `src/gemini.js` | Cloudflare Worker. `/api/gemini`만 처리하고 나머지는 정적 파일. Gemini 키는 Worker Secret에만 있다 |
| `wrangler.jsonc` | Worker 설정. `placement.region = gcp:us-east4`는 Gemini "User location is not supported" 오류를 피하려고 넣은 것이므로 지우지 말 것 |
| `supabase/schema.sql` | DB·보관함 설정. 여러 번 실행해도 안전하게 유지 |

## 핵심 규칙

- **데이터**: Supabase `public.items` 한 표에 `kind`(`word`·`kanji`·`grammar`·`preset`·`session`·`writing`·`log`·`settings`·`progress`(진행 중인 테스트·면접·작문)·`ai`(AI 결과 캐시, 시작 때 불러오지 않음))와 `data`(jsonb)로 저장. 화면은 `db.put/patch/remove`만 쓰고, 저장 대기열·실시간 반영은 `js/db.js`가 맡는다. RLS로 본인 행만 접근. 파일(녹음·작문 사진·TTS 캐시)은 Storage `media/<user_id>/...`. PC·휴대폰 동기화는 Realtime(`postgres_changes`)으로 한다.
- **기기 간 동기화(필수)**: 기기마다 달라야 하는 것(기기 내장 음성 선택, 마이크 권한, 화면 배치)을 뺀 **모든 것**을 서버에 저장하고 PC·휴대폰에 실시간 반영한다. 학습 데이터뿐 아니라 AI 분석 결과(입력 녹음·사진·글과 연결해 저장, 같은 입력은 어느 기기에서든 저장된 결과 재사용), 진행 중인 단어 테스트·면접 세션·작문 초안, 학습 기록, 설정까지 포함. 결과를 브라우저 메모리나 localStorage에만 두지 않는다(localStorage는 오프라인 임시 사본 용도만). 긴 글은 동시 수정 시 덮어쓰기 전에 알린다. 기능마다 '다른 기기에서 열면 그대로 보이고 이어서 할 수 있는가'를 확인한다. 자세한 표는 기획서 '데이터 구조 > 기기 간 동기화'.
- **AI**: 브라우저는 `/api/gemini`로만 Gemini를 부른다(키 노출 금지). 무료 등급 모델만 쓴다(`ai-rules.js`의 무료 모델 목록, 설정 > AI 모델에서 변경). 분석·교정은 temperature 0, 응답은 `responseSchema`로 고정, 결과는 사이트에서 한 번 더 검사한 뒤 보여준다. 같은 입력은 캐시 결과 재사용, 실행 중 버튼 잠금.
- **음성**: 듣기는 Gemini TTS(기본 Kore)를 쓰고 생성한 음성은 `media/<uid>/tts/<sha256>.wav`에 캐시. 아이폰은 버튼을 누른 순간 오디오를 한 번 재생(unlock)해야 이후 재생이 된다.
- **한자 정보**: 일본 한자 기준. 데이터는 KANJIDIC2(CC BY-SA 4.0), 획순은 KanjiVG(CC BY-SA 3.0) — 출처 표기 유지. nihongokanji.com은 **링크만** 건다(이용 안내상 스크래핑·내용 복제 금지). 네이버 일본어사전도 링크로만 연결.
- **화면**: 휴대폰 우선(390px 폭에서 가로 넘침 없어야 함), 라이트/다크 모두. 단어 테스트를 제외한 모든 목록은 리스트형/카드형 전환.
- **후리가나**: 일본어 문장은 `furi(text)`로 그려 모든 한자 위에 히라가나를 붙인다(설정에서 끄기). 단어장 가리기·단어 테스트처럼 읽기를 맞히는 곳에는 쓰지 않는다.
- **면접**: 실제 면접은 화상(온라인) 2인 그룹이다. 기본 프리셋·대본(`talk-common.js`)·평가 기준이 이에 맞춰져 있다.
- **보안**: Secret 키(Gemini 키, Supabase secret key)는 코드·커밋에 절대 넣지 않는다.

## 배포

`main` 브랜치에 push하면 Cloudflare Workers Builds가 `npx wrangler deploy`로 자동 배포한다(1분 내외). 사용자에게 변경을 알릴 때는 배포 후 강력 새로고침이 필요하다고 안내한다.

실제 사이트에 반영되는 것은 `main`뿐이다. 작업 브랜치에서 일했다면, 한 덩어리가 끝날 때마다 PR을 만들고 사용자에게 GitHub에서 **Merge**를 누르면 1분 뒤 사이트에 반영된다고 알린다. 사용자는 개발자가 아니므로 git 용어 대신 "GitHub에서 초록 Merge 버튼" 같은 말로 안내한다.

## 로컬에서 확인하기

`python3 -m http.server 8787 --directory public` 후 `http://localhost:8787/?demo` 를 열면 **체험 모드**: 로그인 없이 이 브라우저에만 저장하고, AI는 `js/mock.js`의 정해진 답을 쓴다(마이크가 없으면 가짜 소리로 녹음). 탭 두 개를 열면 기기 간 동기화를 흉내 낸다. `&dur=40`을 붙이면 실전 면접 시간을 40초로 줄여 시험할 수 있다. 실제 사이트(localhost가 아닌 주소)에서는 체험 모드가 켜지지 않는다.

## 작업 방식

- 개발은 단계를 나누지 않고 기획서의 전체 기능을 만든다. 다만 면접(2인 그룹·실전 10분·발음 평가)과 작문(사진 분석·원고지 검사)이 면접일 전에 쓸 수 있어야 하므로 이 둘의 완성도를 우선 확인한다.
- 바꾼 뒤에는 390px 휴대폰 폭과 PC 폭에서 화면을 확인하고, AI 기능은 기획서의 'AI 분석 가이드라인 > 점검 방법'대로 시험한다.
