// 단어 테스트: 오른쪽(앎)으로 넘길 때까지, 왼쪽(모름)으로 넘긴 카드만 판마다 다시 섞어 나온다.
// 진행 상태(판·남은 더미·경과 시간)는 카드를 넘길 때마다 progress('test')에 저장 → 다른 기기에서 이어서.

import { h, icon, go, replace, toast, modal, mmss, copyText, store, emptyState, segmented, chipToggle, fmtDate } from '../core.js';
import { db } from '../db.js';
import { speak } from '../tts.js';
import { RoundDeck } from '../deck.js';
import { streakSetting } from '../prefs.js';
import { openKanji, kanjiData, kanjiName } from '../kanji.js';
import { levelBadge, wordOrig } from '../wordview.js';
import { isKanjiChar } from '../core.js';

/* ---------------- 시작 ---------------- */

export async function startTest({ ids, title, type = 'words' }) {
  if (!ids.length) { toast('테스트할 카드가 없어요', 'err'); return; }
  if (db.progress('test')) {
    const v = await modal({
      title: '진행 중인 테스트가 있어요',
      body: h('p', null, `'${db.progress('test').data.title}' 테스트를 이어서 할까요, 새로 시작할까요?`),
      actions: [{ label: '이어서 하기', value: 'resume' }, { label: '새로 시작', value: 'new', primary: true }],
    });
    if (!v) return;
    if (v === 'resume') { go('/test/run'); return; }
  }
  let limit = store.get('testLimit', 'all');
  const ok = await modal({
    title: '몇 개로 할까요?',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, `${title} · ${ids.length}개`),
      segmented([[10, '10'], [25, '25'], [50, '50'], ['all', '전체']], limit, (v) => { limit = v; })),
    actions: [{ label: '취소', value: false }, { label: '시작', value: true, primary: true }],
  });
  if (!ok) return;
  store.set('testLimit', limit);
  const pick = limit === 'all' ? ids : [...ids].sort(() => Math.random() - 0.5).slice(0, limit);
  db.saveProgress('test', {
    title, type, ids: pick,
    deck: new RoundDeck({ ids: pick, streak: streakSetting() }).state,
    startedAt: new Date().toISOString(), elapsed: 0,
  });
  go('/test/run');
}

/* ---------------- 테스트 첫 화면 ---------------- */

export function testHomeView(_p, _q, ctx) {
  const el = h('div', { class: 'stack' });
  const draw = () => {
    const p = db.progress('test');
    const words = db.all('word');
    const tags = [...new Set(words.flatMap((r) => r.data.tags || []))];
    const levels = ['N5', 'N4', 'N3', 'N2', 'N1'].filter((lv) => words.some((r) => r.data.level === lv));
    const quick = (label, rows) => rows.length > 0 && h('button', { type: 'button', class: 'plain', style: { justifyContent: 'space-between' }, onclick: () => startTest({ ids: rows.map((r) => r.id), title: label }) },
      h('span', null, label), h('span', { class: 'muted small' }, `${rows.length}개`));
    const logs = db.all('log').filter((r) => r.data.type === 'test').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8);
    replace(el,
      p && h('div', { class: 'panel', style: { borderColor: 'var(--accent)' } },
        h('div', { class: 'row between wrap' },
          h('div', { class: 'stack tight' }, h('b', null, '진행 중: ' + p.data.title),
            h('span', { class: 'muted small' }, `${p.data.deck.done.length}/${p.data.deck.total} · ${p.data.deck.round}판 · ${p.data._dev || ''}에서`)),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'ghost small', onclick: () => db.clearProgress('test') }, '그만두기'),
            h('button', { type: 'button', onclick: () => go('/test/run') }, '이어서')))),
      !words.length ? emptyState('단어를 등록하면 테스트할 수 있어요.', h('button', { type: 'button', onclick: () => go('/words/new') }, '단어 등록')) :
        h('div', { class: 'panel stack' },
          h('h2', null, '테스트 범위'),
          h('p', { class: 'hint' }, '단어장·한자별 모음·검색 결과 화면의 \'테스트 시작\'으로 지금 보이는 목록 그대로 테스트할 수도 있어요.'),
          h('div', { class: 'stack tight' },
            quick('전체 단어', words),
            quick('북마크', words.filter((r) => r.data.bookmark)),
            quick('모름이 많은 단어 (2번 이상)', words.filter((r) => (r.data.unknownCount || 0) >= 2)),
            quick('면접 태그', words.filter((r) => (r.data.tags || []).includes('면접'))),
            quick('발음 주의 단어', words.filter((r) => (r.data.tags || []).includes('발음주의'))),
            ...levels.map((lv) => quick(lv, words.filter((r) => r.data.level === lv))),
            ...tags.filter((t) => !['면접', '발음주의'].includes(t)).map((t) => quick(`태그: ${t}`, words.filter((r) => (r.data.tags || []).includes(t))))),
          h('div', { class: 'row between wrap' }, h('span', { class: 'muted small' }, '연속 정답 횟수'),
            segmented([[1, 'x1'], [2, 'x2'], [3, 'x3']], streakSetting(), (v) => db.setSettings({ streak: v }), { small: true }))),
      logs.length > 0 && h('div', { class: 'panel stack' }, h('h2', null, '최근 테스트'),
        h('div', { class: 'list' }, logs.map((r) => h('div', { class: 'item' },
          h('div', { class: 'item-main' }, h('span', { class: 'item-title' }, r.data.title),
            h('span', { class: 'item-sub' }, `${fmtDate(r.created_at, true)} · ${r.data.total}개 · ${r.data.rounds}판 · ${mmss(r.data.seconds)}`)))))));
  };
  draw();
  ctx.onDb((e) => { if (['progress', 'word', 'log'].includes(e.kind) || e.type === 'reset') draw(); });
  return { el, title: '단어 테스트' };
}

