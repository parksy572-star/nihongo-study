// 검색: 검색창 하나로 원문·후리가나·뜻·한글 발음(보이지 않는 키)·한자 훈음을 모두 찾는다.
// 입력 종류 자동 판별, 부분 일치, 완전 → 앞부분 → 중간 순서, 일본어 IME 변환 중에는 기다렸다가 확정 후 검색.

import { h, icon, go, replace, segmented, debounce, hasKanji, hasHangul, isKanjiChar, fmtDate } from '../core.js';
import { db } from '../db.js';
import { kataToHira, isKanaOnly, isRomaji, romajiToHira, hangulMatch } from '../kana.js';
import { wordList } from '../wordview.js';
import { startTest } from './test.js';
import { openKanji, kanjiData, myKanji } from '../kanji.js';
import { furi } from '../furigana.js';

const SCOPES = [['all', '전체'], ['word', '단어'], ['kanji', '한자'], ['grammar', '문법'], ['talk', '회화·면접'], ['writing', '작문']];
const rank = (text, q) => { if (!text) return 0; if (text === q) return 3; if (text.startsWith(q)) return 2; if (text.includes(q)) return 1; return 0; };
const rankList = (s, q) => Math.max(0, ...String(s || '').split(/[,，、]\s*/).map((x) => rank(x.trim(), q)), rank(String(s || '').replace(/\s/g, ''), q));

export async function searchWords(raw) {
  let q = raw.trim().replace(/\s+/g, ' ');
  const out = { orig: [], sound: [], meaning: [], hun: [] };
  if (!q) return out;
  const words = db.all('word');
  const pushRanked = (arr, r, score) => { if (score) arr.push({ r, score }); };
  if (hasKanji(q)) {
    for (const r of words) pushRanked(out.orig, r, rank(r.data.orig, q));
  } else if (isKanaOnly(q) || isRomaji(q)) {
    const kana = isRomaji(q) ? kataToHira(await romajiToHira(q.toLowerCase())) : kataToHira(q).replace(/\s/g, '');
    for (const r of words) pushRanked(out.orig, r, Math.max(rank(r.data.furigana, kana), rank(kataToHira(r.data.orig), kana)));
  } else if (hasHangul(q)) {
    const qq = q.replace(/\s/g, '');
    for (const r of words) {
      const m = hangulMatch(qq, r.data.keys);
      pushRanked(out.sound, r, m === 'exact' ? 3 : m === 'prefix' ? 2 : m ? 1 : 0);
      pushRanked(out.meaning, r, rankList(r.data.meaning, qq));
    }
    // 한자 훈음: '들일 납' → 納 → 納이 들어간 단어
    const chars = db.all('kanji').filter((k) => k.data.hun && (k.data.hun.replace(/\s/g, '').includes(qq) || k.data.hun.includes(q))).map((k) => k.data.char);
    for (const r of words) if (chars.some((c) => r.data.orig.includes(c))) out.hun.push({ r, score: 1 });
  }
  for (const k of Object.keys(out)) out[k] = out[k].sort((a, b) => b.score - a.score || a.r.data.orig.length - b.r.data.orig.length).map((x) => x.r);
  return out;
}

