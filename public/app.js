import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { Recorder, toWav16k, blobToBase64 } from './audio.js';

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

  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel('items-test')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `user_id=eq.${session.user.id}` }, (p) => {
      if (p.eventType === 'DELETE') {
        syncItems.delete(p.old.id);
        renderSync();
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

function loadVoices() {
  const sel = $('ttsVoice');
  const voices = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang?.toLowerCase().startsWith('ja'));
  sel.textContent = '';
  if (!voices.length) {
    sel.append(new Option('일본어 음성을 찾는 중…', ''));
    return;
  }
  const saved = store.get('ttsVoice');
  for (const v of voices) {
    const o = new Option(`${v.name}${v.localService ? '' : ' (온라인)'}`, v.voiceURI);
    if (v.voiceURI === saved) o.selected = true;
    sel.append(o);
  }
  msg($('ttsMsg'), `일본어 음성 ${voices.length}개를 찾았어요.`);
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
} else {
  msg($('ttsMsg'), '이 브라우저는 음성 읽기를 지원하지 않아요.', 'err');
  check('tts', false);
}
$('ttsVoice').addEventListener('change', (e) => store.set('ttsVoice', e.target.value));

export function speak(text, rate = 1) {
  return new Promise((resolve, reject) => {
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

$('ttsPlay').addEventListener('click', async () => {
  try {
    msg($('ttsMsg'), '읽는 중…');
    await speak($('ttsText').value, Number($('ttsRate').value));
    msg($('ttsMsg'), '소리가 잘 들렸다면 듣기 통과!', 'ok');
    check('tts', true);
  } catch (err) {
    msg($('ttsMsg'), '읽기 실패: ' + err, 'err');
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
    msg($('micMsg'), `녹음 ${res.seconds.toFixed(1)}초 · 보관함 저장 완료. 재생해서 들어 보세요.`, 'ok');
    check('mic', true);
  }
  $('aiAudio').disabled = !$('aiModel').value;
});

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
    throw new Error(hints[code] || `오류 (${code}) ${out.error?.message || out.detail?.error?.message || ''}`);
  }
  return out;
}
const answerText = (res) => (res.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();

function pickDefaultModel(models, preferred) {
  const ids = models.map((m) => m.id);
  if (preferred && ids.includes(preferred)) return preferred;
  const flash = ids.filter((id) => /flash/.test(id) && !/lite|tts|live|image|embed|preview/.test(id));
  return flash.sort().reverse()[0] || ids[0] || '';
}

$('aiModels').addEventListener('click', async () => {
  msg($('aiMsg'), '모델 목록을 불러오는 중…');
  try {
    const { models, defaultModel } = await gemini({ action: 'models' });
    const sel = $('aiModel');
    sel.textContent = '';
    const usable = models.filter((m) => !/embed|aqa|imagen|veo/.test(m.id));
    const chosen = pickDefaultModel(usable, store.get('aiModel') || defaultModel);
    for (const m of usable) {
      const o = new Option(`${m.displayName || m.id} (${m.id})`, m.id);
      if (m.id === chosen) o.selected = true;
      sel.append(o);
    }
    sel.disabled = false;
    store.set('aiModel', sel.value);
    $('aiText').disabled = false;
    $('aiAudio').disabled = !lastWav;
    msg($('aiMsg'), `모델 ${usable.length}개를 불러왔어요. 기본으로 ${sel.value}를 골랐어요.`, 'ok');
  } catch (err) {
    msg($('aiMsg'), err.message, 'err');
    check('ai', false);
  }
});
$('aiModel').addEventListener('change', (e) => store.set('aiModel', e.target.value));

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
    $('aiOut').querySelector('dd').onclick = () => speak(text);
  } catch (err) {
    msg($('aiMsg'), err.message, 'err');
    check('ai', false);
  }
});

$('aiAudio').addEventListener('click', async () => {
  if (!lastWav) return msg($('aiMsg'), '먼저 3번에서 녹음해 주세요.', 'err');
  msg($('aiMsg'), '녹음을 보내 분석하는 중… (10~30초)');
  try {
    const b64 = await blobToBase64(lastWav);
    const target = $('micPrompt').textContent;
    const prompt = [
      '당신은 한국인 학습자를 돕는 일본어 발음 코치입니다.',
      `학습자는 다음 문장을 소리 내어 읽었습니다: 「${target}」`,
      '녹음을 듣고 아래 JSON 형식으로만 답하세요. 설명 문장은 한국어로 쓰세요.',
      '{"transcript": "들린 그대로의 일본어", "translation": "한국어 해석",',
      ' "issues": [{"word": "단어", "heard": "어떻게 들렸는지", "tip": "고치는 방법"}],',
      ' "overall": "전체 평가 한두 문장(장음·촉음·ん·억양·속도 중심)"}',
      '문제가 없으면 issues는 빈 배열로 두세요.',
    ].join('\n');
    const res = await gemini({
      model: $('aiModel').value,
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'audio/wav', data: b64 } }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    });
    const raw = answerText(res);
    let j;
    try { j = JSON.parse(raw); } catch { j = { overall: raw }; }
    showResult([
      ['들린 문장', j.transcript],
      ['해석', j.translation],
      ['발음 지적', (j.issues || []).map((i) => `${i.word}: ${i.heard} → ${i.tip}`)],
      ['전체 평가', j.overall],
    ]);
    msg($('aiMsg'), '발음 분석까지 됐어요. 0단계의 Gemini 확인 끝!', 'ok');
    check('ai', true);
  } catch (err) {
    msg($('aiMsg'), err.message, 'err');
  }
});
