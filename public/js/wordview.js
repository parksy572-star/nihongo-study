// 단어 보기 부품: 리스트형·카드형, 3단계 가리기(후리가나 → 뜻 → 숨김), 한자 클릭, 길게 누르기 메뉴
// 단어장·한자별 단어 모음·검색 결과가 함께 쓴다.

import { h, icon, go, longPress, copyText, choiceDialog, confirmDialog, isKanjiChar, toast, replace } from './core.js';
import { db } from './db.js';
import { speak } from './tts.js';
import { openKanji } from './kanji.js';
import { alignFurigana, parseRuby } from './kana.js';
import { furi, rubyNodes } from './furigana.js';
import { viewToggle, viewMode } from './prefs.js';

export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1', '기타'];
export const levelBadge = (lv) => (lv ? h('span', { class: ['lv', lv === '기타' ? 'etc' : lv] }, lv) : null);

const hideDefault = (mode) => {
  const s = db.settings();
  return mode === 'card' ? s.hideCard !== false : s.hideList === true;
};

// 원문: 한자는 눌러서 한자 정보, 후리가나는 위치 설정(단어 전체 위 / 한자 위에만)
export function wordOrig(orig, furigana, showFuri, clickable = true) {
  const kanjiSpan = (txt) => (clickable ? [...txt].map((c) => (isKanjiChar(c) ? h('span', { class: 'k', onclick: (e) => { e.stopPropagation(); openKanji(c); } }, c) : c)) : txt);
  const mode = db.settings().furiganaPos || 'whole';
  if (!furigana) return h('span', null, kanjiSpan(orig));
  if (mode === 'kanji') {
    return h('span', null, alignFurigana(orig, furigana).map((seg) => (seg.r
      ? h('ruby', { class: showFuri ? '' : 'hide-rt' }, kanjiSpan(seg.t), h('rt', null, seg.r))
      : kanjiSpan(seg.t))));
  }
  return h('ruby', { class: showFuri ? '' : 'hide-rt' }, kanjiSpan(orig), h('rt', null, furigana));
}

// 글 속 한자 한 글자씩 눌러서 한자 정보 창
export const kanjiSpans = (txt) => [...String(txt || '')].map((c) => (isKanjiChar(c)
  ? h('span', { class: 'k', onclick: (e) => { e.stopPropagation(); openKanji(c); } }, c)
  : c));

// 예문: 루비 표기가 있으면 그것으로, 없으면 자동 후리가나. 단어 활용 부분은 강조색. 한자는 눌러서 한자 정보.
export function exampleNode(d, showFuri) {
  if (!d.example) return null;
  const mark = d.exampleMark || '';
  if (showFuri) {
    if (d.exampleRuby) return h('span', null, markRuby(d.exampleRuby, mark));
    return furi(d.example, { kanjiClick: true });
  }
  if (mark && d.example.includes(mark)) {
    const i = d.example.indexOf(mark);
    return h('span', null, kanjiSpans(d.example.slice(0, i)), h('span', { class: 'mark-hl' }, kanjiSpans(mark)), kanjiSpans(d.example.slice(i + mark.length)));
  }
  return h('span', null, kanjiSpans(d.example));
}
function markRuby(markup, mark) {
  const segs = parseRuby(markup);
  const plain = segs.map((s) => s.t).join('');
  const start = mark ? plain.indexOf(mark) : -1;
  const end = start + mark.length;
  let pos = 0;
  return segs.map((s) => {
    const inMark = start >= 0 && pos < end && pos + s.t.length > start;
    pos += s.t.length;
    const node = s.r ? h('ruby', null, kanjiSpans(s.t), h('rt', null, s.r)) : h('span', null, kanjiSpans(s.t));
    return inMark ? h('span', { class: 'mark-hl' }, node) : node;
  });
}

export async function wordMenu(r) {
  const v = await choiceDialog(r.data.orig, [
    { label: '수정', value: 'edit', icon: 'edit' },
    { label: r.data.bookmark ? '북마크 해제' : '북마크', value: 'bm', icon: 'bookmark' },
    { label: '삭제', value: 'del', icon: 'trash', danger: true },
  ]);
  if (v === 'edit') go('/words/edit/' + r.id);
  if (v === 'bm') db.patch(r.id, { bookmark: !r.data.bookmark });
  if (v === 'del' && await confirmDialog(`'${r.data.orig}'을(를) 지울까요?`, { danger: true, ok: '지우기' })) { db.remove(r.id); toast('지웠어요'); }
}

