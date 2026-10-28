// 문법 노트: '문형 하나'(문형·접속·뜻·예문) 또는 '자유 정리'(제목 + 자유로운 본문) 두 형식.
// 목록(리스트형·카드형), 등록·수정, 상세(예문 속 한자 → 한자 정보, 드래그한 글자 → 단어장), 비슷한 문법,
// 자유 정리 → AI로 문형 카드 나누기, 문법 테스트(문형 → 뜻 / 예문 빈칸, '문형 하나'만).
import { h, icon, go, replace, toast, modal, field, chipToggle, confirmDialog, emptyState, store, segmented, choiceDialog } from '../core.js';
import { db } from '../db.js';
import { furi } from '../furigana.js';
import { sayBtn } from '../analysis-ui.js';
import { viewToggle, viewMode } from '../prefs.js';
import { levelBadge, LEVELS } from '../wordview.js';
import { runTask, busy } from '../ai.js';
import { grammarSplitPrompt, GRAMMAR_SPLIT_SCHEMA, checkGrammarSplit } from '../../ai-rules.js';
import { startTest } from './test.js';

const grammars = () => db.all('grammar').sort((a, b) => b.created_at.localeCompare(a.created_at));
export const isFree = (d) => d?.format === 'free';
const firstLine = (t) => String(t || '').split('\n').map((x) => x.trim()).find(Boolean) || '';

// 예문에서 문형 부분을 강조
function exampleLine(ex, { kanjiClick = true } = {}) {
  const mark = ex.mark && ex.ja.includes(ex.mark) ? ex.mark : '';
  if (!mark) return furi(ex.ja, { cls: 'a-ja', tag: 'p', kanjiClick });
  const i = ex.ja.indexOf(mark);
  return h('p', { class: 'a-ja' }, furi(ex.ja.slice(0, i), { kanjiClick }), h('span', { class: 'mark-hl' }, furi(mark, { kanjiClick })), furi(ex.ja.slice(i + mark.length), { kanjiClick }));
}

// 자유 정리 본문: 줄마다 후리가나·한자 누르기
function freeBody(text, { kanjiClick = true, lines = 0 } = {}) {
  const all = String(text || '').split('\n');
  const shown = lines ? all.filter((x) => x.trim()).slice(0, lines) : all;
  return h('div', { class: 'free-body' }, shown.map((ln) => (ln.trim() ? furi(ln, { tag: 'p', kanjiClick }) : h('p', { class: 'blank-line' }, ' '))));
}

/* ---------------- 목록 ---------------- */

