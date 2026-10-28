// 듣기: Gemini TTS(기본 Kore)로 읽고, 만든 음성은 media/<uid>/tts/<sha256>.wav에 저장해 다시 쓴다.
// Gemini 한도가 끝났거나 연결이 없으면 기기 내장 일본어 음성으로 대신 읽는다.
// 모든 소리(TTS·내 녹음)는 오디오 요소 하나로 재생한다. 아이폰은 버튼을 누른 순간 unlock()이 필요하다.

import { db, DEMO } from './db.js';
import { store, sha256, toast } from './core.js';
import { models, rawGemini } from './ai.js';

export const GEMINI_VOICES = [
  ['Kore', '여성 · 또렷함'],
  ['Leda', '여성 · 부드러움'],
  ['Aoede', '여성 · 밝음'],
  ['Charon', '남성 · 차분함'],
  ['Puck', '남성 · 밝음'],
  ['Fenrir', '남성 · 힘있음'],
];

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const player = new Audio();
player.preload = 'auto';
let unlocked = false;
let playToken = 0;

export function unlock() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (unlocked && !player.paused) return;
  player.src = SILENT_WAV;
  player.play().then(() => { unlocked = true; }).catch(() => {});
}

export function stopAll() {
  playToken++;
  try { player.pause(); } catch { /* 무시 */ }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export function voiceSettings() {
  const s = db.settings();
  return {
    voice: s.voice || 'gemini:Kore',
    rate: Number(s.rate) || 1,
    interviewer: s.interviewerVoice || 'Charon',
    other: s.otherVoice || 'Leda',
  };
}

/* ---------------- 기기 음성 ---------------- */

export function deviceVoices() {
  return (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith('ja'));
}

// 음성 목록은 처음에 비어 있다가 나중에 채워지는 브라우저가 있어 잠깐 기다린다
function jaVoices() {
  const now = deviceVoices();
  if (now.length || !('speechSynthesis' in window)) return Promise.resolve(now);
  return new Promise((res) => {
    const done = () => { speechSynthesis.removeEventListener?.('voiceschanged', done); res(deviceVoices()); };
    speechSynthesis.addEventListener?.('voiceschanged', done);
    setTimeout(done, 1500);
  });
}

class NoJapaneseVoice extends Error {}

async function deviceSpeak(text, rate, pitch = 1) {
  if (!('speechSynthesis' in window)) throw new NoJapaneseVoice('이 브라우저는 기기 음성을 지원하지 않아요');
  const voices = await jaVoices();
  const saved = store.get('deviceVoice');
  const v = voices.find((x) => x.voiceURI === saved) || voices[0];
  // 일본어 음성이 없으면 한국어·영어 음성으로 읽게 되므로 읽지 않는다
  if (!v) throw new NoJapaneseVoice('이 기기에 일본어 음성이 없어요');
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.voice = v;
    u.rate = rate;
    u.pitch = pitch;
    // 일부 기기는 끝 알림(onend)이 오지 않아, 읽는 데 걸릴 만한 시간이 지나면 끝난 것으로 본다
    const guard = setTimeout(resolve, Math.max(3000, (text.length * 230) / rate) + 2500);
    u.onend = () => { clearTimeout(guard); resolve(); };
    u.onerror = (e) => { clearTimeout(guard); (e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(new Error(e.error || 'speech error'))); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/* ---------------- Gemini 음성 ---------------- */

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

const memo = new Map();     // 만든 음성 (이 기기 메모리)
const pending = new Map();  // 만드는 중인 음성 — 같은 문장을 또 요청하면 이걸 기다린다
let quotaUntil = 0;         // 무료 한도에 걸렸으면 잠시 Gemini 음성 요청을 쉰다

export async function geminiVoiceBlob(text, voiceName) {
  const { tts } = await models();
  if (!tts) throw new Error('Gemini 음성 모델이 없어요');
  const hash = await sha256(`${tts}|${voiceName}|${text}`);
  if (memo.has(hash)) return memo.get(hash);
  if (pending.has(hash)) return pending.get(hash);
  const p = makeVoice(tts, hash, text, voiceName).finally(() => pending.delete(hash));
  pending.set(hash, p);
  return p;
}

// 재생을 멈추거나 다른 단어로 넘어가도 음성 만들기는 끝까지 해서 저장한다(다음에 바로 재생)
async function makeVoice(tts, hash, text, voiceName) {
  const sub = `tts/${hash}.wav`;
  const path = db.filePath(sub);
  try {
    const cached = await db.download(path);
    if (cached?.size > 44) { memo.set(hash, cached); return cached; }
  } catch { /* 아직 없음 */ }
  if (Date.now() < quotaUntil) { const e = new Error('Gemini 음성 무료 한도'); e.code = 'quota'; throw e; }
  let res;
  try {
    res = await rawGemini({
      model: tts,
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
    });
  } catch (e) {
    if (e.code === 'quota' || e.code === 'quota0') quotaUntil = Date.now() + 60000;
    throw e;
  }
  const part = (res.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new Error('음성이 만들어지지 않았어요');
  const blob = pcmToWav(part.inlineData.data, part.inlineData.mimeType);
  memo.set(hash, blob);
  db.upload(sub, blob, 'audio/wav');
  return blob;
}

let lastNotice = { msg: '', at: 0 };
const notice = (msg) => {
  if (lastNotice.msg === msg && Date.now() - lastNotice.at < 30000) return;
  lastNotice = { msg, at: Date.now() };
  toast(msg, '', 3500);
};

// 버튼을 누른 바로 그 순간에 오디오 요소를 한 번 깨워 둔다.
// 새 목소리처럼 음성을 만드는 데 몇 초 걸리면, 휴대폰(특히 아이폰)이 '사용자가 누른 재생'으로 보지 않아
// 소리를 막을 수 있기 때문이다.
function prime() {
  if (!player.paused) return;
  try {
    player.src = SILENT_WAV;
    const p = player.play();
    if (p) p.then(() => { unlocked = true; }).catch(() => {});
  } catch { /* 무시 */ }
}

/**
 * 일본어 읽기. voice: 'gemini:이름' | 'device' | Gemini 음성 이름.
 * 재생이 끝나면 resolve. 다른 소리를 틀면 앞의 것은 멈춘다.
 */
export async function speak(text, { rate, voice, pitch } = {}) {
  if (!text) return;
  const vs = voiceSettings();
  rate = rate || vs.rate;
  let v = voice || vs.voice;
  if (!v.startsWith('gemini:') && v !== 'device') v = 'gemini:' + v;
  stopAll();
  const token = playToken;
  if (v === 'device' || DEMO) {
    try { return await deviceSpeak(text, rate, pitch); } catch (e) {
      if (e instanceof NoJapaneseVoice) { notice(`${e.message}. 설정 > 듣기에서 Gemini 음성을 골라 주세요`); return; }
      throw e;
    }
  }
  prime();
  const voiceName = v.slice(7);
  // 처음 듣는 목소리·문장은 만드는 데 몇 초 걸린다고 알려 준다
  const slow = setTimeout(() => { if (token === playToken) toast(`${voiceName} 목소리로 음성을 만드는 중…`, '', 2500); }, 800);
  let blob;
  try {
    blob = await geminiVoiceBlob(text, voiceName);
  } catch (e) {
    clearTimeout(slow);
    if (token !== playToken) return;
    console.warn(e);
    const why = e.code === 'quota' || e.code === 'quota0' ? 'Gemini 음성 무료 한도가 차서' : 'Gemini 음성을 만들지 못해';
    try {
      await deviceSpeak(text, rate, pitch);
      notice(`${why} 이 기기의 일본어 음성으로 읽었어요`);
    } catch (e2) {
      notice(e2 instanceof NoJapaneseVoice ? `${why} 읽지 못했어요(이 기기에 일본어 음성이 없어요). 잠시 뒤 다시 눌러 주세요` : `${why} 읽지 못했어요`);
    }
    return;
  }
  clearTimeout(slow);
  if (token !== playToken) return;
  try {
    return await playBlob(blob, rate, token);
  } catch (e) {
    if (token !== playToken) return;
    // 휴대폰이 재생을 막은 경우: 음성은 이미 저장됐으니 다시 누르면 바로 나온다
    if (e?.name === 'NotAllowedError') { toast('음성이 준비됐어요. 한 번 더 눌러 주세요', '', 3000); return; }
    throw e;
  }
}

// 미리 만들어 두기(면접 질문을 화면에 보여주기 전에 준비)
export async function prepare(text, voice) {
  if (DEMO || !text) return;
  const vs = voiceSettings();
  let v = voice || vs.voice;
  if (v === 'device') return;
  if (!v.startsWith('gemini:')) v = 'gemini:' + v;
  try { await geminiVoiceBlob(text, v.slice(7)); } catch { /* 재생할 때 다시 시도 */ }
}

let currentUrl = null;
export function playBlob(blob, rate = 1, token = null) {
  if (token == null) { stopAll(); token = playToken; }
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  player.src = currentUrl;
  player.playbackRate = rate;
  player.preservesPitch = true;
  return new Promise((resolve, reject) => {
    player.onended = () => resolve();
    player.onpause = () => { if (token !== playToken) resolve(); };
    player.onerror = () => reject(new Error('재생 실패'));
    player.play().catch((e) => reject(e));
  });
}

export function isPlaying() {
  return !player.paused || (window.speechSynthesis?.speaking ?? false);
}

/* ---------------- 자동 읽기(소리 켜기/끄기) ---------------- */

// 단어 테스트·단어장 카드형에서 후리가나를 공개할 때 저절로 읽어 줄지. 설정 행에 저장(기기 간 동기화).
// 끄면 저절로 읽지 않고 미리 만들지도 않는다. 스피커 버튼을 직접 누르면 그때는 읽는다.
export const autoSpeakOn = () => db.settings().autoSpeak !== false;

// 화면에 나온 단어의 음성을 미리 만들어 둔다(공개하자마자 바로 재생). 만든 음성은 보관함에 저장돼 단어장·테스트가 같이 쓴다.
export function prefetchVoice(text) {
  if (!text || DEMO || !autoSpeakOn()) return;
  const v = voiceSettings().voice;
  if (v === 'device') return;
  prepare(text, v);
}