// 즐겨찾기·북마크 켜고 끄기. 켜지면 아이콘이 채워진다(.toggle.on).
const toggleBtn = (r, field, ic, label) => {
  let on = !!db.get(r.id)?.data?.[field];
  const b = h('button', { type: 'button', class: ['icon-btn', 'sm', 'toggle', field === 'favorite' && 'fav', on ? 'on' : 'muted'], title: label, 'aria-label': label, 'aria-pressed': String(on) }, icon(ic, 18));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    on = !on;
    db.patch(r.id, { [field]: on });
    b.classList.toggle('on', on);
    b.classList.toggle('muted', !on);
    b.setAttribute('aria-pressed', String(on));
  });
  return b;
};
export const speakBtn = (text, label = '듣기') => h('button', { type: 'button', class: 'icon-btn sm muted', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); speak(text); } }, icon('speaker', 18));
export const copyBtn = (text) => h('button', { type: 'button', class: 'icon-btn sm muted', title: '복사', 'aria-label': '복사', onclick: (e) => { e.stopPropagation(); copyText(text); } }, icon('copy', 16));
// 가운데 글자 + 오른쪽 끝 버튼(복사·듣기). 버튼이 글자 가운데 정렬에 영향을 주지 않는다.
export const centerLine = (content, ...tools) => h('div', { class: 'line' }, content, h('span', { class: 'line-tools' }, ...tools));

/* ---------------- 리스트형 한 줄 ---------------- */

export function wordRow(r, hide) {
  const d = r.data;
  let step = hide ? 0 : 2; // 0 숨김, 1 후리가나, 2 뜻까지
  const el = h('div', { class: 'w-row' });
  const draw = () => {
    replace(el,
      levelBadge(d.level),
      h('span', { class: 'w-orig' }, d.orig ? wordOrigPlain(d.orig) : ''),
      h('span', { class: 'w-side' },
        h('span', { class: ['w-furi', step < 1 && 'veil'] }, d.furigana || ''),
        h('span', { class: ['w-mean', step < 2 && 'veil'] }, d.meaning || '')),
      h('span', { class: 'item-actions' }, speakBtn(d.furigana || d.orig), toggleBtn(r, 'favorite', 'star', '즐겨찾기'), toggleBtn(r, 'bookmark', 'bookmark', '북마크')));
  };
  draw();
  el.addEventListener('click', () => { if (!hide) return; step = (step + 1) % 3; draw(); });
  longPress(el, () => wordMenu(r));
  return el;
}
function wordOrigPlain(orig) {
  return [...orig].map((c) => (isKanjiChar(c) ? h('span', { class: 'k', onclick: (e) => { e.stopPropagation(); openKanji(c); } }, c) : c));
}

/* ---------------- 카드형 ---------------- */

export function wordCard(r, hide) {
  const d = r.data;
  let step = hide ? 0 : 2;
  const el = h('div', { class: 'w-card' });
  const draw = () => {
    replace(el,
      levelBadge(d.level),
      h('div', { class: 'corner' }, toggleBtn(r, 'favorite', 'star', '즐겨찾기'), toggleBtn(r, 'bookmark', 'bookmark', '북마크')),
      centerLine(h('span', { class: 'big-word' }, wordOrig(d.orig, d.furigana, step >= 1)), copyBtn(d.orig), speakBtn(d.furigana || d.orig)),
      h('div', { class: ['meaning', step < 2 && 'hidden-text'] }, d.meaning),
      d.example && centerLine(h('span', { class: 'ex' }, exampleNode(d, step >= 1)), copyBtn(d.example), speakBtn(d.example, '예문 듣기')),
      d.example && h('div', { class: ['ex-ko', step < 2 && 'hidden-text'] }, d.exampleKo || ''),
      d.pos && h('span', { class: 'pos' }, d.pos));
  };
  draw();
  el.addEventListener('click', () => { if (!hide) return; step = (step + 1) % 3; draw(); });
  longPress(el, () => wordMenu(r));
  return el;
}

/* ---------------- 목록 + 보기 형식 전환 + 테스트 시작 ---------------- */

export function wordList(screen, getRows, { onTest, empty, bar: withBar = true } = {}) {
  let mode = viewMode(screen);
  const box = h('div');
  const draw = () => {
    const rows = getRows();
    const hide = hideDefault(mode);
    if (!rows.length) { replace(box, empty || h('p', { class: 'empty' }, '단어가 없어요.')); return; }
    const shown = rows.slice(0, 600);
    replace(box,
      mode === 'list'
        ? h('div', { class: 'list' }, shown.map((r) => wordRow(r, hide)))
        : h('div', { class: 'cards' }, shown.map((r) => wordCard(r, hide))),
      rows.length > shown.length && h('p', { class: 'hint center' }, `앞의 ${shown.length}개만 보여요. 검색·필터로 좁혀 보세요.`));
  };
  draw();
  const bar = withBar && h('div', { class: 'bottom-bar' },
    viewToggle(screen, (m) => { mode = m; draw(); }),
    onTest && h('button', { type: 'button', class: 'fab', onclick: onTest }, icon('layers', 18), '테스트 시작'));
  return { el: h('div', { class: 'stack' }, box, bar), redraw: draw };
}

export { rubyNodes };