export function grammarView(_p, _q, ctx) {
  const f = store.get('grammarFilter', { level: '', tag: '' });
  let mode = viewMode('grammar');
  const box = h('div');
  const filterRow = h('div', { class: 'chips' });
  const rows = () => grammars().filter((r) => (!f.level || r.data.level === f.level) && (!f.tag || (r.data.tags || []).includes(f.tag)));
  const draw = () => {
    const list = rows();
    const tags = [...new Set(db.all('grammar').flatMap((r) => r.data.tags || []))];
    replace(filterRow,
      LEVELS.filter((lv) => db.all('grammar').some((r) => r.data.level === lv)).map((lv) => chipToggle(lv, f.level === lv, (on) => { f.level = on ? lv : ''; store.set('grammarFilter', f); draw(); })),
      tags.map((t) => chipToggle(t, f.tag === t, (on) => { f.tag = on ? t : ''; store.set('grammarFilter', f); draw(); })));
    if (!list.length) { replace(box, emptyState(db.all('grammar').length ? '조건에 맞는 문법이 없어요.' : '공부한 문법을 문형 하나씩, 또는 자유롭게 정리해 보세요.', h('button', { type: 'button', onclick: addGrammar }, icon('plus', 16), '문법 추가'))); return; }
    replace(box, mode === 'list'
      ? h('div', { class: 'list' }, list.map((r) => h('div', { class: 'item link', onclick: () => go('/grammar/' + r.id) },
        levelBadge(r.data.level),
        isFree(r.data)
          ? h('div', { class: 'item-main' }, h('span', { class: 'item-title' }, r.data.title || '자유 정리', ' ', h('span', { class: 'tag gray' }, '자유 정리')), h('span', { class: 'item-sub jp' }, firstLine(r.data.body)))
          : h('div', { class: 'item-main' }, h('span', { class: 'item-title jp' }, r.data.pattern), h('span', { class: 'item-sub' }, r.data.meaning)),
        icon('right', 18))))
      : h('div', { class: 'cards' }, list.map((r) => (isFree(r.data)
        ? h('div', { class: 'card link', onclick: () => go('/grammar/' + r.id) },
          h('div', { class: 'row between' }, h('b', null, r.data.title || '자유 정리'), h('div', { class: 'row' }, h('span', { class: 'tag gray' }, '자유 정리'), levelBadge(r.data.level))),
          freeBody(r.data.body, { kanjiClick: false, lines: 4 }))
        : h('div', { class: 'card link', onclick: () => go('/grammar/' + r.id) },
          h('div', { class: 'row between' }, h('b', { class: 'jp', style: { fontSize: '1.2em' } }, r.data.pattern), levelBadge(r.data.level)),
          r.data.connection && h('p', { class: 'muted small' }, '접속: ', r.data.connection),
          h('p', null, r.data.meaning),
          r.data.examples?.[0] && exampleLine(r.data.examples[0], { kanjiClick: false }),
          r.data.examples?.[0]?.ko && h('p', { class: 'a-ko' }, r.data.examples[0].ko))))));
  };
  draw();
  ctx.onDb((e) => { if (e.kind === 'grammar' || e.type === 'reset') draw(); });
  return {
    el: h('div', { class: 'stack' },
      h('div', { class: 'toolbar' }, h('span', { class: 'count' }, `문법 ${db.all('grammar').length}개`),
        h('button', { type: 'button', class: 'plain small', onclick: () => startGrammarTest(rows()) }, icon('layers', 16), '문법 테스트'),
        h('button', { type: 'button', class: 'soft small', onclick: addGrammar }, icon('plus', 16), '추가')),
      filterRow, box,
      h('div', { class: 'bottom-bar' }, viewToggle('grammar', (m) => { mode = m; draw(); }), h('span'))),
    title: '문법 노트',
  };
}

async function addGrammar() {
  const v = await choiceDialog('어떤 형식으로 정리할까요?', [
    { label: '문형 하나 — 문형·접속·뜻·예문 (문법 테스트에 나와요)', value: 'pattern', icon: 'note' },
    { label: '자유 정리 — 여러 문형을 한 번에 자유롭게', value: 'free', icon: 'edit' },
  ]);
  if (v === 'pattern') go('/grammar/new');
  if (v === 'free') go('/grammar/new?type=free');
}

/* ---------------- 문법 테스트 (지금 보이는 '문형 하나'들로) ---------------- */

async function startGrammarTest(rows) {
  const patterns = rows.filter((r) => !isFree(r.data) && r.data.pattern);
  if (!patterns.length) { toast('문법 테스트는 \'문형 하나\'로 저장한 문법만 나와요. 먼저 문형을 추가해 주세요.', 'err', 4000); return; }
  const blanks = [];
  patterns.forEach((r) => (r.data.examples || []).forEach((ex, i) => { if (ex.mark && ex.ja?.includes(ex.mark)) blanks.push(`gb:${r.id}:${i}`); }));
  let mode = store.get('grammarTestMode', 'meaning');
  const ok = await modal({
    title: '문법 테스트',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, `지금 목록의 문형 ${patterns.length}개 · 빈칸 문제로 쓸 예문 ${blanks.length}개`),
      segmented([['meaning', '문형 → 뜻'], ['blank', '예문 빈칸']], mode, (v) => { mode = v; }),
      h('p', { class: 'hint' }, '문형 → 뜻: 문형을 보고, 누를 때마다 접속 → 뜻·예문이 열려요. 예문 빈칸: 예문의 문형 부분을 맞혀요(예문에 \'강조할 문형 부분\'을 적은 것만).')),
    actions: [{ label: '취소', value: false }, { label: '다음', value: true, primary: true }],
  });
  if (!ok) return;
  store.set('grammarTestMode', mode);
  if (mode === 'blank') {
    if (!blanks.length) { toast('빈칸 문제로 쓸 예문이 없어요. 예문에 \'강조할 문형 부분\'을 적어 주세요.', 'err', 4000); return; }
    startTest({ ids: blanks, title: '문법 · 예문 빈칸', type: 'grammar' });
  } else {
    startTest({ ids: patterns.map((r) => 'g:' + r.id), title: '문법 · 문형 → 뜻', type: 'grammar' });
  }
}

