// 문법 노트: 목록(리스트형·카드형), 등록·수정, 상세(예문 속 한자 → 한자 정보, 드래그한 글자 → 단어장), 비슷한 문법, 빈칸 복습
import { h, icon, go, replace, toast, modal, field, chipToggle, confirmDialog, emptyState, mmss, store } from '../core.js';
import { db } from '../db.js';
import { furi } from '../furigana.js';
import { sayBtn } from '../analysis-ui.js';
import { viewToggle, viewMode, streakSetting } from '../prefs.js';
import { levelBadge, LEVELS } from '../wordview.js';
import { RoundDeck } from '../deck.js';
import { speak } from '../tts.js';

const grammars = () => db.all('grammar').sort((a, b) => b.created_at.localeCompare(a.created_at));

// 예문에서 문형 부분을 강조
function exampleLine(ex, { kanjiClick = true } = {}) {
  const mark = ex.mark && ex.ja.includes(ex.mark) ? ex.mark : '';
  if (!mark) return furi(ex.ja, { cls: 'a-ja', tag: 'p', kanjiClick });
  const i = ex.ja.indexOf(mark);
  return h('p', { class: 'a-ja' }, furi(ex.ja.slice(0, i), { kanjiClick }), h('span', { class: 'mark-hl' }, furi(mark, { kanjiClick })), furi(ex.ja.slice(i + mark.length), { kanjiClick }));
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
    if (!list.length) { replace(box, emptyState(db.all('grammar').length ? '조건에 맞는 문법이 없어요.' : '공부한 문법을 문형 단위로 정리해 보세요.', h('button', { type: 'button', onclick: () => go('/grammar/new') }, icon('plus', 16), '문법 추가'))); return; }
    replace(box, mode === 'list'
      ? h('div', { class: 'list' }, list.map((r) => h('div', { class: 'item link', onclick: () => go('/grammar/' + r.id) },
        levelBadge(r.data.level),
        h('div', { class: 'item-main' }, h('span', { class: 'item-title jp' }, r.data.pattern), h('span', { class: 'item-sub' }, r.data.meaning)),
        icon('right', 18))))
      : h('div', { class: 'cards' }, list.map((r) => h('div', { class: 'card link', onclick: () => go('/grammar/' + r.id) },
        h('div', { class: 'row between' }, h('b', { class: 'jp', style: { fontSize: '1.2em' } }, r.data.pattern), levelBadge(r.data.level)),
        r.data.connection && h('p', { class: 'muted small' }, '접속: ', r.data.connection),
        h('p', null, r.data.meaning),
        r.data.examples?.[0] && exampleLine(r.data.examples[0], { kanjiClick: false }),
        r.data.examples?.[0]?.ko && h('p', { class: 'a-ko' }, r.data.examples[0].ko)))));
  };
  draw();
  ctx.onDb((e) => { if (e.kind === 'grammar' || e.type === 'reset') draw(); });
  return {
    el: h('div', { class: 'stack' },
      h('div', { class: 'toolbar' }, h('span', { class: 'count' }, `문법 ${db.all('grammar').length}개`),
        h('button', { type: 'button', class: 'plain small', onclick: () => go('/grammar/review') }, icon('layers', 16), '빈칸 복습'),
        h('button', { type: 'button', class: 'soft small', onclick: () => go('/grammar/new') }, icon('plus', 16), '추가')),
      filterRow, box,
      h('div', { class: 'bottom-bar' }, viewToggle('grammar', (m) => { mode = m; draw(); }), h('span'))),
    title: '문법 노트',
  };
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
    if (!t || t.length > 20 || !/[\u3040-\u30ff\u3400-\u9fff]/.test(t)) { addBtn.style.display = 'none'; return; }
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
    const similar = (d.similar || []).map((s) => ({ ...s, row: db.get(s.id) })).filter((s) => s.row);
    replace(el,
      h('div', { class: 'panel stack' },
        h('div', { class: 'row between' }, h('h2', { class: 'jp', style: { fontSize: '1.4em' } }, d.pattern), h('div', { class: 'row' }, levelBadge(d.level),
          h('button', { type: 'button', class: 'icon-btn', title: '수정', onclick: () => go('/grammar/edit/' + id) }, icon('edit', 18)))),
        d.connection && h('p', null, h('b', { class: 'muted small' }, '접속 '), furi(d.connection)),
        h('p', { style: { fontSize: '1.08em' } }, d.meaning),
        (d.tags || []).length > 0 && h('div', { class: 'chips' }, d.tags.map((t) => h('span', { class: 'tag gray' }, t)))),
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
    const mark = h('input', { value: ex.mark || '', lang: 'ja', placeholder: '강조할 문형 부분 (예: わけにはいかない)' });
    ja.oninput = () => { ex.ja = ja.value; }; ko.oninput = () => { ex.ko = ko.value; }; mark.oninput = () => { ex.mark = mark.value; };
    return h('div', { class: 'panel soft stack tight' }, ja, ko, mark,
      h('button', { type: 'button', class: 'ghost small', onclick: () => { examples.splice(i, 1); drawEx(); } }, '예문 빼기'));
  }), h('button', { type: 'button', class: 'plain small', onclick: () => { examples.push({ ja: '', ko: '', mark: '' }); drawEx(); } }, icon('plus', 14), '예문 추가'));
  if (!examples.length) examples.push({ ja: '', ko: '', mark: '' });
  drawEx();
  const others = grammars().filter((r) => r.data.pattern !== v.pattern);
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
      pattern: pattern.value.trim(), connection: connection.value.trim(), meaning: meaning.value.trim(), note: note.value, level: level.value,
      tags: tags.value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean),
      examples: examples.filter((x) => x.ja?.trim()).map((x) => ({ ja: x.ja.trim(), ko: (x.ko || '').trim(), mark: (x.mark || '').trim() })),
      similar: similar.filter((s) => s.id),
    }),
  };
}

