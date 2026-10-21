// Gemini 호출: 브라우저는 /api/gemini(Cloudflare Worker)로만 부른다.
// - 작업별 모델 등급(Flash / Flash-Lite)과 무작위성은 ai-rules.js의 TASKS를 따른다.
// - 응답은 responseSchema로 고정하고, 형식이 깨지면 한 번만 다시 요청한다.
// - 같은 입력은 db.aiGet(key)로 저장된 결과를 어느 기기에서든 다시 보여준다.

import { db, DEMO } from './db.js';
import { sha256, store, toast } from './core.js';
import { TASKS, FREE_FLASH_MODELS, FREE_LITE_MODELS, FREE_TTS_MODELS } from '../ai-rules.js';

export class AiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

let mock = null;

/* ---------------- 화면이 꺼졌다 돌아오면 다시 시도, 너무 오래 걸리면 시간 초과 ---------------- */

// 휴대폰은 화면이 꺼지거나 앱이 뒤로 가면 페이지를 멈춰, 진행 중이던 요청이 끊기거나 응답을 못 받는다.
// 숨어 있던 사이에 끊긴 요청은 화면이 돌아오면 자동으로 다시 보낸다(같은 요청이라 결과는 같다).
let hideCount = 0;
const live = new Set();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hideCount++; return; }
  for (const r of live) {
    // 숨어 있는 동안 오래 걸린 요청은 이미 끊겼을 가능성이 커서 끊고 다시 보낸다
    if (r.hid !== hideCount && Date.now() - r.started > 15000) r.ctrl.abort('resume');
  }
});
const waitVisible = () => (document.hidden
  ? new Promise((res) => {
    const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); res(); } };
    document.addEventListener('visibilitychange', on);
  })
  : Promise.resolve());

let resumeToastAt = 0;
async function postJson(body, timeoutMs) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const rec = { ctrl, started: Date.now(), hid: hideCount };
    live.add(rec);
    const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
    try {
      const token = await db.token();
      const r = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const out = await r.json().catch(() => ({}));
      return { r, out };
    } catch (e) {
      const reason = ctrl.signal.reason;
      const interrupted = rec.hid !== hideCount || document.hidden || reason === 'resume';
      if (interrupted && attempt < 2) {
        await waitVisible();
        if (Date.now() - resumeToastAt > 5000) { resumeToastAt = Date.now(); toast('화면이 꺼져 끊긴 AI 작업을 다시 시도해요'); }
        continue;
      }
      if (reason === 'timeout') {
        throw new AiError(`응답이 ${Math.round(timeoutMs / 1000)}초 넘게 오지 않아 멈췄어요(시간 초과). 연결을 확인하고 다시 눌러 주세요.`, 'timeout');
      }
      throw new AiError('인터넷 연결을 확인해 주세요. AI 기능은 연결돼 있을 때만 쓸 수 있어요.', 'offline');
    } finally {
      clearTimeout(timer);
      live.delete(rec);
    }
  }
}

// 작업별 시간 초과: 녹음·사진 분석은 길게, 짧은 작업은 짧게
function timeoutFor(body) {
  if (body.action === 'models') return 20000;
  if (body.action === 'file') return 60000;
  if (body.generationConfig?.responseModalities) return 60000; // 음성 만들기
  const heavy = (body.contents || []).some((c) => (c.parts || []).some((p) => p.inlineData || p.fileData));
  return heavy ? 120000 : 60000;
}