/* ---------------- 상세 ---------------- */

export function grammarDetailView({ id }, _q, ctx) {
  const el = h('div', { class: 'stack' });
  const addBtn = h('button', { type: 'button', class: 'fab', style: { position: 'fixed', zIndex: 30, display: 'none' } }, icon('plus', 16), '단어장에 추가');
  let selected = '';
  addBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  addBtn.addEventListener('click', async () => {
    const t = selected;
    addBtn.style.display = 'none';
    (await import('./words.js')).quickAddWord({ orig: t, tags: ['문법 예문'] });
  });
  document.body.append(addBtn);
  const onSel = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !el.contains(s.anchorNode)) { addBtn.style.display = 'none'; return; }
    // 루비 읽기(rt)는 빼고 원문만
    const frag = s.getRangeAt(0).cloneContents();
    frag.querySelectorAll('rt').forEach((x) => x.remove());
    const t = frag.textContent.replace(/\s/g, '');
    if (!t || t.length > 20 || !/[぀-ヿ㐀-鿿]/.test(t)) { addBtn.style.display = 'none'; return; }
    selected = t;
    const r = s.getRangeAt(0).getBoundingClientRect();
    addBtn.style.display = 'inline-flex';
    addBtn.style.left = Math.min(window.innerWidth - 150, Math.max(8, r.left)) + 'px';
    addBtn.style.top = Math.max(60, r.top - 52) + 'px';
  };
  document.addEventListener('selectionchange', onSel);

  const draw = () => {
    const r = db.get(id);
    if (!r) { replace(el, emptyState('문법을 찾을 수 없어요.')); return; }
    const d = r.data;
    if (isFree(d)) {
      const splitBtn = h('button', { type: 'button', class: 'soft small' }, icon('layers', 14), 'AI로 문형 카드 나누기');
      splitBtn.addEventListener('click', () => splitFree(r, splitBtn));
      const made = db.all('grammar').filter((g) => g.data.sourceId === id);
      replace(el,
        h('div', { class: 'panel stack' },
          h('div', { class: 'row between' }, h('h2', null, d.title || '자유 정리'), h('div', { class: 'row' }, levelBadge(d.level),
            h('button', { type: 'button', class: 'icon-btn', title: '수정', onclick: () => go('/grammar/edit/' + id) }, icon('edit', 18)))),
          h('div', { class: 'chips' }, h('span', { class: 'tag gray' }, '자유 정리'), (d.tags || []).map((t) => h('span', { class: 'tag gray' }, t)))),
        h('div', { class: 'panel stack' },
          h('h3', { class: 'muted small' }, '한자를 누르면 한자 정보, 글자를 끌어 선택하면 단어장에 추가'),
          freeBody(d.body)),
        h('div', { class: 'panel stack' },
          h('p', { class: 'hint' }, '노트에 적힌 문형을 AI가 찾아 \'문형 하나\' 카드로 나눠요. 나눈 카드는 문법 테스트에 나와요. 고른 것만 저장해요.'),
          h('div', { class: 'row wrap' }, splitBtn),
          made.length > 0 && h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, `이 노트에서 만든 문형 ${made.length}개`),
            h('div', { class: 'chips' }, made.map((g) => h('button', { type: 'button', class: 'chip', onclick: () => go('/grammar/' + g.id) }, g.data.pattern))))));
      return;
    }
    const similar = (d.similar || []).map((s) => ({ ...s, row: db.get(s.id) })).filter((s) => s.row);
    const src = d.sourceId ? db.get(d.sourceId) : null;
    replace(el,
      h('div', { class: 'panel stack' },
        h('div', { class: 'row between' }, h('h2', { class: 'jp', style: { fontSize: '1.4em' } }, d.pattern), h('div', { class: 'row' }, levelBadge(d.level),
          h('button', { type: 'button', class: 'icon-btn', title: '수정', onclick: () => go('/grammar/edit/' + id) }, icon('edit', 18)))),
        d.connection && h('p', null, h('b', { class: 'muted small' }, '접속 '), furi(d.connection)),
        h('p', { style: { fontSize: '1.08em' } }, d.meaning),
        (d.tags || []).length > 0 && h('div', { class: 'chips' }, d.tags.map((t) => h('span', { class: 'tag gray' }, t))),
        src && h('button', { type: 'button', class: 'ghost small', style: { justifySelf: 'start' }, onclick: () => go('/grammar/' + src.id) }, '자유 정리에서 만든 카드: ', src.data.title || '노트 보기')),
      d.note && h('div', { class: 'panel' }, h('h3', { class: 'muted small' }, '설명'), h('p', { class: 'pre' }, d.note)),
      (d.examples || []).length > 0 && h('div', { class: 'panel stack' },
        h('h3', { class: 'muted small' }, '예문 · 한자를 누르면 한자 정보, 글자를 끌어 선택하면 단어장에 추가'),
        ...(d.examples || []).map((ex) => h('div', { class: 'stack tight', style: { paddingBottom: '8px', borderBottom: '1px solid var(--line)' } },
          exampleLine(ex), ex.ko && h('p', { class: 'a-ko' }, ex.ko), h('div', { class: 'listen-row' }, sayBtn('듣기', ex.ja))))),
      similar.length > 0 && h('div', { class: 'panel stack' }, h('h3', { class: 'muted small' }, '비슷한 문법'),
        ...similar.map((s) => h('div', { class: 'item link', style: { cursor: 'pointer' }, onclick: () => go('/grammar/' + s.id) },
          h('div', { class: 'item-main' }, h('span', { class: 'item-title jp' }, s.row.data.pattern), h('span', { class: 'item-sub' }, s.diff || s.row.data.meaning))))));
  };
  draw();
  ctx.onDb((e) => { if (e.kind === 'grammar') draw(); });
  return { el, title: '문법', back: '/grammar', cleanup: () => { document.removeEventListener('selectionchange', onSel); addBtn.remove(); } };
}

