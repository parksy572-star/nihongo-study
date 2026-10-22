// 단어장: 목록(필터·정렬·셔플), 등록·수정(AI 초안), CSV/엑셀 일괄 등록, 한자별 단어 모음, 빠른 추가
import { h, icon, go, replace, toast, modal, field, chipToggle, store, shuffle, debounce, confirmDialog, emptyState, hasKanji } from '../core.js';
import { db } from '../db.js';
import { runTask, busy } from '../ai.js';
import { wordDraftPrompt, WORD_DRAFT_SCHEMA, checkWordDraft } from '../../ai-rules.js';
import { kataToHira, hangulKeys, rubyPlain, isKanaOnly } from '../kana.js';
import { kanjiOf, openKanji, kanjiName, kanjiData } from '../kanji.js';
import { wordList, LEVELS } from '../wordview.js';
import { startTest } from './test.js';

/* ---------------- 저장 ---------------- */

export function normalizeWord(d) {
  const furigana = kataToHira(String(d.furigana || '').trim());
  const orig = String(d.orig || '').trim();
  return {
    ...d,
    orig,
    furigana,
    meaning: String(d.meaning || '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean).join(', '),
    tags: [...new Set((Array.isArray(d.tags) ? d.tags : String(d.tags || '').split(/[,;，、\s]+/)).map((t) => t.trim()).filter(Boolean))],
    keys: hangulKeys(furigana),   // 한글 발음 키: 검색 전용, 화면에 표시하지 않음
    kanji: kanjiOf(orig),
  };
}

export function saveWord(d, id = null) {
  const prev = id ? db.get(id)?.data : null;
  return db.put('word', normalizeWord({ ...(prev || {}), ...d }), id);
}

export const allTags = () => [...new Set(db.all('word').flatMap((r) => r.data.tags || []))].sort();

/* ---------------- 목록 ---------------- */

const SORTS = [['date', '등록일'], ['level', '레벨'], ['kana', 'あいうえお순'], ['unknown', '모름 많은 순']];
const LV_ORDER = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5, 기타: 6 };

export function filteredWords(f) {
  let rows = db.all('word');
  if (f.levels?.length) rows = rows.filter((r) => f.levels.includes(r.data.level || '기타'));
  if (f.tags?.length) rows = rows.filter((r) => f.tags.every((t) => (r.data.tags || []).includes(t)));
  if (f.bookmark) rows = rows.filter((r) => r.data.bookmark);
  if (f.favorite) rows = rows.filter((r) => r.data.favorite);
  const by = {
    date: (a, b) => b.created_at.localeCompare(a.created_at),
    level: (a, b) => (LV_ORDER[a.data.level] || 9) - (LV_ORDER[b.data.level] || 9),
    kana: (a, b) => (a.data.furigana || '').localeCompare(b.data.furigana || '', 'ja'),
    unknown: (a, b) => (b.data.unknownCount || 0) - (a.data.unknownCount || 0),
  }[f.sort || 'date'];
  rows.sort(by);
  if (f.shuffle) rows = shuffle(rows);
  return rows;
}

