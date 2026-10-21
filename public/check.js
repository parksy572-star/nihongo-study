import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { Recorder, toWav16k, blobToBase64 } from './audio.js';
import { pronunciationPrompt, PRONUNCIATION_SCHEMA, checkPronunciation } from './ai-rules.js';

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

function msg(el, text, kind = '') {
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
}
function check(name, ok) {
  const li = document.querySelector(`[data-check="${name}"]`);
  if (!li) return;
  li.classList.toggle('pass', ok === true);
  li.classList.toggle('fail', ok === false);
}
function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone/iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return '기기';
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ---------------- 로그인 ---------------- */

let session = null;
let channel = null;

async function showView() {
  $('bootView').hidden = true;
  const signedIn = !!session;
  $('authView').hidden = signedIn;
  $('appView').hidden = !signedIn;
  $('who').hidden = !signedIn;
  if (signedIn) {
    $('whoEmail').textContent = session.user.email;
    startSync();
  } else if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }
}

let booted = false;
sb.auth.onAuthStateChange((_event, s) => {
  const changed = !booted || (s?.user?.id || null) !== (session?.user?.id || null);
  booted = true;
  session = s;
  // Supabase 권장: 이 콜백 안에서 바로 await 하지 않고 다음 틱에 처리
  if (changed) setTimeout(showView, 0);
});

const authErrors = {
  'Invalid login credentials': '이메일 또는 비밀번호가 맞지 않아요.',
  'Email not confirmed': '메일함에서 가입 확인 링크를 먼저 눌러 주세요.',
  'User already registered': '이미 가입된 이메일이에요. 로그인해 주세요.',
  'Signups not allowed for this instance': '새 가입이 막혀 있어요. 기존 계정으로 로그인해 주세요.',
};
const authText = (e) => authErrors[e?.message] || e?.message || '알 수 없는 오류';

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg($('authMsg'), '로그인 중…');
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  if (error) msg($('authMsg'), authText(error), 'err');
  else msg($('authMsg'), '');
});

$('signUp').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || password.length < 8) return msg($('authMsg'), '이메일과 8자 이상 비밀번호를 입력해 주세요.', 'err');
  msg($('authMsg'), '가입 중…');
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) return msg($('authMsg'), authText(error), 'err');
  if (!data.session) msg($('authMsg'), '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.', 'ok');
});

$('signOut').addEventListener('click', () => sb.auth.signOut());

/* ---------------- 1. 동기화 ---------------- */

const syncItems = new Map();

