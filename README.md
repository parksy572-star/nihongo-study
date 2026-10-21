# 나만의 일본어 공부

나만의 일본어 공부 사이트. 단어장 · 단어 테스트 · 문법 노트 · 회화/면접(AI) · 작문(AI).

- 화면: `public/` (빌드 없이 그대로 배포되는 정적 파일, 진입점 `public/js/app.js`)
- AI 중계: `src/worker.js`, `src/gemini.js` (Cloudflare Worker, Gemini API 키를 숨김)
- Worker 설정: `wrangler.jsonc`
- 데이터베이스 설정: `supabase/schema.sql`

## 처음 설정 (한 번만)

### 1. Supabase
1. 대시보드 왼쪽 **SQL Editor** → **New query** → `supabase/schema.sql` 전체를 붙여 넣고 **Run**.
2. **Authentication → URL Configuration → Site URL**에 Cloudflare 사이트 주소(Worker의 **Domains**에 보이는 `https://nihongo-study.<계정이름>.workers.dev` 주소)를 넣는다.
3. 사이트에서 내 계정으로 가입을 마친 뒤, **Authentication → Sign In / Providers**에서 **Allow new users to sign up**을 끈다. (다른 사람이 가입하지 못하게)

### 2. Cloudflare Worker
1. **Workers & Pages → Create application** → GitHub 저장소 `nihongo-study` 연결. Worker 이름은 `nihongo-study` (wrangler.jsonc의 name과 같아야 함).
2. **Settings → Builds**: Build command 비움, Deploy command `npx wrangler deploy`.
3. 배포가 끝나면 **Settings → Variables and Secrets → Add**에서 아래를 **Secret**으로 추가한다.

| 이름 | 값 |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio에서 받은 키 |
| `ALLOWED_EMAIL` | 사이트 로그인에 쓰는 내 이메일 |
| `GEMINI_MODEL` (선택) | 기본으로 쓸 모델 이름 |

`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`는 공개돼도 되는 값이라 `wrangler.jsonc`에 들어 있다.

## 출처
- 한자 데이터: KANJIDIC2 — EDRDG, CC BY-SA 4.0
- 획순: KanjiVG — © Ulrich Apel, CC BY-SA 3.0