export function wordsView(_p, _q, ctx) {
  const f = store.get('wordFilter', { levels: [], tags: [], bookmark: false, favorite: false, sort: 'date', shuffle: false });
  let rowsCache = null;
  const getRows = () => (rowsCache = filteredWords(f));
  const count = h('span', { class: 'count' });
  const filterBox = h('div', { class: 'panel stack', hidden: true });
  const save = () => { store.set('wordFilter', { ...f, shuffle: false }); };
  let list;
  const redraw = () => { list.redraw(); count.textContent = `단어 ${rowsCache.length}개${db.all('word').length !== rowsCache.length ? ` / 전체 ${db.all('word').length}` : ''}`; drawFilter(); };

  const drawFilter = () => {
    replace(filterBox,
      h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, '레벨'),
        h('div', { class: 'chips' }, LEVELS.map((lv) => chipToggle(lv, f.levels.includes(lv), (on) => { f.levels = on ? [...f.levels, lv] : f.levels.filter((x) => x !== lv); save(); redraw(); })))),
      allTags().length > 0 && h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, '태그'),
        h('div', { class: 'chips' }, allTags().map((t) => chipToggle(t, f.tags.includes(t), (on) => { f.tags = on ? [...f.tags, t] : f.tags.filter((x) => x !== t); save(); redraw(); })))),
      h('div', { class: 'chips' },
        chipToggle('북마크만', f.bookmark, (on) => { f.bookmark = on; save(); redraw(); }),
        chipToggle('즐겨찾기만', f.favorite, (on) => { f.favorite = on; save(); redraw(); })),
      h('div', { class: 'row wrap' }, h('span', { class: 'field-label' }, '정렬'),
        h('select', { onchange: (e) => { f.sort = e.target.value; save(); redraw(); } }, SORTS.map(([v, l]) => h('option', { value: v, selected: f.sort === v }, l)))));
  };

  list = wordList('words', getRows, {
    onTest: () => startTest({ ids: rowsCache.map((r) => r.id), title: testTitle(f) }),
    empty: emptyState('아직 등록한 단어가 없어요.', h('div', { class: 'row wrap' },
      h('button', { type: 'button', onclick: () => go('/words/new') }, icon('plus', 16), '단어 등록'),
      h('button', { type: 'button', class: 'ghost', onclick: () => go('/words/import') }, 'CSV·엑셀로 등록'))),
  });
  const activeFilters = () => f.levels.length + f.tags.length + (f.bookmark ? 1 : 0) + (f.favorite ? 1 : 0);
  const filterBtn = h('button', { type: 'button', class: 'icon-btn', title: '필터·정렬', onclick: () => { filterBox.hidden = !filterBox.hidden; } }, icon('filter', 20));
  const el = h('div', { class: 'stack' },
    h('div', { class: 'toolbar' }, count,
      h('button', { type: 'button', class: ['icon-btn', f.shuffle && 'on'], title: '셔플', onclick: (e) => { f.shuffle = !f.shuffle; e.currentTarget.classList.toggle('on', f.shuffle); redraw(); } }, icon('shuffle', 20)),
      filterBtn,
      h('a', { class: 'icon-btn', href: '#/search?scope=word', title: '검색' }, icon('search', 20)),
      h('button', { type: 'button', class: 'soft small', onclick: () => go('/words/new') }, icon('plus', 16), '등록'),
      h('button', { type: 'button', class: 'ghost small', onclick: () => go('/words/import') }, '일괄')),
    filterBox,
    list.el);
  getRows();
  redraw();
  if (activeFilters()) filterBox.hidden = false;
  ctx.onDb((e) => { if (e.kind === 'word' || e.type === 'reset' || (e.kind === 'settings' && e.remote)) { if (!document.querySelector('.modal-backdrop')) { getRows(); redraw(); } } });
  return { el, title: '단어장' };
}

function testTitle(f) {
  const parts = [...f.levels, ...f.tags, f.bookmark && '북마크', f.favorite && '즐겨찾기'].filter(Boolean);
  return parts.length ? parts.join(' + ') : '단어장 전체';
}

/* ---------------- 한자별 단어 모음 ---------------- */

export function kanjiWordsView({ ch }, _q, ctx) {
  const getRows = () => db.all('word').filter((r) => (r.data.orig || '').includes(ch)).sort((a, b) => (a.data.orig.length - b.data.orig.length));
  const list = wordList('kanjiWords', getRows, { empty: emptyState(`'${ch}'이(가) 들어간 단어가 아직 없어요.`) });
  const head = h('div', { class: 'panel row between wrap' },
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'kj-big', onclick: () => openKanji(ch) }, ch),
      h('div', { class: 'stack tight' }, h('b', null, kanjiName(ch) || '한자 정보 보기'), h('span', { class: 'muted small' }, `내 단어 ${getRows().length}개`))),
    h('button', { type: 'button', onclick: () => startTest({ ids: getRows().map((r) => r.id), title: `'${ch}'이 들어간 단어` }) }, icon('layers', 16), '이 단어들로 테스트'));
  ctx.onDb((e) => { if (e.kind === 'word') list.redraw(); });
  return { el: h('div', { class: 'stack' }, head, list.el), title: `${ch} 단어 모음`, back: true };
}