function renderSync(newId) {
  const list = $('syncList');
  list.textContent = '';
  const rows = [...syncItems.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);
  if (!rows.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="meta">아직 저장한 메모가 없어요.</span>';
    list.append(li);
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    if (r.id === newId) li.className = 'new';
    const text = document.createElement('span');
    text.className = 'jp';
    text.textContent = r.data?.text || '';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${r.data?.device || ''} · ${fmtTime(r.created_at)}`;
    const del = document.createElement('button');
    del.className = 'ghost small';
    del.textContent = '삭제';
    del.onclick = async () => {
      const { error } = await sb.from('items').delete().eq('id', r.id);
      if (error) return msg($('syncMsg'), '삭제 실패: ' + error.message, 'err');
      syncItems.delete(r.id);
      renderSync();
    };
    const right = document.createElement('span');
    right.style.display = 'flex';
    right.style.gap = '8px';
    right.style.alignItems = 'center';
    right.append(meta, del);
    li.append(text, right);
    list.append(li);
  }
}

async function startSync() {
  const { data, error } = await sb
    .from('items')
    .select('id, kind, data, created_at')
    .eq('kind', 'test')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    msg($('syncMsg'), '불러오기 실패: ' + error.message + ' (Supabase SQL을 실행했는지 확인해 주세요)', 'err');
    check('sync', false);
    return;
  }
  syncItems.clear();
  data.forEach((r) => syncItems.set(r.id, r));
  renderSync();
  if (data.some((r) => r.data?.device && r.data.device !== deviceLabel())) check('sync', true);

  loadRecordings();

  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel('items-test')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `user_id=eq.${session.user.id}` }, (p) => {
      if (p.eventType === 'DELETE') {
        syncItems.delete(p.old.id);
        recItems.delete(p.old.id);
        renderSync();
        renderRecordings();
        return;
      }
      if (p.new.kind === 'test-audio') {
        recItems.set(p.new.id, p.new);
        renderRecordings(p.new.id);
        if (p.new.data?.device && p.new.data.device !== deviceLabel()) {
          msg($('micMsg'), `${p.new.data.device}에서 녹음한 파일이 들어왔어요. 재생해 보세요.`, 'ok');
        }
        return;
      }
      if (p.new.kind !== 'test') return;
      syncItems.set(p.new.id, p.new);
      renderSync(p.new.id);
      if (p.new.data?.device && p.new.data.device !== deviceLabel()) {
        msg($('syncMsg'), `${p.new.data.device}에서 저장한 메모가 바로 들어왔어요. 동기화 통과!`, 'ok');
        check('sync', true);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') msg($('syncMsg'), '실시간 연결됨. 다른 기기에서도 메모를 저장해 보세요.');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') msg($('syncMsg'), '실시간 연결 실패. 새로고침해 보세요.', 'err');
    });
}

$('syncForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('syncText').value.trim();
  if (!text) return;
  const { error } = await sb.from('items').insert({ kind: 'test', data: { text, device: deviceLabel() } });
  if (error) return msg($('syncMsg'), '저장 실패: ' + error.message, 'err');
  $('syncText').value = '';
});

/* ---------------- 2. 듣기 ---------------- */

// Gemini 음성: PC·휴대폰 어디서나 같은 목소리. 한 번 만든 음성은 내 보관함에 저장해 다시 쓴다.
const GEMINI_VOICES = [
  ['Kore', '여성 · 또렷함'],
  ['Leda', '여성 · 부드러움'],
  ['Charon', '남성 · 차분함'],
  ['Puck', '남성 · 밝음'],
];
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const ttsAudio = new Audio();
ttsAudio.preload = 'auto';

function loadVoices() {
  const sel = $('ttsVoice');
  const saved = store.get('ttsVoice') || 'gemini:Kore';
  sel.textContent = '';
  const g = document.createElement('optgroup');
  g.label = 'Gemini 음성 (모든 기기 공통)';
  for (const [name, desc] of GEMINI_VOICES) {
    const o = new Option(`Gemini ${name} — ${desc}`, `gemini:${name}`);
    if (o.value === saved) o.selected = true;
    g.append(o);
  }
  sel.append(g);
  const voices = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang?.toLowerCase().startsWith('ja'));
  if (voices.length) {
    const d = document.createElement('optgroup');
    d.label = '이 기기 음성 (오프라인)';
    for (const v of voices) {
      const o = new Option(`${v.name}${v.localService ? '' : ' (온라인)'}`, v.voiceURI);
      if (v.voiceURI === saved) o.selected = true;
      d.append(o);
    }
    sel.append(d);
  }
}
loadVoices();
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = loadVoices;
$('ttsVoice').addEventListener('change', (e) => store.set('ttsVoice', e.target.value));

function deviceSpeak(text, rate) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) return reject('이 브라우저는 기기 음성을 지원하지 않아요');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = rate;
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === $('ttsVoice').value);
    if (v) u.voice = v;
    u.onend = resolve;
    u.onerror = (e) => reject(e.error || e);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

function pcmToWav(b64, mimeType) {
  const bin = atob(b64);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
  if (/wav/.test(mimeType || '')) return new Blob([pcm], { type: 'audio/wav' });
  const rate = Number((/rate=(\d+)/.exec(mimeType || '') || [])[1]) || 24000;
  const view = new DataView(new ArrayBuffer(44));
  const str = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, pcm.length, true);
  return new Blob([view, pcm], { type: 'audio/wav' });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const FREE_TTS_MODELS = [/^gemini-3\.8-flash-tts$/, /^gemini-3\.8-flash-lite-tts$/, /^gemini-3\.1-flash-tts/];
let ttsModel = store.get('ttsModel2');
async function findTtsModel() {
  if (ttsModel) return ttsModel;
  const { models } = await gemini({ action: 'models' });
  const tts = models.map((m) => m.id).filter((id) => /tts/.test(id));
  ttsModel = '';
  for (const re of FREE_TTS_MODELS) { ttsModel = tts.find((id) => re.test(id)) || ''; if (ttsModel) break; }
  if (!ttsModel) ttsModel = tts.find((id) => /flash/.test(id) && !/omni|pro/.test(id)) || tts[0];
  if (!ttsModel) throw new Error('Gemini 음성 모델을 찾지 못했어요.');
  store.set('ttsModel2', ttsModel);
  return ttsModel;
}

async function geminiVoiceBlob(text, voiceName) {
  const model = await findTtsModel();
  const path = `${session.user.id}/tts/${await sha256(`${model}|${voiceName}|${text}`)}.wav`;
  const cached = await sb.storage.from('media').download(path);
  if (!cached.error && cached.data?.size > 44) return { blob: cached.data, fromCache: true };

  const res = await gemini({
    model,
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });
  const part = (res.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new Error('음성이 만들어지지 않았어요.');
  const blob = pcmToWav(part.inlineData.data, part.inlineData.mimeType);
  sb.storage.from('media').upload(path, blob, { contentType: 'audio/wav', upsert: true });
  return { blob, fromCache: false };
}

export async function speak(text, rate = 1) {
  const choice = $('ttsVoice').value || 'gemini:Kore';
  if (!choice.startsWith('gemini:')) return deviceSpeak(text, rate);
  const { blob, fromCache } = await geminiVoiceBlob(text, choice.slice(7));
  if (ttsAudio.src.startsWith('blob:')) URL.revokeObjectURL(ttsAudio.src);
  ttsAudio.src = URL.createObjectURL(blob);
  ttsAudio.playbackRate = rate;
  await ttsAudio.play();
  await new Promise((resolve) => { ttsAudio.onended = resolve; });
  return { fromCache };
}

// 아이폰은 버튼을 누른 순간에 소리를 한 번 재생해 둬야 나중에 받은 음성도 재생된다.
function unlockAudio() {
  ttsAudio.src = SILENT_WAV;
  ttsAudio.play().catch(() => {});
}

$('ttsPlay').addEventListener('click', async () => {
  const gem = ($('ttsVoice').value || 'gemini:').startsWith('gemini:');
  if (gem) unlockAudio();
  try {
    msg($('ttsMsg'), gem ? 'Gemini 음성을 만드는 중… (처음 한 번만 몇 초 걸려요)' : '읽는 중…');
    const out = await speak($('ttsText').value, Number($('ttsRate').value));
    const note = gem ? (out?.fromCache ? ' (저장된 음성 재생)' : ' (새로 만들어 보관함에 저장)') : '';
    msg($('ttsMsg'), '소리가 잘 들렸다면 듣기 통과!' + note, 'ok');
    check('tts', true);
  } catch (err) {
    msg($('ttsMsg'), '읽기 실패: ' + (err?.message || err), 'err');
    check('tts', false);
  }
});

/* ---------------- 3. 녹음 ---------------- */

const recorder = new Recorder();
let lastWav = null;
let timerId = null;

$('micToggle').addEventListener('click', async () => {
  const btn = $('micToggle');
  if (!recorder.recording) {
    try {
      await recorder.start();
    } catch (err) {
      msg($('micMsg'), '마이크를 쓸 수 없어요. 브라우저 주소창의 마이크 권한을 허용해 주세요. (' + (err.name || err) + ')', 'err');
      check('mic', false);
      return;
    }
    btn.textContent = '■ 녹음 끝내기';
    btn.classList.add('on');
    const t0 = Date.now();
    timerId = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('micTimer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    msg($('micMsg'), '녹음 중… 문장을 읽은 뒤 끝내기를 누르세요.');
    return;
  }

  clearInterval(timerId);
  btn.textContent = '● 다시 녹음';
  btn.classList.remove('on');
  const res = await recorder.stop();
  if (!res || res.seconds < 0.5) return msg($('micMsg'), '녹음이 너무 짧아요. 다시 해 주세요.', 'err');

  micSeconds = Math.round(res.seconds * 10) / 10;
  msg($('micMsg'), '변환하고 저장하는 중…');
  try {
    lastWav = await toWav16k(res.blob);
  } catch (err) {
    msg($('micMsg'), '소리 변환 실패: ' + err, 'err');
    check('mic', false);
    return;
  }
  const audio = $('micAudio');
  audio.src = URL.createObjectURL(lastWav);
  audio.hidden = false;

  const path = `${session.user.id}/tests/${Date.now()}.wav`;
  const { error } = await sb.storage.from('media').upload(path, lastWav, { contentType: 'audio/wav' });
  if (error) {
    msg($('micMsg'), '녹음은 됐지만 보관함 저장 실패: ' + error.message, 'err');
  } else {
    const row = { kind: 'test-audio', data: { path, seconds: Math.round(res.seconds * 10) / 10, device: deviceLabel(), prompt: $('micPrompt').textContent } };
    const ins = await sb.from('items').insert(row);
    if (ins.error) msg($('micMsg'), '녹음은 저장됐지만 목록 등록 실패: ' + ins.error.message, 'err');
    else msg($('micMsg'), `녹음 ${res.seconds.toFixed(1)}초 · 저장 완료. 다른 기기 목록에도 바로 나타나요.`, 'ok');
    check('mic', true);
  }
  $('aiAudio').disabled = !$('aiModel').value;
});

const recItems = new Map();

async function loadRecordings() {
  const { data, error } = await sb
    .from('items')
    .select('id, kind, data, created_at')
    .eq('kind', 'test-audio')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) return;
  recItems.clear();
  data.forEach((r) => recItems.set(r.id, r));
  renderRecordings();
}

function renderRecordings(newId) {
  const list = $('micList');
  list.textContent = '';
  const rows = [...recItems.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  for (const r of rows) {
    const li = document.createElement('li');
    if (r.id === newId) li.className = 'new';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${r.data?.device || ''} · ${fmtTime(r.created_at)} · ${r.data?.seconds ?? '?'}초`;
    const btns = document.createElement('span');
    btns.style.display = 'flex';
    btns.style.gap = '6px';
    const play = document.createElement('button');
    play.className = 'ghost small';
    play.textContent = '▶ 재생';
    play.onclick = () => useRecording(r, true);
    const pick = document.createElement('button');
    pick.className = 'ghost small';
    pick.textContent = '분석에 쓰기';
    pick.onclick = () => useRecording(r, false);
    const del = document.createElement('button');
    del.className = 'ghost small';
    del.textContent = '삭제';
    del.onclick = async () => {
      await sb.storage.from('media').remove([r.data.path]);
      const { error } = await sb.from('items').delete().eq('id', r.id);
      if (!error) { recItems.delete(r.id); renderRecordings(); }
    };
    btns.append(play, pick, del);
    li.append(meta, btns);
    list.append(li);
  }
}