// 자유 정리 → AI가 찾은 문형을 미리 보고, 고른 것만 '문형 하나'로 저장
async function splitFree(r, btn) {
  const d = r.data;
  if (!String(d.body || '').trim()) { toast('본문이 비어 있어요', 'err'); return; }
  const done = busy(btn, '문형 찾는 중…');
  let items;
  try {
    const res = await runTask({ task: 'grammarSplit', prompt: grammarSplitPrompt(d.title, d.body), schema: GRAMMAR_SPLIT_SCHEMA, check: checkGrammarSplit, cacheKey: `${r.id}|${d.title}|${d.body}` });
    items = structuredClone(res.result.items || []);
  } catch (e) { toast(e.message, 'err', 5000); return; } finally { done(); }
  if (!items.length) { toast('노트에서 문형을 찾지 못했어요', 'err'); return; }
  const existing = new Set(db.all('grammar').filter((g) => !isFree(g.data)).map((g) => g.data.pattern));
  const checks = items.map((it) => {
    const dup = existing.has(it.pattern);
    const cb = h('input', { type: 'checkbox', checked: !dup });
    return { it, cb, el: h('label', { class: 'check', style: { alignItems: 'flex-start' } }, cb,
      h('span', { class: 'stack tight' },
        h('b', { class: 'jp' }, it.pattern, dup ? h('span', { class: 'tag warn', style: { marginLeft: '6px' } }, '이미 있음') : null),
        h('span', { class: 'small' }, it.meaning || ''),
        it.connection && h('span', { class: 'muted small' }, '접속: ', it.connection),
        h('span', { class: 'muted small' }, `예문 ${it.examples.length}개`))) };
  });
  const ok = await modal({
    title: `찾은 문형 ${items.length}개`, wide: true,
    body: h('div', { class: 'stack' }, h('p', { class: 'hint' }, '저장할 문형을 고르세요. 저장한 뒤에도 하나씩 고칠 수 있어요.'), ...checks.map((c) => c.el)),
    actions: [{ label: '취소', value: false }, { label: '고른 문형 저장', value: true, primary: true }],
  });
  if (!ok) return;
  const pick = checks.filter((c) => c.cb.checked).map((c) => c.it);
  pick.forEach((it) => db.put('grammar', {
    pattern: it.pattern, connection: it.connection || '', meaning: it.meaning || '', note: it.note || '',
    level: it.level || d.level || '', tags: d.tags || [], examples: it.examples || [], similar: [], sourceId: r.id,
  }));
  toast(`문형 ${pick.length}개를 저장했어요`);
}