/* ---------------- 카드 ---------------- */

async function cardFor(id) {
  if (String(id).startsWith('k:')) {
    const ch = id.slice(2);
    const d = await kanjiData(ch);
    return {
      kind: 'kanji', id, front: ch, char: ch,
      furigana: d ? [...(d.kun || []).slice(0, 2).map((r) => r.replace(/\..*/, '')), ...(d.on || []).slice(0, 2)].join('・') : '',
      meaning: kanjiName(ch) || (d?.ko?.length ? `음: ${d.ko.join(', ')}` : '한자'),
    };
  }
  const r = db.get(id);
  if (!r) return null;
  return { kind: 'word', id, front: r.data.orig, furigana: r.data.furigana, meaning: r.data.meaning, level: r.data.level, row: r, char: [...r.data.orig].find(isKanjiChar) };
}

export function testRunView(_p, query, ctx) {
  if (query.src === 'pending') {
    const pend = store.get('pendingTest');
    store.del('pendingTest');
    if (pend?.type === 'kanji') {
      const ids = pend.chars.map((c) => 'k:' + c);
      db.saveProgress('test', { title: pend.title, type: 'kanji', ids, deck: new RoundDeck({ ids, streak: streakSetting() }).state, startedAt: new Date().toISOString(), elapsed: 0 });
      history.replaceState(null, '', '#/test/run');
    }
  }
  const row = db.progress('test');
  if (!row) { go('/test', { replace: true }); return null; }
  const st = row.data;
  const deck = new RoundDeck({ state: st.deck });
  let resumedAt = Date.now();
  const elapsed = () => st.elapsed + (Date.now() - resumedAt) / 1000;
  const save = () => { st.deck = deck.state; const r = db.saveProgress('test', { ...st, elapsed: elapsed() }); myAt = r.data._at; };
  let myAt = null;
  let revealed = false;
  let finished = false;

  const progEl = h('div', { class: 'test-progress' });
  const timeEl = h('div', { class: 'test-time' });
  const roundEl = h('span', { class: 'muted small' });
  const barEl = h('i');
  const deckEl = h('div', { class: 'deck' });
  const el = h('div', { class: 'stack' },
    h('div', { class: 'test-top' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '나가기', onclick: () => { save(); go('/test'); } }, icon('back', 22)),
      h('div', { class: 'stack tight', style: { justifyItems: 'center' } }, progEl, roundEl),
      timeEl),
    h('div', { class: 'bar' }, barEl),
    deckEl,
    h('div', { class: 'test-controls' },
      h('button', { type: 'button', class: 'big-round no', title: '모름 (←)', 'aria-label': '모름', onclick: () => swipe(false) }, icon('left', 30)),
      h('button', { type: 'button', class: 'round', title: '되돌리기 (Z)', 'aria-label': '되돌리기', onclick: () => undo() }, icon('undo', 20)),
      h('button', { type: 'button', class: 'big-round yes', title: '앎 (→)', 'aria-label': '앎', onclick: () => swipe(true) }, icon('right', 30))),
    h('p', { class: 'hint center' }, h('span', { class: 'kbd' }, 'Space'), ' 공개/숨김 · ', h('span', { class: 'kbd' }, '←'), ' 모름 · ', h('span', { class: 'kbd' }, '→'), ' 앎 · ', h('span', { class: 'kbd' }, 'Z'), ' 되돌리기'));

  const tick = setInterval(() => { timeEl.textContent = mmss(elapsed()); }, 500);
  let cardEl = null;
  let card = null;

  const updateTop = () => {
    const p = deck.progress();
    progEl.textContent = `${p.known} / ${p.total}`;
    roundEl.textContent = `${p.round}판 · 남은 ${p.left}`;
    barEl.style.width = (p.known / Math.max(1, p.total)) * 100 + '%';
    timeEl.textContent = mmss(elapsed());
  };

  const renderCard = async () => {
    updateTop();
    if (deck.finished) return finish();
    const id = deck.current();
    card = await cardFor(id);
    if (!card) { deck.answer(true); return renderCard(); }
    revealed = false;
    cardEl = h('div', { class: 'tcard', tabindex: 0 });
    paintCard();
    deckEl.replaceChildren(cardEl);
    attachSwipe(cardEl);
    if (!db.settings().testHelpSeen) showHelp();
  };

  const paintCard = () => {
    const c = card;
    const run = st.deck.run[c.id] || 0, missed = st.deck.missed[c.id] || 0;
    replace(cardEl,
      levelBadge(c.level),
      h('div', { class: 'tools' },
        h('button', { type: 'button', class: 'icon-btn sm muted', title: '복사', onclick: (e) => { e.stopPropagation(); copyText(c.front); } }, icon('copy', 16)),
        h('button', { type: 'button', class: 'icon-btn sm muted', title: '듣기', onclick: (e) => { e.stopPropagation(); speak(c.furigana?.split('・')[0] || c.front); } }, icon('speaker', 18))),
      h('div', { class: 't-body' },
        h('div', { class: 't-word', lang: 'ja' }, c.kind === 'word' ? wordOrig(c.front, revealed ? c.furigana : '', revealed, false) : c.front),
        h('div', { class: ['t-mean', !revealed && 'hidden-text'] }, c.kind === 'kanji' && revealed ? h('span', null, h('span', { class: 'jp muted' }, c.furigana), h('br'), c.meaning) : c.meaning)),
      missed > 0 && st.deck.need > 1 && h('span', { class: 'streak' }, `연속 ${run}/${st.deck.need}`),
      c.char && h('button', { type: 'button', class: 'chip kanji-btn', onclick: (e) => { e.stopPropagation(); openKanji(c.char); } }, '한자'));
    // 테스트 카드는 단어장과 달리 한 번 누르면 후리가나와 뜻이 함께 열린다. 한자는 '한자' 버튼으로만 연다.
  };

  const toggle = () => { revealed = !revealed; paintCard(); if (revealed && card.kind === 'word') speak(card.furigana || card.front).catch(() => {}); };

  const swipe = (known, fromDrag = false) => {
    if (finished || !cardEl) return;
    const out = cardEl;
    cardEl = null;
    out.classList.add('anim', known ? 'right' : 'left');
    out.style.transform = `translateX(${known ? 130 : -130}%) rotate(${known ? 18 : -18}deg)`;
    out.style.opacity = '0';
    deck.answer(known);
    save();
    setTimeout(() => renderCard(), fromDrag ? 180 : 230);
  };
  const undo = () => { if (deck.undo()) { save(); renderCard(); } else toast('되돌릴 카드가 없어요'); };

  function attachSwipe(c) {
    let sx = 0, sy = 0, dx = 0, dragging = false, moved = false;
    c.addEventListener('pointerdown', (e) => {
      if (e.target?.closest?.('button')) return;
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) moved = true;
      if (!moved) return;
      c.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      c.classList.toggle('right', dx > 30);
      c.classList.toggle('left', dx < -30);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const w = deckEl.clientWidth;
      if (moved && Math.abs(dx) >= w * 0.3) { swipe(dx > 0, true); return; } // 화면 폭의 30% 이상
      c.classList.add('anim'); c.style.transform = ''; c.classList.remove('right', 'left');
      setTimeout(() => c.classList.remove('anim'), 300);
      if (!moved) toggle();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => { dragging = false; c.style.transform = ''; c.classList.remove('right', 'left'); });
  }

  const onKey = (e) => {
    if (e.target?.closest?.('input,textarea,select') || document.querySelector('.modal-backdrop,.sheet-backdrop')) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); swipe(true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); swipe(false); }
    else if (e.key === 'z' || e.key === 'Z') undo();
  };
  document.addEventListener('keydown', onKey);
  // 창을 닫거나 앱을 내려도 경과 시간과 진행 상태를 남긴다
  const onHide = () => { if (!finished) save(); };
  window.addEventListener('pagehide', onHide);

  const showHelp = () => {
    const cb = h('input', { type: 'checkbox' });
    const ov = h('div', { class: 'overlay-help' },
      h('label', { class: 'bubble check', style: { justifySelf: 'start' } }, cb, '다시 보지 않기'),
      h('div', { class: 'bubble', style: { justifySelf: 'center' } }, '1 카드 누름 → 정답 공개 & 단어 음성', h('br'), '2 다시 누름 → 숨김', h('br'), '3 \'한자\' 버튼 → 한자 정보'),
      h('div', { class: 'row between' }, h('div', { class: 'bubble' }, '모르는 단어는', h('br'), '왼쪽으로 스와이프!'), h('div', { class: 'bubble' }, '아는 단어는', h('br'), '오른쪽으로 스와이프!')),
      h('div', { class: 'row between' }, h('div', { class: 'bubble small' }, `연속 정답 x${st.deck.need}: 모른다고 한 단어는 ${st.deck.need}번 연속 맞혀야 끝나요`),
        h('button', { type: 'button', onclick: () => { if (cb.checked) db.setSettings({ testHelpSeen: true }); ov.remove(); } }, '시작')));
    deckEl.append(ov);
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    const seconds = elapsed();
    const hard = deck.hard(2);
    // 학습 기록: 아름/모름, 판 수, 소요 시간
    db.put('log', { type: 'test', title: st.title, total: st.deck.total, rounds: st.deck.round, seconds, missed: st.deck.missed, at: new Date().toISOString() });
    for (const [id, n] of Object.entries(st.deck.missed)) {
      const r = db.get(id);
      if (r) db.patch(id, { unknownCount: (r.data.unknownCount || 0) + n });
    }
    db.clearProgress('test');
    clearInterval(tick);
    replace(el, h('div', { class: 'panel stack' },
      h('h2', null, '테스트 완료!'),
      h('div', { class: 'stat' },
        h('div', null, h('b', null, st.deck.total), h('span', null, '단어')),
        h('div', null, h('b', null, mmss(seconds)), h('span', null, '걸린 시간')),
        h('div', null, h('b', null, st.deck.round), h('span', null, '판'))),
      hard.length > 0 && h('h3', { class: 'group-title' }, '여러 번 모른다고 한 단어'),
      hard.length > 0 && h('div', { class: 'list' }, hard.map(({ id, n }) => {
        const r = db.get(id);
        const label = r ? r.data.orig : id.replace(/^k:/, '');
        return h('div', { class: 'item' },
          h('div', { class: 'item-main' }, h('span', { class: 'item-title jp' }, label), h('span', { class: 'item-sub' }, r ? `${r.data.furigana} · ${r.data.meaning}` : '한자')),
          h('span', { class: 'tag bad' }, `${n}번`),
          r && chipToggle('북마크', !!r.data.bookmark, (on) => db.patch(id, { bookmark: on })));
      })),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', onclick: () => go('/test') }, '테스트 홈'),
        hard.length > 0 && h('button', { type: 'button', class: 'ghost', onclick: () => startTest({ ids: hard.map((x) => x.id), title: st.title + ' · 어려운 단어' }) }, '어려운 단어만 다시'))));
  };

  // 다른 기기에서 넘긴 진행 상태가 들어오면 반영
  ctx.onDb((e) => {
    if (e.kind !== 'progress' || !e.remote || finished) return;
    if (e.type === 'delete') return;
    if (e.row?.data?.type !== 'test' || e.row.data._at === myAt) return;
    Object.assign(st, e.row.data);
    deck.s = st.deck;
    resumedAt = Date.now();
    renderCard();
  });

  renderCard();
  return {
    el, title: st.title, immersive: true, back: () => { save(); go('/test'); },
    cleanup: () => { clearInterval(tick); document.removeEventListener('keydown', onKey); window.removeEventListener('pagehide', onHide); if (!finished) save(); },
  };
}