async function rawGemini(body) {
  if (DEMO) {
    mock = mock || await import('./mock.js');
    return mock.mockGemini(body);
  }
  const { r, out } = await postJson(body, timeoutFor(body));
  if (!r.ok) {
    const code = out.error?.status || out.error || r.status;
    const detail = out.error?.message || out.detail?.error?.message || '';
    if (code === 429 || code === 'RESOURCE_EXHAUSTED') {
      if (/limit:\s*0\b/.test(detail)) throw new AiError('이 모델은 무료 등급에서 쓸 수 없어요. 설정 > AI 모델에서 ★ 무료 모델로 바꿔 주세요.', 'quota0');
      throw new AiError('오늘(또는 지금 1분간) 무료 한도를 다 썼어요. 단어장·테스트·복습은 그대로 쓸 수 있어요. 잠시 뒤 다시 해 보세요.', 'quota');
    }
    const hints = {
      not_allowed: 'Cloudflare의 ALLOWED_EMAIL과 로그인한 이메일이 달라요.',
      not_signed_in: '로그인이 필요해요.',
      session_invalid: '로그인이 만료됐어요. 다시 로그인해 주세요.',
      server_missing_gemini_key: 'Cloudflare에 GEMINI_API_KEY가 아직 없어요.',
      server_missing_allowed_email: 'Cloudflare에 ALLOWED_EMAIL이 아직 없어요.',
    };
    if (/location is not supported/i.test(detail)) throw new AiError('Gemini가 서버 위치를 지원 지역으로 인식하지 못했어요(wrangler.jsonc의 placement 확인).', 'location');
    throw new AiError(hints[code] || `AI 오류 (${code}) ${detail}`.trim(), String(code));
  }
  return out;
}

/* ---------------- 녹음·사진은 보관함 경로로 보내기 ---------------- */

// 휴대폰은 녹음을 보관함에 한 번만 올리고, Worker가 그 파일을 Gemini 파일 저장소로 옮겨 주소(uri)를 받는다.
// 받아쓰기와 분석이 같은 주소를 함께 쓰므로 녹음을 다시 보내지 않는다. 다시 인코딩하지 않아 음질은 그대로다.
// Worker가 실패하면(보관함 업로드 대기 중 등) 예전처럼 브라우저가 직접 보낸다.
const FILE_TTL = 46 * 3600 * 1000; // Gemini 파일은 48시간 뒤 지워진다
let fileUris = store.get('gemini-files', {});
const saveUris = () => {
  const now = Date.now();
  for (const [k, v] of Object.entries(fileUris)) if (now - v.at > FILE_TTL) delete fileUris[k];
  store.set('gemini-files', fileUris);
};

async function fileUri(path, mimeType, force = false) {
  const hit = fileUris[path];
  if (!force && hit && Date.now() - hit.at < FILE_TTL) return hit.uri;
  const out = await rawGemini({ action: 'file', path, mimeType });
  fileUris[path] = { uri: out.uri, at: Date.now() };
  saveUris();
  return out.uri;
}

// media: [{mimeType, data(base64)}] 또는 [{mimeType, path, blob?}]
async function mediaParts(media, force = false) {
  const parts = [];
  let usedFile = false;
  for (const m of media) {
    if (m.data) { parts.push({ inlineData: { mimeType: m.mimeType, data: m.data } }); continue; }
    try {
      if (DEMO) throw new Error('체험 모드는 직접 보냄');
      parts.push({ fileData: { mimeType: m.mimeType, fileUri: await fileUri(m.path, m.mimeType, force) } });
      usedFile = true;
    } catch (e) {
      if (e.code === 'quota' || e.code === 'quota0') throw e;
      const blob = m.blob || await db.download(m.path);
      parts.push({ inlineData: { mimeType: m.mimeType, data: await blobToBase64(blob) } });
    }
  }
  return { parts, usedFile };
}

