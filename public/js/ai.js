// Gemini 호출: 브라우저는 /api/gemini(Cloudflare Worker)로만 부른다.
// - 작업별 모델 등급(Flash / Flash-Lite)과 무작위성은 ai-rules.js의 TASKS를 따른다.
// - 응답은 responseSchema로 고정하고, 형식이 깨지면 한 번만 다시 요청한다.
// - 같은 입력은 db.aiGet(key)로 저장된 결과를 어느 기기에서든 다시 보여준다.

import { db, DEMO } from './db.js';
import { sha256 } from './core.js';
import { TASKS, FREE_FLASH_MODELS, FREE_LITE_MODELS, FREE_TTS_MODELS } from '../ai-rules.js';

export class AiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

let mock = null;
async function rawGemini(body) {
  if (DEMO) {
    mock = mock || await import('./mock.js');
    return mock.mockGemini(body);
  }
  const token = await db.token();
  let r;
  try {
    r = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AiError('인터넷 연결을 확인해 주세요. AI 기능은 연결돼 있을 때만 쓸 수 있어요.', 'offline');
  }
  const out = await r.json().catch(() => ({}));
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
 * @param {Array}  [o.media]   [{mimeType, data(base64)}] 녹음·사진
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
    const parts = [{ text: prompt }, ...media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } }))];
    let useSchema = true;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const generationConfig = { temperature: spec.temperature, responseMimeType: 'application/json' };
      if (useSchema && schema) generationConfig.responseSchema = schema;
      let res;
      try {
        res = await rawGemini({ model, contents: [{ role: 'user', parts }], generationConfig, _task: task });
      } catch (e) {
        // 스키마를 받아들이지 않는 모델이면 스키마 없이 한 번 더
        if (useSchema && /schema|response_schema|responseSchema/i.test(e.message)) { useSchema = false; lastErr = e; continue; }
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

export { rawGemini };
