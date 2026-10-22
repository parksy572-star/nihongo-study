// 한자 정보: 일본 한자 기준 데이터(KANJIDIC2·KanjiVG·常用漢字表) + 내가 입력한 훈음·메모·링크(kanji 행, 동기화)
// openKanji(ch): 화면 아래에서 올라오는 한자 정보 창

import { h, icon, openSheet, toast, copyText, go, debounce, isKanjiChar } from './core.js';
import { db } from './db.js';
import { speak } from './tts.js';

const SHARDS = 32;
const shardCache = new Map();
let radicals = null;
let joyo = null;

async function shard(i) {
  if (!shardCache.has(i)) {
    shardCache.set(i, fetch(`/data/kanji/${String(i).padStart(2, '0')}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  return shardCache.get(i);
}

export async function kanjiData(ch) {
  return (await shard(ch.codePointAt(0) % SHARDS))[ch] || null;
}

export async function loadJoyo() {
  if (!joyo) joyo = fetch('/data/kanji/joyo.txt').then((r) => r.text()).then((t) => new Set([...t])).catch(() => new Set());
  return joyo;
}

async function radicalList() {
  if (!radicals) radicals = fetch('/data/kanji/radicals.json').then((r) => r.json()).catch(() => []);
  return radicals;
}

// 내가 입력한 한자 정보 (훈음·메모·링크)
export function myKanji(ch) { return db.one('kanji', (d) => d.char === ch); }
export function saveMyKanji(ch, patch) {
  const r = myKanji(ch);
  return db.put('kanji', { char: ch, ...(r?.data || {}), ...patch }, r?.id);
}
export function kanjiName(ch) { return myKanji(ch)?.data?.hun || ''; }

export const kanjiOf = (text) => [...new Set([...String(text || '')].filter(isKanjiChar))];

export function wordsWithKanji(ch) {
  return db.all('word').filter((r) => (r.data.orig || '').includes(ch));
}

export const naverSearchUrl = (ch) => `https://ja.dict.naver.com/#/search?query=${encodeURIComponent(ch)}&range=letter`;
export const nihongoSearchUrl = (ch) => `https://www.google.com/search?q=${encodeURIComponent(`site:nihongokanji.com 「${ch}」`)}`;

const readingText = (r) => r.replace(/\./g, '(') + (r.includes('.') ? ')' : '');

/* ---------------- 획순 그림 ---------------- */

function strokeSvg(paths) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 109 109');
  svg.setAttribute('class', 'strokes');
  svg.setAttribute('role', 'img');
  const els = paths.map((d) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', 's');
    svg.append(p);
    return p;
  });
  const nums = paths.map((d, i) => {
    const m = /M\s*([\d.]+)[ ,]+([\d.]+)/i.exec(d);
    const t = document.createElementNS(NS, 'text');
    const x = m ? Number(m[1]) : 5, y = m ? Number(m[2]) : 5;
    t.setAttribute('x', String(Math.max(2, x - 6)));
    t.setAttribute('y', String(Math.max(7, y - 2)));
    t.textContent = String(i + 1);
    svg.append(t);
    return t;
  });
  let timer = null;
  const reset = () => {
    clearTimeout(timer);
    els.forEach((p) => { p.classList.remove('hl', 'ghost'); p.style.transition = 'none'; p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; });
    nums.forEach((t) => t.classList.remove('on'));
  };
  const highlight = (i) => {
    reset();
    els.forEach((p, k) => p.classList.toggle('ghost', k !== i));
    els[i].classList.add('hl');
    nums[i].classList.add('on');
  };
  nums.forEach((t, i) => t.addEventListener('click', (e) => { e.stopPropagation(); highlight(i); }));
  const play = () => {
    reset();
    els.forEach((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
    });
    let i = 0;
    const step = () => {
      if (i >= els.length) return;
      const p = els[i];
      const len = p.getTotalLength();
      p.style.transition = `stroke-dashoffset ${Math.max(0.25, len / 90)}s linear`;
      p.getBoundingClientRect();
      p.style.strokeDashoffset = '0';
      nums[i].classList.add('on');
      i++;
      timer = setTimeout(step, Math.max(250, (len / 90) * 1000) + 120);
    };
    step();
  };
  return { svg, play, reset };
}

/* ---------------- 한자 정보 창 ---------------- */

let currentSheet = null;
export async function openKanji(ch) {
  const content = h('div', { class: 'stack' }, h('div', { class: 'loading' }, h('span', { class: 'spin' })));
  if (currentSheet && !currentSheet.closed) currentSheet.setContent(content);
  else currentSheet = openSheet(content);
  const sheet = currentSheet;
  const [d, rads] = await Promise.all([kanjiData(ch), radicalList()]);
  if (sheet.closed) return;
  sheet.setContent(kanjiPanel(ch, d, rads, sheet));
}

function kanjiPanel(ch, d, rads, sheet) {
  const mine = myKanji(ch)?.data || {};
  const hun = h('input', { value: mine.hun || '', placeholder: d?.ko?.length ? `예: ○○ ${d.ko[0]}` : '훈음 (예: 이을 계)', style: { maxWidth: '180px' } });
  const saveHun = debounce(() => saveMyKanji(ch, { hun: hun.value.trim() }), 600);
  hun.addEventListener('input', saveHun);
  hun.addEventListener('blur', () => saveHun.flush());

  const words = wordsWithKanji(ch);
  const big = h('button', { type: 'button', class: 'kj-big', title: '이 한자가 들어간 단어 모음', onclick: () => { sheet.close(); go('/kanji/' + encodeURIComponent(ch)); } }, ch);

  const rad = d?.r ? rads[d.r - 1] : null;
  const grid = h('dl', { class: 'kj-grid' });
  const row = (label, ...vals) => { grid.append(h('dt', null, label), h('dd', null, ...vals)); };
  if (!d) {
    grid.append(h('dt', null, '정보'), h('dd', null, h('span', { class: 'muted small' }, '이 한자의 데이터가 사이트에 없어요(상용·인명용 한자 위주로 들어 있어요). 아래 링크로 확인해 주세요.')));
  } else {
    if (rad) row('부수', h('button', { type: 'button', class: 'pill btn-pill', onclick: () => openKanji(rad[0]) }, rad[0]), h('span', null, `(${rad[1]})`));
    const kun = [...(d.kun || []).map((r) => h('span', { class: 'pill' }, readingText(r))), ...(d.kun2 || []).map((r) => h('span', { class: 'pill ext', title: '상용한자표 밖의 읽기' }, readingText(r), h('small', null, ' 표외')))];
    const on = [...(d.on || []).map((r) => h('span', { class: 'pill' }, r)), ...(d.on2 || []).map((r) => h('span', { class: 'pill ext', title: '상용한자표 밖의 읽기' }, r, h('small', null, ' 표외')))];
    row('훈독', ...(kun.length ? kun : [h('span', { class: 'muted small' }, '없음')]));
    row('음독', ...(on.length ? on : [h('span', { class: 'muted small' }, '없음')]));
    row('획수', h('span', { class: 'pill' }, String(d.sc || '?')));
    const info = [d.joyo ? '상용한자' : null, d.g && d.g <= 6 ? `${d.g}학년` : null, d.j ? `JLPT 구N${d.j}` : null].filter(Boolean);
    if (info.length) row('구분', ...info.map((x) => h('span', { class: 'tag gray' }, x)));
    if (d.v?.length) row('이체자', h('span', { class: 'muted jp' }, d.v.join(' ')));
  }

  let strokes = null;
  if (d?.s?.length) strokes = strokeSvg(d.s);

  const memo = h('textarea', { rows: 3, placeholder: '구성 원리를 내 말로 요약 (예: 糸 실 + 𠃊+米 실뭉치 → 실이 이어짐)' }, mine.memo || '');
  const saveMemo = debounce(() => saveMyKanji(ch, { memo: memo.value }), 800);
  memo.addEventListener('input', saveMemo);
  memo.addEventListener('blur', () => saveMemo.flush());

  // 링크 버튼 2개: 저장한 주소가 있으면 그 주소, 없으면 기본 주소(구글 검색·네이버 한자 검색)
  const linkNihongo = h('a', { class: 'btn soft small', target: '_blank', rel: 'noopener' });
  const linkNaver = h('a', { class: 'btn soft small', target: '_blank', rel: 'noopener' });
  const paintLinks = (m) => {
    linkNihongo.href = m.nihongo || nihongoSearchUrl(ch);
    linkNihongo.replaceChildren(icon('external', 14), m.nihongo ? '일본어 한자 공부방' : '일본어 한자 공부방 (구글 검색)');
    linkNaver.href = m.naver || naverSearchUrl(ch);
    linkNaver.replaceChildren(icon('external', 14), '네이버 일본어사전');
  };
  paintLinks(mine);

  // 주소 수정하기: 두 링크 버튼의 주소를 직접 고친다(PC·휴대폰 동기화)
  const nihongoUrl = h('input', { type: 'url', value: mine.nihongo || nihongoSearchUrl(ch), placeholder: 'https://nihongokanji.com/1127/' });
  const naverUrl = h('input', { type: 'url', value: mine.naver || naverSearchUrl(ch), placeholder: naverSearchUrl(ch) });
  const okUrl = (u) => /^https?:\/\/[^\s]+$/i.test(u);
  const saveUrls = () => {
    const a = nihongoUrl.value.trim(), b = naverUrl.value.trim();
    if ((a && !okUrl(a)) || (b && !okUrl(b))) { toast('https:// 로 시작하는 주소를 넣어 주세요', 'err'); return; }
    // 기본 주소와 같으면 따로 저장하지 않는다(기본 주소는 한자마다 자동으로 만들어짐)
    const patch = { nihongo: a === nihongoSearchUrl(ch) ? '' : a, naver: b === naverSearchUrl(ch) ? '' : b };
    saveMyKanji(ch, patch);
    paintLinks(patch);
    toast('링크 주소를 저장했어요 (PC·휴대폰 모두에 반영돼요)');
  };
  const resetUrls = () => {
    nihongoUrl.value = nihongoSearchUrl(ch);
    naverUrl.value = naverSearchUrl(ch);
    saveUrls();
  };

  const parts = (d?.p || []).filter((p) => p !== ch);
  return h('div', { class: 'stack' },
    h('div', { class: 'kj-head' }, big,
      h('div', { class: 'stack tight grow' },
        h('div', { class: 'row wrap' }, hun, h('span', { class: 'muted small' }, d?.ko?.length ? `한국 음: ${d.ko.join(', ')}` : '')),
        h('span', { class: 'muted small' }, words.length ? `내 단어 ${words.length}개 · 큰 한자를 누르면 단어 모음` : '아직 이 한자가 들어간 내 단어가 없어요')),
      h('div', { class: 'stack tight' },
        h('button', { type: 'button', class: 'icon-btn', title: '복사', onclick: () => copyText(ch) }, icon('copy', 18)),
        h('button', { type: 'button', class: 'icon-btn', title: '듣기', onclick: () => speak(d?.kun?.[0]?.replace(/[.-]/g, '') || d?.on?.[0] || ch) }, icon('speaker', 18)))),
    grid,
    strokes && h('div', { class: 'strokes-wrap' },
      strokes.svg,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'soft small', onclick: () => strokes.play() }, icon('play', 14), '획순 보기'),
        h('button', { type: 'button', class: 'ghost small', onclick: () => strokes.reset() }, '처음으로')),
      h('span', { class: 'hint' }, '번호를 누르면 그 획만 강조돼요')),
    parts.length > 0 && h('div', { class: 'stack tight' },
      h('span', { class: 'field-label' }, '부품 한자'),
      h('div', { class: 'parts' }, parts.map((p) => h('button', { type: 'button', class: 'part', onclick: () => openKanji(p) }, h('span', { class: 'pc' }, p), h('span', { class: 'pn' }, kanjiName(p) || '보기'))))),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, '내 메모 (구성 원리)'), memo),
    h('div', { class: 'stack tight' },
      h('span', { class: 'field-label' }, '구성 원리·훈음 확인'),
      h('div', { class: 'row wrap' }, linkNihongo, linkNaver),
      h('details', null, h('summary', { class: 'hint' }, '주소 수정하기'),
        h('div', { class: 'stack tight', style: { marginTop: '8px' } },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '일본어 한자 공부방 링크'), nihongoUrl),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, '네이버 일본어사전 링크'), naverUrl),
          h('div', { class: 'row end' },
            h('button', { type: 'button', class: 'ghost small', onclick: resetUrls }, '기본 주소로'),
            h('button', { type: 'button', class: 'small', onclick: saveUrls }, '저장'))))),
    h('p', { class: 'credit' }, '한자 데이터: KANJIDIC2 (EDRDG, CC BY-SA 4.0) · 획순: KanjiVG (© Ulrich Apel, CC BY-SA 3.0) · 표외 표시: 常用漢字表(2010) 대조'));
}

// 글 속 한자를 눌러 정보 창을 여는 요소로 만든다
export function kanjiClickable(text, cls = '') {
  return h('span', { class: cls }, [...String(text || '')].map((c) => (isKanjiChar(c)
    ? h('span', { class: 'k', onclick: (e) => { e.stopPropagation(); openKanji(c); } }, c)
    : c)));
}