export function grammarFormView({ id }) {
  const r = id ? db.get(id) : null;
  const form = grammarForm(r?.data || {});
  const save = () => {
    const v = form.value();
    if (!v.pattern || !v.meaning) { toast('문형과 뜻은 꼭 입력해 주세요', 'err'); return; }
    const row = db.put('grammar', v, id);
    toast('저장했어요');
    go('/grammar/' + row.id, { replace: true });
  };
  return {
    el: h('div', { class: 'panel stack' }, form.el, h('div', { class: 'row end' },
      id && h('button', { type: 'button', class: 'ghost danger-text', onclick: async () => { if (await confirmDialog('이 문법을 지울까요?', { danger: true, ok: '지우기' })) { db.remove(id); go('/grammar'); } } }, '삭제'),
      h('button', { type: 'button', onclick: save }, icon('check', 16), '저장'))),
    title: id ? '문법 수정' : '문법 추가', back: id ? '/grammar/' + id : '/grammar',
  };
}

export async function quickAddGrammar(prefill = {}) {
  const form = grammarForm({ pattern: prefill.pattern, note: prefill.note, tags: prefill.tags });
  const ok = await modal({ title: '문법 노트에 추가', wide: true, body: form.el, actions: [{ label: '취소', value: false }, { label: '저장', value: true, primary: true, onClick: () => { const v = form.value(); if (!v.pattern || !v.meaning) { toast('문형과 뜻을 입력해 주세요', 'err'); return false; } return true; } }] });
  if (!ok) return;
  db.put('grammar', form.value());
  toast('문법 노트에 추가했어요');
}

/* ---------------- 빈칸 복습 ---------------- */

export function grammarReviewView() {
  const cards = [];
  for (const r of db.all('grammar')) {
    (r.data.examples || []).forEach((ex, i) => {
      const mark = ex.mark && ex.ja.includes(ex.mark) ? ex.mark : '';
      if (mark) cards.push({ id: `${r.id}:${i}`, r, ex, mark });
    });
  }
  const el = h('div', { class: 'stack' });
  if (!cards.length) { el.append(emptyState('예문에 \'강조할 문형 부분\'을 적은 문법이 있어야 빈칸 복습을 할 수 있어요.')); return { el, title: '문법 빈칸 복습', back: '/grammar' }; }
  const byId = new Map(cards.map((c) => [c.id, c]));
  const deck = new RoundDeck({ ids: cards.map((c) => c.id), streak: streakSetting() });
  const t0 = Date.now();
  let revealed = false;
  const draw = () => {
    if (deck.finished) {
      replace(el, h('div', { class: 'panel stack' }, h('h2', null, '복습 완료'),
        h('div', { class: 'stat' }, h('div', null, h('b', null, deck.state.total), h('span', null, '예문')), h('div', null, h('b', null, deck.state.round), h('span', null, '판')), h('div', null, h('b', null, mmss((Date.now() - t0) / 1000)), h('span', null, '시간'))),
        h('button', { type: 'button', onclick: () => go('/grammar') }, '문법 노트로')));
      db.put('log', { type: 'grammar-review', total: deck.state.total, rounds: deck.state.round, seconds: (Date.now() - t0) / 1000, missed: deck.state.missed });
      return;
    }
    const c = byId.get(deck.current());
    const p = deck.progress();
    revealed = false;
    const i = c.ex.ja.indexOf(c.mark);
    const body = h('div', { class: 'tcard', style: { position: 'relative', minHeight: '260px', cursor: 'pointer' } });
    const paint = () => replace(body, h('div', { class: 't-body' },
      h('p', { class: 'a-ja', style: { fontSize: '1.3em' } }, furi(c.ex.ja.slice(0, i)),
        revealed ? h('span', { class: 'mark-hl' }, c.mark) : h('span', { style: { borderBottom: '2px solid var(--accent)', padding: '0 1em' } }, '＿＿'),
        furi(c.ex.ja.slice(i + c.mark.length))),
      h('p', { class: 'a-ko' }, c.ex.ko || ''),
      revealed && h('p', { class: 'muted small' }, c.r.data.pattern, ' · ', c.r.data.meaning)));
    paint();
    body.addEventListener('click', () => { revealed = !revealed; paint(); if (revealed) speak(c.ex.ja).catch(() => {}); });
    replace(el,
      h('div', { class: 'row between' }, h('span', { class: 'muted small' }, `${p.round}판`), h('b', null, `${p.known} / ${p.total}`), h('span')),
      body,
      h('div', { class: 'test-controls' },
        h('button', { type: 'button', class: 'big-round no', onclick: () => { deck.answer(false); draw(); } }, icon('left', 28)),
        h('button', { type: 'button', class: 'round', onclick: () => { if (deck.undo()) draw(); } }, icon('undo', 20)),
        h('button', { type: 'button', class: 'big-round yes', onclick: () => { deck.answer(true); draw(); } }, icon('right', 28))));
  };
  const onKey = (e) => { if (e.key === 'ArrowRight') { deck.answer(true); draw(); } else if (e.key === 'ArrowLeft') { deck.answer(false); draw(); } else if (e.key === ' ') { e.preventDefault(); el.querySelector('.tcard')?.click(); } };
  document.addEventListener('keydown', onKey);
  draw();
  return { el, title: '문법 빈칸 복습', back: '/grammar', immersive: true, cleanup: () => document.removeEventListener('keydown', onKey) };
}
