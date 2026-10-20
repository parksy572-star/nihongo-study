// Cloudflare Pages Function: POST /api/gemini
// 브라우저 대신 Gemini API를 불러 주는 중계 서버.
// - Gemini API 키는 Cloudflare 비밀값(GEMINI_API_KEY)에만 있고 브라우저로 나가지 않는다.
// - Supabase에 로그인한 내 계정(ALLOWED_EMAIL)의 요청만 전달한다.
//
// 필요한 환경 변수 (Cloudflare Pages > Settings > Variables and Secrets)
//   GEMINI_API_KEY           (Secret)  Google AI Studio에서 발급한 키
//   SUPABASE_URL             (Text)    https://xxxx.supabase.co
//   SUPABASE_PUBLISHABLE_KEY (Text)    sb_publishable_...
//   ALLOWED_EMAIL            (Text)    로그인에 쓰는 내 이메일
//   GEMINI_MODEL             (Text, 선택) 기본 모델 이름. 비워 두면 화면에서 고른 모델을 쓴다.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_NAME = /^[a-z0-9][a-z0-9.\-]{1,80}$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function verifyUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { ok: false, status: 401, error: 'not_signed_in' };
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, status: 500, error: 'server_missing_supabase_config' };
  }
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { ok: false, status: 401, error: 'session_invalid' };
  const user = await r.json();
  const allowed = (env.ALLOWED_EMAIL || '').trim().toLowerCase();
  if (!allowed) return { ok: false, status: 500, error: 'server_missing_allowed_email' };
  if ((user.email || '').toLowerCase() !== allowed) {
    return { ok: false, status: 403, error: 'not_allowed' };
  }
  return { ok: true, user };
}

export async function onRequestPost({ request, env }) {
  const who = await verifyUser(request, env);
  if (!who.ok) return json(who.status, { error: who.error });
  if (!env.GEMINI_API_KEY) return json(500, { error: 'server_missing_gemini_key' });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }

  const headers = { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' };

  // 사용할 수 있는 모델 목록 (generateContent를 지원하는 것만)
  if (body.action === 'models') {
    const r = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, { headers });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json(r.status, { error: 'gemini_error', detail: data });
    const models = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({
        id: String(m.name || '').replace(/^models\//, ''),
        displayName: m.displayName || '',
        inputTokenLimit: m.inputTokenLimit || null,
      }));
    return json(200, { models, defaultModel: env.GEMINI_MODEL || null });
  }

  // 생성 요청
  const model = String(body.model || env.GEMINI_MODEL || '');
  if (!MODEL_NAME.test(model)) return json(400, { error: 'bad_model' });
  if (!Array.isArray(body.contents) || body.contents.length === 0) {
    return json(400, { error: 'missing_contents' });
  }

  const payload = { contents: body.contents };
  if (body.systemInstruction) payload.systemInstruction = body.systemInstruction;
  if (body.generationConfig) payload.generationConfig = body.generationConfig;

  const r = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequest() {
  return json(405, { error: 'method_not_allowed' });
}
