// POST /api/gemini — 브라우저 대신 Gemini API를 불러 주는 중계 서버 (Cloudflare Worker).
// - Gemini API 키는 Cloudflare 비밀값(GEMINI_API_KEY)에만 있고 브라우저로 나가지 않는다.
// - Supabase에 로그인한 내 계정(ALLOWED_EMAIL)의 요청만 전달한다.
// - action 'file': 내 보관함의 녹음·사진을 Gemini 파일 저장소로 옮겨 주소(uri)를 돌려준다.
//
// 필요한 값
//   wrangler.jsonc 의 vars : SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (공개돼도 되는 값)
//   Cloudflare 대시보드 > Worker > Settings > Variables and Secrets (Secret 으로 추가)
//     GEMINI_API_KEY  Google AI Studio에서 발급한 키
//     ALLOWED_EMAIL   사이트 로그인에 쓰는 내 이메일
//     GEMINI_MODEL    (선택) 기본 모델 이름. 비워 두면 화면에서 고른 모델을 쓴다.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_NAME = /^[a-z0-9][a-z0-9.\-]{1,80}$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// 로그인 확인 결과를 잠깐 기억해 요청마다 Supabase에 다시 묻지 않는다.
// (같은 Worker 인스턴스 안에서만, 최대 5분 또는 토큰 만료 30초 전까지)
const USER_CACHE_MS = 5 * 60 * 1000;
const userCache = new Map(); // token -> { user, until }

function tokenExpiry(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function verifyUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { ok: false, status: 401, error: 'not_signed_in' };
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, status: 500, error: 'server_missing_supabase_config' };
  }
  const allowed = (env.ALLOWED_EMAIL || '').trim().toLowerCase();
  if (!allowed) return { ok: false, status: 500, error: 'server_missing_allowed_email' };

  const now = Date.now();
  let user = null;
  const hit = userCache.get(token);
  if (hit && hit.until > now) {
    user = hit.user;
  } else {
    userCache.delete(token);
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { ok: false, status: 401, error: 'session_invalid' };
    user = await r.json();
    const exp = tokenExpiry(token);
    const until = Math.min(now + USER_CACHE_MS, exp ? exp - 30000 : now + USER_CACHE_MS);
    if (until > now) {
      if (userCache.size >= 50) userCache.delete(userCache.keys().next().value);
      userCache.set(token, { user, until });
    }
  }
  if ((user.email || '').toLowerCase() !== allowed) {
    return { ok: false, status: 403, error: 'not_allowed' };
  }
  return { ok: true, user, token };
}

// 보관함(media/<내 id>/...)의 파일을 Gemini 파일 저장소로 옮긴다.
// 휴대폰은 녹음을 보관함에 한 번만 올리고, 받아쓰기·분석은 이 파일 주소(uri)를 함께 쓴다.
// 파일을 다시 인코딩하지 않으므로 음질이 그대로다. Gemini 파일은 48시간 뒤 지워진다.
const ALLOWED_MEDIA = /^(audio\/(wav|x-wav|mpeg|mp3|aac|ogg|flac)|image\/(jpeg|png|webp))$/;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function storageToGemini(env, who, body) {
  const path = String(body.path || '');
  const mimeType = String(body.mimeType || '');
  if (!path.startsWith(`${who.user.id}/`) || path.includes('..') || path.length > 300) {
    return json(400, { error: 'bad_path' });
  }
  if (!ALLOWED_MEDIA.test(mimeType)) return json(400, { error: 'bad_mime' });

  const objectUrl = `${env.SUPABASE_URL}/storage/v1/object/authenticated/media/${path.split('/').map(encodeURIComponent).join('/')}`;
  const src = await fetch(objectUrl, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${who.token}` },
  });
  if (!src.ok) return json(src.status === 404 || src.status === 400 ? 404 : 502, { error: 'storage_read_failed', status: src.status });
  const bytes = await src.arrayBuffer();
  if (!bytes.byteLength) return json(404, { error: 'storage_empty' });
  if (bytes.byteLength > MAX_FILE_BYTES) return json(413, { error: 'file_too_large' });

  const key = { 'x-goog-api-key': env.GEMINI_API_KEY };
  const start = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    method: 'POST',
    headers: {
      ...key,
      'content-type': 'application/json',
      'x-goog-upload-protocol': 'resumable',
      'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': String(bytes.byteLength),
      'x-goog-upload-header-content-type': mimeType,
    },
    body: JSON.stringify({ file: { display_name: path.split('/').pop().slice(0, 100) } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) {
    const detail = await start.json().catch(() => ({}));
    return json(start.status || 502, { error: 'gemini_upload_start_failed', detail });
  }
  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'x-goog-upload-offset': '0', 'x-goog-upload-command': 'upload, finalize' },
    body: bytes,
  });
  const out = await up.json().catch(() => ({}));
  if (!up.ok || !out.file?.uri) return json(up.status || 502, { error: 'gemini_upload_failed', detail: out });

  // 오디오·이미지는 보통 바로 쓸 수 있지만, 처리 중이면 잠깐 기다린다
  let file = out.file;
  for (let i = 0; i < 8 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const g = await fetch(`${GEMINI_BASE}/${file.name}`, { headers: key });
    if (g.ok) file = await g.json();
  }
  if (file.state === 'FAILED') return json(502, { error: 'gemini_file_failed' });
  return json(200, { uri: file.uri, name: file.name, mimeType: file.mimeType || mimeType, expirationTime: file.expirationTime || null });
}

export async function handleGemini(request, env) {
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

  // 보관함 파일을 Gemini 파일로 (녹음을 휴대폰에서 다시 보내지 않기)
  if (body.action === 'file') return storageToGemini(env, who, body);

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