export function searchView(_p, query, ctx) {
  let scope = query.scope || 'all';
  const input = h('input', { type: 'search', class: 'search-input', placeholder: '納める · おさめる · 오사메루 · 납부 · 들일 납', value: query.q || '', autocomplete: 'off', enterkeyhint: 'search' });
  const recentBox = h('div', { class: 'recent' });
  const results = h('div', { class: 'stack' });
  let composing = false;
  let seq = 0;

  const recents = () => db.settings().recentSearches || [];
  const remember = debounce((q) => {
    if (!q.trim()) return;
    db.setSettings({ recentSearches: [q.trim(), ...recents().filter((x) => x !== q.trim())].slice(0, 10) });
  }, 1500);
  const drawRecent = () => replace(recentBox, recents().map((q) => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = q; run(); } }, q)));

  const run = async () => {
    const q = input.value.trim();
    const my = ++seq;
    history.replaceState(null, '', `#/search?${new URLSearchParams({ q, scope })}`);
    if (!q) { replace(results); drawRecent(); recentBox.hidden = false; return; }
    recentBox.hidden = true;
    remember(q);
    const parts = [];
    const want = (s) => scope === 'all' || scope === s;
    if (want('word')) {
      const w = await searchWords(q);
      if (my !== seq) return;
      const groups = hasHangul(q) ? [['발음 일치', w.sound], ['뜻 일치', w.meaning], ['한자 훈음 일치', w.hun]] : [['단어', w.orig]];
      const seen = new Set();
      for (const [label, rows] of groups) {
        const uniq = rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
        if (!uniq.length) continue;
        const list = wordList('search', () => uniq, { bar: !parts.some((p) => p.dataset.words), onTest: () => startTest({ ids: [...seen], title: `검색: ${q}` }) });
        parts.push(h('div', { class: 'stack tight', dataset: { words: '1' } }, h('h3', { class: 'group-title' }, `${label} ${uniq.length}`), list.el));
      }
    }
    if (want('kanji')) {
      const chars = new Set([...q].filter(isKanjiChar));
      for (const k of db.all('kanji')) if ((k.data.hun || '').includes(q) || (k.data.memo || '').includes(q)) chars.add(k.data.char);
      if (isKanaOnly(q)) {
        const kana = kataToHira(q);
        const mine = [...new Set(db.all('word').flatMap((r) => r.data.kanji || []))].slice(0, 400);
        for (const c of mine) {
          const d = await kanjiData(c);
          if (d && [...(d.on || []), ...(d.kun || [])].some((r) => kataToHira(r.replace(/[.-]/g, '')) === kana)) chars.add(c);
        }
      }
      if (my !== seq) return;
      if (chars.size) parts.push(h('div', { class: 'stack tight' }, h('h3', { class: 'group-title' }, `한자 ${chars.size}`),
        h('div', { class: 'parts' }, [...chars].map((c) => h('button', { type: 'button', class: 'part', onclick: () => openKanji(c) }, h('span', { class: 'pc' }, c), h('span', { class: 'pn' }, myKanji(c)?.data?.hun || '보기'))))));
    }
    const textHit = (s) => String(s || '').includes(q) || kataToHira(String(s || '')).includes(kataToHira(q));
    if (want('grammar')) {
      const g = db.all('grammar').filter((r) => [r.data.pattern, r.data.meaning, r.data.note, r.data.connection, ...(r.data.examples || []).flatMap((e) => [e.ja, e.ko])].some(textHit));
      if (g.length) parts.push(h('div', { class: 'stack tight' }, h('h3', { class: 'group-title' }, `문법 ${g.length}`),
        h('div', { class: 'list' }, g.map((r) => h('div', { class: 'item link', onclick: () => go('/grammar/' + r.id) }, h('div', { class: 'item-main' }, h('span', { class: 'item-title jp' }, r.data.pattern), h('span', { class: 'item-sub' }, r.data.meaning)))))));
    }
    if (want('talk')) {
      const hits = [];
      for (const r of db.all('session')) for (const t of r.data.turns || []) {
        const a = t.attempts?.[t.attempts.length - 1];
        if ([t.question_ja, a?.answer, a?.analysis?.refined_ja, a?.analysis?.question_ko, a?.analysis?.answer_ko].some(textHit)) hits.push({ r, t });
      }
      if (hits.length) parts.push(h('div', { class: 'stack tight' }, h('h3', { class: 'group-title' }, `회화·면접 ${hits.length}`),
        h('div', { class: 'list' }, hits.slice(0, 50).map(({ r, t }) => h('div', { class: 'item link', onclick: () => go('/talk/session/' + r.id) },
          h('div', { class: 'item-main' }, furi(t.question_ja, { cls: 'item-title' }), h('span', { class: 'item-sub' }, `${r.data.title} · ${fmtDate(r.data.startedAt || r.created_at)}`)))))));
    }
    if (want('writing')) {
      const w = db.all('writing').filter((r) => [r.data.question?.ja, r.data.question?.ko, r.data.text, r.data.analysis?.corrected_ja, r.data.analysis?.answer_ko].some(textHit));
      if (w.length) parts.push(h('div', { class: 'stack tight' }, h('h3', { class: 'group-title' }, `작문 ${w.length}`),
        h('div', { class: 'list' }, w.map((r) => h('div', { class: 'item link', onclick: () => go('/writing/' + r.id) },
          h('div', { class: 'item-main' }, h('span', { class: 'item-title jp' }, (r.data.question?.ja || '').slice(0, 40)), h('span', { class: 'item-sub' }, fmtDate(r.data.savedAt || r.created_at))))))));
    }
    if (my !== seq) return;
    replace(results, parts.length ? parts : h('p', { class: 'empty' }, `'${q}'에 맞는 결과가 없어요.`));
  };
  const runSoon = debounce(run, 180);
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; runSoon(); });
  // 한글 입력은 글자마다 바로, 일본어 IME는 확정 후 검색
  input.addEventListener('input', (e) => { if (composing && !hasHangul(input.value)) return; if (e.isComposing && !hasHangul(input.value)) return; runSoon(); });
  setTimeout(() => input.focus(), 60);
  drawRecent();
  if (input.value) run();
  ctx.onDb((e) => { if (e.remote && ['word', 'grammar', 'kanji'].includes(e.kind)) runSoon(); });
  const tabs = segmented(SCOPES, scope, (v) => { scope = v; run(); }, { small: true });
  return {
    el: h('div', { class: 'stack' },
      h('div', { class: 'search-box' }, h('div', { class: 'row' }, input, h('button', { type: 'button', class: 'icon-btn', title: '지우기', onclick: () => { input.value = ''; run(); input.focus(); } }, icon('close', 18))),
        h('div', { style: { overflowX: 'auto' } }, tabs), recentBox),
      results),
    title: '검색', back: true,
  };
}