export const answerText = (res) => (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();

/* ---------------- 모델 고르기 (설정 행에 저장 → 기기 간 동기화) ---------------- */

let modelList = null;
export async function listModels() {
  if (modelList) return modelList;
  const { models } = await rawGemini({ action: 'models' });
  modelList = models;
  return models;
}

function pick(ids, prefs, fallback) {
  for (const re of prefs) { const hit = ids.find((id) => re.test(id)); if (hit) return hit; }
  return ids.find(fallback) || '';
}

export async function models() {
  const s = db.settings();
  if (s.models?.flash && s.models?.lite && s.models?.tts) return s.models;
  const ids = (await listModels()).map((m) => m.id);
  const m = {
    flash: s.models?.flash || pick(ids, FREE_FLASH_MODELS, (id) => /flash/.test(id) && !/lite|tts|live|image|omni|pro|embed/.test(id)),
    lite: s.models?.lite || pick(ids, FREE_LITE_MODELS, (id) => /flash-lite/.test(id) && !/tts|live|image/.test(id)),
    tts: s.models?.tts || pick(ids, FREE_TTS_MODELS, (id) => /tts/.test(id) && /flash/.test(id) && !/pro|omni/.test(id)),
  };
  if (!m.lite) m.lite = m.flash;
  if (!m.flash) throw new AiError('쓸 수 있는 Gemini 모델을 찾지 못했어요.', 'no_model');
  db.setSettings({ models: m });
  return m;
}

/* ---------------- 작업 실행 ---------------- */

const inflight = new Map();

/**
 * @param {object} o
 * @param {string} o.task      ai-rules.js TASKS의 이름
 * @param {string} o.prompt    COMMON_RULES가 붙은 프롬프트
 * @param {Array}  [o.media]   [{mimeType, data(base64)}] 또는 [{mimeType, path(보관함), blob?}] 녹음·사진
 * @param {object} o.schema    responseSchema
 * @param {function} o.check   (json) => {ok, warnings}
 * @param {string} [o.cacheKey] 같은 입력 재사용 키(없으면 매번 새로 요청)
 * @param {boolean} [o.fresh]  '다시 분석'
 */
export async function runTask({ task, prompt, media = [], schema, check, cacheKey, fresh = false }) {
  const spec = TASKS[task];
  if (!spec) throw new Error('알 수 없는 AI 작업: ' + task);
  const ms = await models();
  const model = spec.tier === 'lite' ? ms.lite : ms.flash;
  const key = cacheKey ? `${task}|${model}|${cacheKey}` : null;

  if (key && !fresh) {
    const cached = await db.aiGet(key);
    if (cached) {
      const c = check ? check(structuredClone(cached)) : { ok: true, warnings: [] };
      return { result: cached, warnings: c.warnings || [], cached: true, model };
    }
  }
  if (key && inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    let { parts: mParts, usedFile } = await mediaParts(media);
    let useSchema = true;
    let refreshed = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const generationConfig = { temperature: spec.temperature, responseMimeType: 'application/json' };
      if (useSchema && schema) generationConfig.responseSchema = schema;
      let res;
      try {
        res = await rawGemini({ model, contents: [{ role: 'user', parts: [{ text: prompt }, ...mParts] }], generationConfig, _task: task });
      } catch (e) {
        // 스키마를 받아들이지 않는 모델이면 스키마 없이 한 번 더
        if (useSchema && /schema|response_schema|responseSchema/i.test(e.message)) { useSchema = false; lastErr = e; continue; }
        // Gemini 파일이 지워졌거나 못 읽으면 한 번만 다시 옮긴다
        if (usedFile && !refreshed && /file|permission|not found|NOT_FOUND|PERMISSION_DENIED|INVALID_ARGUMENT/i.test(`${e.code} ${e.message}`)) {
          refreshed = true; attempt--;
          ({ parts: mParts, usedFile } = await mediaParts(media, true));
          continue;
        }
        throw e;
      }
      let j = null;
      try { j = JSON.parse(answerText(res)); } catch { j = null; }
      const c = j ? (check ? check(j) : { ok: true, warnings: [] }) : { ok: false, warnings: ['AI 답을 읽지 못했어요.'] };
      if (c.ok) {
        if (key) db.aiSet(key, task, j, model);
        return { result: j, warnings: c.warnings || [], cached: false, model, check: c };
      }
      lastErr = new AiError(c.warnings.join(' ') || '형식 오류', 'format');
    }
    throw new AiError((lastErr?.message || 'AI 답 형식이 맞지 않았어요.') + ' 한 번 더 눌러 주세요.', 'format');
  })();
  if (key) inflight.set(key, p);
  try { return await p; } finally { if (key) inflight.delete(key); }
}

/* ---------------- 실행 중 버튼 잠금 + 늦게 온 결과 버리기 ---------------- */

export function busy(btn, label = '분석 중…') {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('busy');
  btn.textContent = label;
  return () => { btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = old; };
}

// 요청마다 번호를 매기고, 기다리는 동안 입력이 바뀌면(번호가 바뀌면) 늦게 온 결과를 버린다.
export function latest() {
  let n = 0;
  return {
    next() { return ++n; },
    is(id) { return id === n; },
  };
}

export async function blobKey(blob, extra = '') {
  return sha256((await sha256(blob)) + '|' + extra);
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// postJson은 화면 꺼짐·시간 초과 처리를 시험할 때도 쓴다
export { rawGemini, postJson };