/* ---------------- 등록·수정 ---------------- */

function wordForm(initial = {}, { onSave, compact = false } = {}) {
  const v = { level: '', pos: '', tags: [], ...initial };
  const orig = h('input', { value: v.orig || '', lang: 'ja', placeholder: '納める', required: true });
  const furigana = h('input', { value: v.furigana || '', lang: 'ja', placeholder: 'おさめる (가타카나로 써도 히라가나로 바뀜)' });
  const meaning = h('input', { value: v.meaning || '', placeholder: '납부하다, 거두다' });
  const level = h('select', null, h('option', { value: '' }, '레벨 선택 안 함'), LEVELS.map((lv) => h('option', { value: lv, selected: v.level === lv }, lv)));
  const pos = h('input', { value: v.pos || '', placeholder: '2그룹 동사' });
  const example = h('input', { value: v.example || (v.exampleRuby ? rubyPlain(v.exampleRuby) : ''), lang: 'ja', placeholder: '税金を納める。' });
  const exampleKo = h('input', { value: v.exampleKo || '', placeholder: '세금을 납부하다.' });
  const exampleRuby = h('input', { value: v.exampleRuby || '', lang: 'ja', placeholder: '[税金|ぜいきん]を[納|おさ]める。 (자동 초안)' });
  const exampleMark = h('input', { value: v.exampleMark || '', lang: 'ja', placeholder: '예문 속 강조할 부분 (예: 納める)' });
  const tags = h('input', { value: (v.tags || []).join(', '), placeholder: '면접, 뉴스' });
  const note = h('textarea', { rows: 2, placeholder: '메모 (선택)' }, v.note || '');
  const msg = h('p', { class: 'msg' });
  furigana.addEventListener('blur', () => { furigana.value = kataToHira(furigana.value); });

  const draftBtn = h('button', { type: 'button', class: 'soft small' }, icon('refresh', 14), 'AI 초안 채우기');
  draftBtn.addEventListener('click', async () => {
    const w = orig.value.trim();
    if (!w) { toast('원문을 먼저 입력하세요', 'err'); return; }
    const done = busy(draftBtn, '초안 만드는 중…');
    try {
      const res = await runTask({ task: 'wordDraft', prompt: wordDraftPrompt(w), schema: WORD_DRAFT_SCHEMA, check: checkWordDraft, cacheKey: w });
      const j = res.result;
      if (!furigana.value) furigana.value = kataToHira(j.furigana);
      if (!meaning.value) meaning.value = j.meaning;
      if (!level.value && j.level) level.value = j.level;
      if (!pos.value) pos.value = j.pos || '';
      if (!example.value) { example.value = j.example_ja || ''; exampleKo.value = j.example_ko || ''; exampleRuby.value = j.example_ruby || ''; exampleMark.value = j.example_mark || ''; }
      msg.textContent = '초안을 채웠어요. 확인·수정한 뒤 저장하세요. (JLPT 레벨은 AI 추정)';
      msg.className = 'msg ok';
    } catch (e) { msg.textContent = e.message; msg.className = 'msg err'; } finally { done(); }
  });
  // 원문을 입력하고 칸을 벗어나면 비어 있는 칸을 자동으로 채운다
  orig.addEventListener('change', () => { if (orig.value.trim() && !furigana.value && !meaning.value && !compact) draftBtn.click(); });

  const value = () => ({
    orig: orig.value.trim(), furigana: furigana.value.trim(), meaning: meaning.value.trim(), level: level.value, pos: pos.value.trim(),
    example: example.value.trim(), exampleKo: exampleKo.value.trim(),
    exampleRuby: exampleRuby.value.trim() && rubyPlain(exampleRuby.value.trim()) === example.value.trim() ? exampleRuby.value.trim() : '',
    exampleMark: exampleMark.value.trim(), tags: tags.value, note: note.value.trim(),
  });
  const validate = () => {
    const x = value();
    if (!x.orig || !x.furigana || !x.meaning) { msg.textContent = '원문·후리가나·뜻은 꼭 입력해야 해요.'; msg.className = 'msg err'; return null; }
    if (!isKanaOnly(x.furigana)) { msg.textContent = '후리가나는 가나로만 써 주세요.'; msg.className = 'msg err'; return null; }
    return x;
  };
  const el = h('div', { class: 'stack' },
    h('div', { class: 'row', style: { alignItems: 'flex-end' } }, h('div', { class: 'grow' }, field('원문 *', orig)), draftBtn),
    field('후리가나 *', furigana), field('뜻 *', meaning, '여러 뜻은 쉼표로 구분'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('JLPT 레벨', level)), h('div', { class: 'grow' }, field('품사', pos))),
    !compact && field('예문', example), !compact && field('예문 해석', exampleKo),
    !compact && h('details', null, h('summary', { class: 'hint' }, '예문 후리가나·강조 (AI 초안이 채워요)'), h('div', { class: 'stack tight', style: { marginTop: '8px' } }, exampleRuby, exampleMark)),
    field('태그', tags, '쉼표로 구분 · 테스트 범위를 고를 때 써요'),
    !compact && field('메모', note),
    msg);
  return { el, value, validate, onSave };
}

