// 모든 한자 위에 히라가나 후리가나 (설정 > 후리가나에서 켜고 끔)
// furi(text)는 먼저 글자만 보여 주고, 읽기가 준비되면 <ruby>로 바꾼다.
// 읽기는 Gemini(Flash-Lite)로 문장 묶음 단위로 만들고, 문장마다 ai 행에 저장해 어느 기기에서든 다시 쓴다.
// 단어장의 '가리기'·단어 테스트처럼 읽기를 맞히는 곳에는 쓰지 않는다(정답이 미리 보이지 않게).

import { h, sha256, store, bus, hasKanji, debounce } from './core.js';
import { db } from './db.js';
import { runTask } from './ai.js';
import { furiganaPrompt, FURIGANA_SCHEMA, checkFurigana } from '../ai-rules.js';
import { parseRuby } from './kana.js';

const mem = new Map();          // text → ruby 표기
const waiting = new Map();      // text → Set<element>
let local = store.get('furi-cache', {});
const saveLocal = debounce(() => {
  const keys = Object.keys(local);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete local[k];
  store.set('furi-cache', local);
}, 1500);

export const furiganaOn = () => db.settings().furigana !== false;

export function rubyNodes(markup) {
  return parseRuby(markup).map((x) => (x.r ? h('ruby', null, x.t, h('rt', null, x.r)) : x.t));
}

function paint(el) {
  const text = el.dataset.text;
  const ruby = furiganaOn() ? mem.get(text) : null;
  el.replaceChildren(...(ruby ? rubyNodes(ruby) : [text]));
}

/** 일본어 글에 후리가나를 붙인 요소 */
export function furi(text, { cls = '', tag = 'span' } = {}) {
  text = String(text ?? '');
  const el = h(tag, { class: ['jp-auto', cls], lang: 'ja', dataset: { text } }, text);
  if (!hasKanji(text)) return el;
  if (mem.has(text)) { paint(el); return el; }
  if (!furiganaOn()) return el;
  if (!waiting.has(text)) waiting.set(text, new Set());
  waiting.get(text).add(el);
  flushSoon();
  return el;
}

const flushSoon = debounce(() => flush(), 60);
let running = false;

async function flush() {
  if (running || !waiting.size) return;
  running = true;
  try {
    const texts = [...waiting.keys()];
    const hashes = await Promise.all(texts.map((t) => sha256('furi|' + t)));
    const need = [];
    texts.forEach((t, i) => { if (local[hashes[i]]) mem.set(t, local[hashes[i]]); else need.push(i); });
    if (need.length) {
      const got = await db.aiGetMany(need.map((i) => 'furigana|' + hashes[i]));
      for (const i of need) { const r = got['furigana|' + hashes[i]]; if (r) { mem.set(texts[i], r); local[hashes[i]] = r; } }
    }
    const todo = texts.map((t, i) => [t, hashes[i]]).filter(([t]) => !mem.has(t));
    for (let k = 0; k < todo.length; k += 30) {
      const chunk = todo.slice(k, k + 30);
      const list = chunk.map(([t]) => t);
      try {
        const res = await runTask({ task: 'furigana', prompt: furiganaPrompt(list), schema: FURIGANA_SCHEMA, check: (j) => checkFurigana(j, list) });
        const j = structuredClone(res.result);
        checkFurigana(j, list);
        chunk.forEach(([t, hs], i) => {
          const r = j.valid[i];
          if (!r) return;
          mem.set(t, r); local[hs] = r;
          db.aiSet('furigana|' + hs, 'furigana', r, res.model);
        });
      } catch (e) {
        console.warn('후리가나를 만들지 못했어요', e);
        break; // 한도 초과·오프라인이면 글자만 보여 준다
      }
    }
    saveLocal();
    for (const [t, els] of waiting) {
      if (mem.has(t)) for (const el of els) if (el.isConnected) paint(el);
    }
    waiting.clear();
  } finally {
    running = false;
    if (waiting.size) flushSoon();
  }
}

// 설정을 바꾸면 화면의 모든 후리가나를 다시 그린다
bus.on('db', (e) => {
  if (e.kind !== 'settings') return;
  for (const el of document.querySelectorAll('.jp-auto')) {
    const t = el.dataset.text;
    if (furiganaOn() && hasKanji(t) && !mem.has(t)) { if (!waiting.has(t)) waiting.set(t, new Set()); waiting.get(t).add(el); flushSoon(); }
    paint(el);
  }
});