async function useRecording(r, playNow) {
  const audio = $('micAudio');
  if (playNow) { audio.src = SILENT_WAV; audio.play().catch(() => {}); }
  const { data, error } = await sb.storage.from('media').download(r.data.path);
  if (error) return msg($('micMsg'), '녹음 파일을 받지 못했어요: ' + error.message, 'err');
  lastWav = data;
  micSeconds = r.data?.seconds ?? null;
  audio.src = URL.createObjectURL(data);
  audio.hidden = false;
  if (playNow) audio.play().catch(() => {});
  $('aiAudio').disabled = !$('aiModel').value || $('aiModel').disabled;
  msg($('micMsg'), `${r.data.device}에서 녹음한 파일을 불러왔어요. 4번에서 발음 분석에 쓸 수 있어요.`, 'ok');
}

/* ---------------- 4. Gemini ---------------- */

async function gemini(body) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = out.error?.status || out.error || r.status;
    const hints = {
      429: '무료 한도에 걸렸어요. 잠시 뒤 다시 해 보세요.',
      RESOURCE_EXHAUSTED: '무료 한도에 걸렸어요. 잠시 뒤 다시 해 보세요.',
      not_allowed: 'ALLOWED_EMAIL과 로그인한 이메일이 달라요.',
      server_missing_gemini_key: 'Cloudflare에 GEMINI_API_KEY가 아직 없어요.',
      server_missing_allowed_email: 'Cloudflare에 ALLOWED_EMAIL이 아직 없어요.',
      server_missing_supabase_config: 'Cloudflare에 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY가 아직 없어요.',
      session_invalid: '로그인이 만료됐어요. 다시 로그인해 주세요.',
    };
    const detail = out.error?.message || out.detail?.error?.message || '';
    if ((code === 429 || code === 'RESOURCE_EXHAUSTED') && /limit:\s*0\b/.test(detail)) {
      throw new Error('이 모델은 무료 등급에서 쓸 수 없어요(무료 한도 0). ★ 표시된 무료 모델로 바꿔 주세요.');
    }
    if (/location is not supported/i.test(detail)) {
      throw new Error('Gemini가 서버 위치를 지원 지역으로 인식하지 못했어요. Worker 위치 설정(placement)이 적용됐는지 확인해 주세요.');
    }
    throw new Error(hints[code] || `오류 (${code}) ${detail}`);
  }
  return out;
}
const answerText = (res) => (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();

// Gemini API 가격표(ai.google.dev/gemini-api/docs/pricing)에서 무료 등급으로 표시된 글자 모델, 우선순위 순.
// Omni·Pro·Argon 계열은 무료 등급에서 '사용 불가'라 기본값에서 뺀다.
const V = '(-latest|-\\d{3})?$'; // 예: -latest, -001 같은 꼬리 허용
const FREE_TEXT_MODELS = ['gemini-3\\.8-flash', 'gemini-3\\.6-flash', 'gemini-3\\.5-flash-lite', 'gemini-3\\.1-flash-lite', 'gemini-3-flash-preview']
  .map((base) => new RegExp('^' + base + V));
const isFreeText = (id) => FREE_TEXT_MODELS.some((re) => re.test(id));

function pickDefaultModel(models, preferred) {
  const ids = models.map((m) => m.id);
  if (preferred && ids.includes(preferred)) return preferred;
  for (const re of FREE_TEXT_MODELS) {
    const hit = ids.find((id) => re.test(id));
    if (hit) return hit;
  }
  return ids.find((id) => /flash/.test(id) && !/omni|pro|lite|tts|live|image|embed/.test(id)) || ids[0] || '';
}

$('aiModels').addEventListener('click', async () => {
  msg($('aiMsg'), '모델 목록을 불러오는 중…');
  try {
    const { models, defaultModel } = await gemini({ action: 'models' });
    const sel = $('aiModel');
    sel.textContent = '';
    const usable = models.filter((m) => !/embed|aqa|imagen|veo/.test(m.id));
    const chosen = pickDefaultModel(usable, store.get('aiModel2') || defaultModel);
    const free = usable.filter((m) => isFreeText(m.id));
    const rest = usable.filter((m) => !isFreeText(m.id) && !/tts/.test(m.id));
    for (const [label, group] of [['★ 무료 등급 모델', free], ['그 밖의 모델 (무료 한도 없을 수 있음)', rest]]) {
      if (!group.length) continue;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const m of group) {
        const o = new Option(`${isFreeText(m.id) ? '★ ' : ''}${m.displayName || m.id} (${m.id})`, m.id);
        if (m.id === chosen) o.selected = true;
        og.append(o);
      }
      sel.append(og);
    }
    sel.disabled = false;
    store.set('aiModel2', sel.value);
    $('aiText').disabled = false;
    $('aiAudio').disabled = !lastWav;
    msg($('aiMsg'), `모델 ${usable.length}개 중 무료 등급 모델 ${sel.value}를 골랐어요.`, 'ok');
  } catch (err) {
    msg($('aiMsg'), err.message, 'err');
    check('ai', false);
  }
});
$('aiModel').addEventListener('change', (e) => store.set('aiModel2', e.target.value));