export function wordFormView({ id }, query) {
  const r = id ? db.get(id) : null;
  if (id && !r) return { el: emptyState('단어를 찾을 수 없어요.'), title: '단어 수정', back: '/words' };
  const form = wordForm(r?.data || { orig: query.orig || '', tags: query.tag ? [query.tag] : [] });
  const save = h('button', { type: 'button' }, icon('check', 16), '저장');
  const saveNext = id ? null : h('button', { type: 'button', class: 'ghost' }, '저장하고 계속');
  const doSave = (next) => {
    const v = form.validate();
    if (!v) return;
    const dup = db.all('word').find((x) => x.id !== id && x.data.orig === v.orig && x.data.furigana === kataToHira(v.furigana));
    if (dup && !id) { toast('같은 단어가 이미 있어요', 'err'); return; }
    saveWord(v, id);
    toast(id ? '수정했어요' : '등록했어요');
    if (next) go('/words/new', { replace: true }); else go('/words');
  };
  save.addEventListener('click', () => doSave(false));
  saveNext?.addEventListener('click', () => doSave(true));
  return {
    el: h('div', { class: 'panel stack' }, form.el,
      h('div', { class: 'row end wrap' },
        id && h('button', { type: 'button', class: 'ghost danger-text', onclick: async () => { if (await confirmDialog('이 단어를 지울까요?', { danger: true, ok: '지우기' })) { db.remove(id); go('/words'); } } }, '삭제'),
        saveNext, save)),
    title: id ? '단어 수정' : '단어 등록', back: '/words',
  };
}

// 면접·작문 교정에서 탭 한 번으로 보내기
export async function quickAddWord(prefill = {}) {
  const form = wordForm(prefill, { compact: false });
  const ok = await modal({
    title: '단어장에 추가', wide: true, body: form.el,
    actions: [{ label: '취소', value: false }, { label: '저장', value: true, primary: true, onClick: () => (form.validate() ? true : false) }],
  });
  if (!ok) return;
  saveWord(form.value());
  toast('단어장에 추가했어요');
}

/* ---------------- CSV·엑셀 일괄 등록 ---------------- */

const COLS = ['원문', '후리가나', '뜻', '레벨', '품사', '예문', '해석', '태그'];
const KEYMAP = { 원문: 'orig', 후리가나: 'furigana', 뜻: 'meaning', 레벨: 'level', 품사: 'pos', 예문: 'example', 해석: 'exampleKo', 태그: 'tags' };

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