/* ---------------- 등록·수정 ---------------- */

function grammarForm(v = {}) {
  const pattern = h('input', { value: v.pattern || '', lang: 'ja', placeholder: '〜わけにはいかない' });
  const connection = h('input', { value: v.connection || '', placeholder: '동사 사전형 / 동사 ない형 + わけにはいかない' });
  const meaning = h('input', { value: v.meaning || '', placeholder: '~할 수는 없다(사정상)' });
  const note = h('textarea', { rows: 4, placeholder: '내 말로 적는 설명' }, v.note || '');
  const level = h('select', null, h('option', { value: '' }, '레벨 없음'), LEVELS.map((lv) => h('option', { value: lv, selected: v.level === lv }, lv)));
  const tags = h('input', { value: (v.tags || []).join(', '), placeholder: '의무·금지' });
  const exBox = h('div', { class: 'stack tight' });
  const examples = (v.examples || []).map((x) => ({ ...x }));
  const drawEx = () => replace(exBox, examples.map((ex, i) => {
    const ja = h('input', { value: ex.ja || '', lang: 'ja', placeholder: '예문' });
    const ko = h('input', { value: ex.ko || '', placeholder: '해석' });
    const mark = h('input', { value: ex.mark || '', lang: 'ja', placeholder: '강조할 문형 부분 (예: わけにはいかない) — 빈칸 테스트에 쓰여요' });
    ja.oninput = () => { ex.ja = ja.value; }; ko.oninput = () => { ex.ko = ko.value; }; mark.oninput = () => { ex.mark = mark.value; };
    return h('div', { class: 'panel soft stack tight' }, ja, ko, mark,
      h('button', { type: 'button', class: 'ghost small', onclick: () => { examples.splice(i, 1); drawEx(); } }, '예문 빼기'));
  }), h('button', { type: 'button', class: 'plain small', onclick: () => { examples.push({ ja: '', ko: '', mark: '' }); drawEx(); } }, icon('plus', 14), '예문 추가'));
  if (!examples.length) examples.push({ ja: '', ko: '', mark: '' });
  drawEx();
  const others = grammars().filter((r) => !isFree(r.data) && r.data.pattern !== v.pattern);
  const similar = (v.similar || []).map((s) => ({ ...s }));
  const simBox = h('div', { class: 'stack tight' });
  const drawSim = () => replace(simBox, similar.map((s, i) => {
    const sel = h('select', { onchange: (e) => { s.id = e.target.value; } }, h('option', { value: '' }, '문법 선택'), others.map((r) => h('option', { value: r.id, selected: r.id === s.id }, r.data.pattern)));
    const diff = h('input', { value: s.diff || '', placeholder: '차이점 메모' });
    diff.oninput = () => { s.diff = diff.value; };
    return h('div', { class: 'row wrap' }, sel, diff, h('button', { type: 'button', class: 'icon-btn', onclick: () => { similar.splice(i, 1); drawSim(); } }, icon('close', 16)));
  }), others.length > 0 && h('button', { type: 'button', class: 'plain small', onclick: () => { similar.push({ id: '', diff: '' }); drawSim(); } }, icon('plus', 14), '비슷한 문법 연결'));
  drawSim();
  return {
    el: h('div', { class: 'stack' }, field('문형 *', pattern), field('접속', connection), field('뜻 *', meaning),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('JLPT 레벨', level)), h('div', { class: 'grow' }, field('태그', tags))),
      field('설명', note), h('span', { class: 'field-label' }, '예문'), exBox, h('span', { class: 'field-label' }, '비슷한 문법'), simBox),
    value: () => ({
      ...(v.sourceId ? { sourceId: v.sourceId } : {}),
      pattern: pattern.value.trim(), connection: connection.value.trim(), meaning: meaning.value.trim(), note: note.value, level: level.value,
      tags: tags.value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean),
      examples: examples.filter((x) => x.ja?.trim()).map((x) => ({ ja: x.ja.trim(), ko: (x.ko || '').trim(), mark: (x.mark || '').trim() })),
      similar: similar.filter((s) => s.id),
    }),
    valid: (x) => !!(x.pattern && x.meaning),
    error: '문형과 뜻은 꼭 입력해 주세요',
  };
}