function showResult(pairs) {
  const out = $('aiOut');
  out.textContent = '';
  const dl = document.createElement('dl');
  for (const [k, v] of pairs) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    if (Array.isArray(v)) {
      const ul = document.createElement('ul');
      v.forEach((x) => {
        const li = document.createElement('li');
        li.textContent = typeof x === 'string' ? x : Object.values(x).join(' — ');
        ul.append(li);
      });
      dd.append(ul);
    } else {
      dd.textContent = v ?? '';
      if (/[ぁ-んァ-ン一-龯]/.test(String(v))) dd.className = 'jp';
    }
    dl.append(dt, dd);
  }
  out.append(dl);
  out.hidden = false;
}

$('aiText').addEventListener('click', async () => {
  if (aiBusy) return;
  setAiBusy(true);
  msg($('aiMsg'), 'Gemini에 물어보는 중…');
  try {
    const res = await gemini({
      model: $('aiModel').value,
      contents: [{
        role: 'user',
        parts: [{ text: '당신은 일본 패션 전문학교(문화복장학원) 입시 면접관입니다. 유학생 지원자에게 할 첫 질문 1개를 일본어 정중체로, 한 문장으로만 쓰세요. 다른 말은 쓰지 마세요.' }],
      }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
    });
    const text = answerText(res);
    if (!text) throw new Error('빈 답이 왔어요.');
    showResult([['면접관 질문(예시)', text]]);
    msg($('aiMsg'), 'Gemini 연결 통과! 질문을 눌러 들어 볼 수도 있어요.', 'ok');
    check('ai', true);
    $('aiOut').querySelector('dd').onclick = () => { unlockAudio(); speak(text).catch(() => {}); };
  } catch (err) {
    msg($('aiMsg'), err.message, 'err');
    check('ai', false);
  } finally {
    setAiBusy(false);
  }
});

/* 발음 분석 결과: 글로 보는 것과 함께 소리로 비교해 듣는다. */
function listenButton(label, play) {
  const b = document.createElement('button');
  b.className = 'ghost small';
  b.textContent = '▶ ' + label;
  b.onclick = async () => {
    if (b.disabled) return;
    unlockAudio();
    b.disabled = true;
    const old = b.textContent;
    b.textContent = '… ' + label;
    try { await play(); } catch (err) { msg($('aiMsg'), '재생 실패: ' + (err?.message || err), 'err'); }
    finally { b.disabled = false; b.textContent = old; }
  };
  return b;
}

function stopAllAudio() {
  try { ttsAudio.pause(); } catch {}
  try { $('micAudio').pause(); } catch {}
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function playMine(wav) {
  stopAllAudio();
  const a = $('micAudio');
  if (!a.src || a.dataset.blobSize !== String(wav.size)) {
    if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
    a.src = URL.createObjectURL(wav);
    a.dataset.blobSize = String(wav.size);
  }
  a.currentTime = 0;
  return a.play().then(() => new Promise((r) => { a.onended = r; }));
}

const sayJa = (text) => { stopAllAudio(); return speak(text, Number($('ttsRate').value) || 1); };

function renderPronunciation(j, chk, target, wav) {
  const out = $('aiOut');
  out.textContent = '';

  const box = document.createElement('div');
  box.className = 'listen';
  const cap = document.createElement('p');
  cap.className = 'cap';
  cap.textContent = '비교해서 듣기';
  const row = document.createElement('div');
  row.className = 'row wrap';
  row.append(
    listenButton('모범 발음', () => sayJa(target)),
    listenButton('내 녹음', () => playMine(wav)),
    listenButton('AI가 들은 대로', () => sayJa(j.transcript_kana || j.transcript)),
  );
  box.append(cap, row);
  const hint = document.createElement('p');
  hint.className = 'cap';
  hint.textContent = "'AI가 들은 대로'는 AI가 받아 적은 글자를 그대로 읽어 줘요. 모범 발음과 다르게 들리는 곳이 고칠 부분이에요.";
  box.append(hint);
  out.append(box);

  const dl = document.createElement('dl');
  const add = (k, v, jp) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v ?? ''; if (jp) dd.className = 'jp';
    dl.append(dt, dd);
  };
  add('목표 문장', target, true);
  add('들린 문장', j.transcript || '(인식된 말 없음)', true);
  add('목표 문장과 일치율', chk.score === null ? '—' : `${chk.score}%`);
  out.append(dl);

  const dt = document.createElement('dt');
  dt.textContent = '발음 지적';
  out.append(dt);
  const ul = document.createElement('ul');
  ul.className = 'issues';
  const issues = j.issues || [];
  if (!issues.length) {
    const li = document.createElement('li');
    li.textContent = '특별히 고칠 점 없음';
    ul.append(li);
  }
  for (const i of issues) {
    const li = document.createElement('li');
    const t = document.createElement('div');
    t.innerHTML = '';
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = i.type;
    const words = document.createElement('span'); words.className = 'jp';
    words.textContent = ` ${i.target} → 「${i.heard}」로 들림`;
    const tip = document.createElement('div'); tip.className = 'tip'; tip.textContent = i.tip;
    t.append(tag, words, tip);
    const b = document.createElement('div');
    b.className = 'row wrap';
    b.append(listenButton('올바른 발음', () => sayJa(i.target)), listenButton('들린 소리', () => sayJa(i.heard)));
    li.append(t, b);
    ul.append(li);
  }
  out.append(ul);

  const dl2 = document.createElement('dl');
  const add2 = (k, v) => { const a = document.createElement('dt'); a.textContent = k; const b = document.createElement('dd'); b.textContent = v ?? ''; dl2.append(a, b); };
  add2('전체 평가', j.overall);
  add2('AI 확신도', { high: '높음', medium: '보통', low: '낮음' }[j.confidence] || j.confidence);
  out.append(dl2);
  out.hidden = false;
}

// 같은 녹음을 다시 누르면 같은 결과를 보여 준다(무료 한도 절약·결과 일관성).
const analysisCache = new Map();
let aiBusy = false;
let micSeconds = null;

function setAiBusy(on) {
  aiBusy = on;
  $('aiText').disabled = on || $('aiModel').disabled;
  $('aiAudio').disabled = on || $('aiModel').disabled || !lastWav;
  $('aiModels').disabled = on;
}

$('aiAudio').addEventListener('click', async () => {
  if (aiBusy) return;
  if (!lastWav) return msg($('aiMsg'), '먼저 3번에서 녹음하거나 목록에서 "분석에 쓰기"를 눌러 주세요.', 'err');
  const target = $('micPrompt').textContent.trim();
  const targetKana = $('micPrompt').dataset.kana || '';
  const model = $('aiModel').value;
  const wav = lastWav;
  const key = `${model}|${await sha256(String(wav.size) + '|' + target)}|${wav.size}`;

  const render = (j, fromCache) => {
    const chk = checkPronunciation(j, targetKana);
    if (!chk.ok) {
      $('aiOut').hidden = true;
      return msg($('aiMsg'), chk.warnings.join(' '), 'err');
    }
    renderPronunciation(j, chk, target, wav);
    const note = chk.warnings.length ? ' 주의: ' + chk.warnings.join(' ') : '';
    msg($('aiMsg'), (fromCache ? '같은 녹음이라 이전 분석 결과를 다시 보여줘요.' : '발음 분석 완료.') + note, chk.warnings.length ? 'err' : 'ok');
    check('ai', true);
  };

  if (analysisCache.has(key)) return render(analysisCache.get(key), true);

  setAiBusy(true);
  msg($('aiMsg'), '녹음을 보내 분석하는 중… (10~30초, 끝날 때까지 기다려 주세요)');
  try {
    const b64 = await blobToBase64(wav);
    const res = await gemini({
      model,
      contents: [{ role: 'user', parts: [{ text: pronunciationPrompt(target, micSeconds) }, { inlineData: { mimeType: 'audio/wav', data: b64 } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: PRONUNCIATION_SCHEMA },
    });
    let j;
    try { j = JSON.parse(answerText(res)); } catch { j = null; }
    if (!j) throw new Error('AI 답을 읽지 못했어요. 한 번 더 눌러 주세요.');
    if (wav !== lastWav) return; // 기다리는 동안 다른 녹음으로 바뀌었으면 결과를 버린다
    analysisCache.set(key, j);
    render(j, false);
  } catch (err) {
    msg($('aiMsg'), err.message, 'err');
  } finally {
    setAiBusy(false);
  }
});
