# 일본어 공부방

나만의 일본어 공부 사이트. 단어장 · 단어 테스트 · 문법 노트 · 회화/면접(AI) · 작문(AI).

- 화면: `public/` (빌드 없이 그대로 배포되는 정적 파일)
- AI 중계: `functions/api/gemini.js` (Cloudflare Pages Function, Gemini API 키를 숨김)
- 데이터베이스 설정: `supabase/schema.sql`

## 처음 설정 (한 번만)

### 1. Supabase
1. 대시보드 왼쪽 **SQL Editor** → **New query** → `supabase/schema.sql` 전체를 붙여 넣고 **Run**.
2. **Authentication → URL Configuration → Site URL**에 Cloudflare 사이트 주소(예: `https://nihongo-study.pages.dev`)를 넣는다.
3. 사이트에서 내 계정으로 가입을 마친 뒤, **Authentication → Sign In / Providers**에서 **Allow new users to sign up**을 끈다. (다른 사람이 가입하지 못하게)

### 2. Cloudflare Pages
1. **Workers & Pages → Create application → Pages → Connect to Git** → GitHub → 이 저장소 선택.
2. 빌드 설정: Framework preset **None**, Build command **비움**, Build output directory **`public`** → **Save and Deploy**.
3. 프로젝트 **Settings → Variables and Secrets**에 아래를 추가하고 다시 배포한다.

| 이름 | 종류 | 값 |
| --- | --- | --- |
| `GEMINI_API_KEY` | Secret | Google AI Studio에서 받은 키 |
| `SUPABASE_URL` | Text | `https://zblbrabphcecrlvjxzey.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Text | `sb_publishable_...` (config.js와 같은 값) |
| `ALLOWED_EMAIL` | Text | 사이트 로그인에 쓰는 내 이메일 |
| `GEMINI_MODEL` | Text (선택) | 기본으로 쓸 모델 이름. 비우면 화면에서 고른 모델 |

## 출처
- 한자 데이터: KANJIDIC2 — EDRDG, CC BY-SA 4.0
- 획순: KanjiVG — © Ulrich Apel, CC BY-SA 3.0