// 자유 정리: 제목 + 자유로운 본문(여러 문형 비교·묶음 정리 등)
function freeForm(v = {}) {
  const title = h('input', { value: v.title || '', placeholder: '예: 의무·금지 표현 정리' });
  const body = h('textarea', { rows: 14, lang: 'ja', placeholder: '여러 문형을 자유롭게 정리하세요.\n예)\n〜わけにはいかない: ~할 수는 없다 (도덕적·사회적 이유)\n  約束したから、行かないわけにはいかない。\n〜ざるを得ない: ~하지 않을 수 없다 (어쩔 수 없이)' }, v.body || '');
  const level = h('select', null, h('option', { value: '' }, '레벨 없음'), LEVELS.map((lv) => h('option', { value: lv, selected: v.level === lv }, lv)));
  const tags = h('input', { value: (v.tags || []).join(', '), placeholder: '의무·금지' });
  return {
    el: h('div', { class: 'stack' }, field('제목', title), field('본문', body, '일본어에는 보기 화면에서 후리가나가 붙고, 한자를 누르면 한자 정보가 열려요.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('JLPT 레벨', level)), h('div', { class: 'grow' }, field('태그', tags)))),
    value: () => ({
      format: 'free', title: title.value.trim(), body: body.value, level: level.value,
      tags: tags.value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean),
    }),
    valid: (x) => !!(x.title || x.body.trim()),
    error: '제목이나 본문을 입력해 주세요',
  };
}

export function grammarFormView({ id }, query = {}) {
  const r = id ? db.get(id) : null;
  const free = r ? isFree(r.data) : query.type === 'free';
  const form = free ? freeForm(r?.data || {}) : grammarForm(r?.data || {});
  const save = () => {
    const v = form.value();
    if (!form.valid(v)) { toast(form.error, 'err'); return; }
    const row = db.put('grammar', v, id);
    toast('저장했어요');
    go('/grammar/' + row.id, { replace: true });
  };
  return {
    el: h('div', { class: 'panel stack' }, form.el, h('div', { class: 'row end' },
      id && h('button', { type: 'button', class: 'ghost danger-text', onclick: async () => { if (await confirmDialog('이 문법을 지울까요?', { danger: true, ok: '지우기' })) { db.remove(id); go('/grammar'); } } }, '삭제'),
      h('button', { type: 'button', onclick: save }, icon('check', 16), '저장'))),
    title: id ? (free ? '자유 정리 수정' : '문법 수정') : (free ? '자유 정리 추가' : '문법 추가'), back: id ? '/grammar/' + id : '/grammar',
  };
}

export async function quickAddGrammar(prefill = {}) {
  const form = grammarForm({ pattern: prefill.pattern, note: prefill.note, tags: prefill.tags });
  const ok = await modal({ title: '문법 노트에 추가', wide: true, body: form.el, actions: [{ label: '취소', value: false }, { label: '저장', value: true, primary: true, onClick: () => { if (!form.valid(form.value())) { toast('문형과 뜻을 입력해 주세요', 'err'); return false; } return true; } }] });
  if (!ok) return;
  db.put('grammar', form.value());
  toast('문법 노트에 추가했어요');
}
