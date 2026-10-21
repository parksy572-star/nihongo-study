// 녹음 도구: 마이크 녹음 → 16kHz 모노 WAV로 변환 (Gemini가 확실히 읽는 형식)

export function pickRecorderMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

export class Recorder {
  constructor() {
    this.stream = null;
    this.rec = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    const mimeType = pickRecorderMime();
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data && e.data.size && this.chunks.push(e.data);
    this.rec.start();
    this.startedAt = performance.now();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(null);
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
        const seconds = (performance.now() - this.startedAt) / 1000;
        this.stream.getTracks().forEach((t) => t.stop());
        this.rec = null;
        resolve({ blob, seconds });
      };
      this.rec.stop();
    });
  }

  get recording() {
    return !!this.rec && this.rec.state === 'recording';
  }
}

export async function toWav16k(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const decoded = await new Promise((res, rej) => ctx.decodeAudioData(buf.slice(0), res, rej));
  ctx.close?.();

  const rate = 16000;
  const length = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, length, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return encodeWav(rendered.getChannelData(0), rate);
}

function encodeWav(samples, rate) {
  const bytes = 44 + samples.length * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// 녹음에 말소리가 있는지 기기에서 먼저 본다(16kHz 모노 WAV 기준).
// 20ms 단위로 소리 크기를 재서, 조용한 바탕보다 확실히 큰 구간의 비율을 돌려준다.
export async function speechLevel(wav) {
  const buf = await wav.arrayBuffer();
  const view = new DataView(buf);
  const rate = view.getUint32(24, true) || 16000;
  const n = Math.floor((buf.byteLength - 44) / 2);
  const frame = Math.max(1, Math.round(rate * 0.02));
  const levels = [];
  for (let i = 0; i + frame <= n; i += frame) {
    let sum = 0;
    for (let j = 0; j < frame; j++) {
      const s = view.getInt16(44 + (i + j) * 2, true) / 32768;
      sum += s * s;
    }
    levels.push(Math.sqrt(sum / frame));
  }
  if (!levels.length) return { seconds: 0, voiced: 0, peak: 0, silent: true };
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const peak = sorted[sorted.length - 1];
  const threshold = Math.max(0.012, floor * 3);
  const voiced = levels.filter((l) => l > threshold).length / levels.length;
  return { seconds: n / rate, voiced, peak, silent: peak < 0.02 || voiced < 0.03 };
}