export function importView() {
  const out = h('div', { class: 'stack' });
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.xlsx,.xls' });
  const paste = h('textarea', { rows: 6, lang: 'ja', placeholder: '원문,후리가나,뜻,레벨,품사,예문,해석,태그\n継ぐ,つぐ,이어받다,N3,1그룹 동사,父の仕事を継いだ。,아버지의 일을 이어받았다.,면접' });
  const handle = (rows) => {
    if (!rows.length) { replace(out, h('p', { class: 'note err' }, '읽은 행이 없어요.')); return; }
    let header = rows[0].map((x) => String(x).trim());
    let map = header.map((x) => KEYMAP[x]);
    if (!map.some(Boolean)) { map = COLS.map((c) => KEYMAP[c]); } else rows = rows.slice(1);
    const items = rows.map((r) => {
      const d = {};
      map.forEach((k, i) => { if (k) d[k] = String(r[i] ?? '').trim(); });
      if (d.level && !LEVELS.includes(d.level.toUpperCase()) && d.level !== '기타') d.level = '';
      else if (d.level) d.level = d.level === '기타' ? '기타' : d.level.toUpperCase();
      return d;
    }).filter((d) => d.orig);
    const existing = new Set(db.all('word').map((r) => r.data.orig + '|' + r.data.furigana));
    const ready = items.filter((d) => d.furigana && d.meaning);
    const missing = items.filter((d) => !d.furigana || !d.meaning);
    const dups = ready.filter((d) => existing.has(d.orig + '|' + kataToHira(d.furigana)));
    const fresh = ready.filter((d) => !existing.has(d.orig + '|' + kataToHira(d.furigana)));
    const btn = h('button', { type: 'button', disabled: !fresh.length && !missing.length }, `등록하기 (${fresh.length}개${missing.length ? ` + AI로 채울 ${missing.length}개` : ''})`);
    const prog = h('p', { class: 'msg' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      fresh.forEach((d) => saveWord(d));
      let filled = 0;
      for (const [i, d] of missing.entries()) {
        prog.textContent = `AI 초안으로 채우는 중 ${i + 1}/${missing.length}…`;
        try {
          const res = await runTask({ task: 'wordDraft', prompt: wordDraftPrompt(d.orig), schema: WORD_DRAFT_SCHEMA, check: checkWordDraft, cacheKey: d.orig });
          const j = res.result;
          saveWord({ ...d, furigana: d.furigana || j.furigana, meaning: d.meaning || j.meaning, level: d.level || j.level, pos: d.pos || j.pos, example: d.example || j.example_ja, exampleKo: d.exampleKo || j.example_ko, exampleRuby: d.example ? '' : j.example_ruby, exampleMark: d.example ? '' : j.example_mark });
          filled++;
        } catch (e) { prog.textContent = `${d.orig}: ${e.message}`; prog.className = 'msg err'; break; }
      }
      toast(`${fresh.length + filled}개를 등록했어요`);
      go('/words');
    });
    replace(out, h('div', { class: 'panel stack' },
      h('p', null, `읽은 단어 ${items.length}개 · 새로 등록 ${fresh.length} · 이미 있음 ${dups.length} · 후리가나/뜻 빈 칸 ${missing.length}`),
      h('table', { class: 'mini-table' }, h('tr', null, h('th', null, '원문'), h('th', null, '후리가나'), h('th', null, '뜻'), h('th', null, '레벨')),
        items.slice(0, 15).map((d) => h('tr', null, h('td', { class: 'jp' }, d.orig), h('td', { class: 'jp' }, d.furigana || '—'), h('td', null, d.meaning || '—'), h('td', null, d.level || '')))),
      items.length > 15 && h('p', { class: 'hint' }, `…외 ${items.length - 15}개`),
      btn, prog));
  };
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) {
      try {
        const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
        const wb = XLSX.read(await f.arrayBuffer());
        handle(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false }));
      } catch (e) { toast('엑셀 파일을 읽지 못했어요: ' + e.message, 'err'); }
    } else handle(parseCsv(await f.text()));
  });
  return {
    el: h('div', { class: 'stack' },
      h('div', { class: 'panel stack' },
        h('p', { class: 'hint' }, `첫 줄에 열 이름(${COLS.join(', ')})을 쓰거나, 이 순서대로 쓰세요. 후리가나·뜻이 비어 있으면 AI 초안으로 채워요. 태그는 ; 로 구분해도 돼요.`),
        field('파일 (CSV·엑셀)', file),
        field('또는 붙여넣기', paste),
        h('button', { type: 'button', class: 'soft', onclick: () => handle(parseCsv(paste.value)) }, '미리 보기')),
      out),
    title: '단어 일괄 등록', back: '/words',
  };
}

