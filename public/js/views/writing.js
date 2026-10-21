// 작문 첫 화면(이어서 하기·새로 쓰기·기록·자주 틀리는 한자와 표현), 기록 상세, 분석 결과 화면
import { h, icon, go, replace, toast, confirmDialog, fmtDate, emptyState, mmss, store, segmented } from '../core.js';
import { db } from '../db.js';
import { viewToggle, viewMode } from '../prefs.js';
import { cellRect, RULE_NAME } from '../genko.js';
import { zoomRegion } from '../photo.js';
import { openKanji } from '../kanji.js';
import { furi } from '../furigana.js';
import { sayBtn, listenBtn } from '../analysis-ui.js';
import { speak } from '../tts.js';

export function writingTitle(w) {
  const d = new Date(w.startedAt || Date.now());
  return `${d.getMonth() + 1}/${d.getDate()} ${w.setting?.category || '작문'} · ${w.setting?.chars || ''}자`;
}

/* ---------------- 첫 화면 ---------------- */

export function writingHomeView(_p, query, ctx) {
  const el = h('div', { class: 'stack' });
  let tab = query.tab || store.get('writingTab', 'list');
  const draw = () => replace(el,
    resumeCard(),
    h('button', { type: 'button', class: 'wide', onclick: () => go('/writing/run') }, icon('pen', 18), db.progress('writing') ? '쓰던 작문 이어서' : '새 작문 쓰기'),
    segmented([['list', '작문 기록'], ['weak', '자주 틀리는 것']], tab, (v) => { tab = v; store.set('writingTab', v); draw(); }),
    tab === 'list' ? listPanel() : weakPanel());
  draw();
  ctx.onDb((e) => { if (['writing', 'progress'].includes(e.kind) || e.type === 'reset') draw(); });
  return { el, title: '작문' };
}

function resumeCard() {
  const r = db.progress('writing');
  if (!r || r.data.phase === 'setup') return null;
  const w = r.data;
  const label = { question: '질문 고르는 중', photos: '쓰는 중·사진 올리는 중', verify: '읽은 글자 확인 중', result: '분석 완료(저장 전)' }[w.phase] || '진행 중';
  return h('div', { class: 'panel', style: { borderColor: 'var(--accent)' } },
    h('div', { class: 'row between wrap' },
      h('div', { class: 'stack tight' }, h('b', null, '쓰던 작문'), h('span', { class: 'muted small' }, `${label} · ${w._dev || ''}에서 ${fmtDate(r.updated_at, true)}`),
        w.question && furi(w.question.ja, { cls: 'small' })),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'ghost small', onclick: async () => {
          if (!(await confirmDialog('쓰던 작문을 버릴까요? 올린 사진도 지워져요.', { danger: true, ok: '버리기' }))) return;
          db.removeFiles((w.pages || []).map((p) => p.path));
          db.clearProgress('writing');
        } }, '버리기'),
        h('button', { type: 'button', onclick: () => go('/writing/run') }, '이어서'))));
}

const stats = (w) => ({
  kanji: (w.analysis?.kanji_errors || []).filter((e) => e.status === 'wrong').length,
  fixes: (w.analysis?.corrections || []).length,
});

function listPanel() {
  const rows = db.all('writing').sort((a, b) => (b.data.savedAt || b.created_at).localeCompare(a.data.savedAt || a.created_at));
  if (!rows.length) return emptyState('저장한 작문이 아직 없어요. 400자 원고지에 써서 사진으로 올려 보세요.');
  let mode = viewMode('writingList');
  const box = h('div');
  const draw = () => {
    if (mode === 'list') {
      replace(box, h('div', { class: 'list' }, rows.map((r) => {
        const s = stats(r.data);
        return h('div', { class: 'item link', onclick: () => go('/writing/' + r.id) },
          h('div', { class: 'item-main' },
            h('span', { class: 'item-title jp' }, (r.data.question?.ja || '').split(/[。？]/)[0]),
            h('span', { class: 'item-sub' }, `${fmtDate(r.data.savedAt || r.created_at)} · 한자 오류 ${s.kanji} · 교정 ${s.fixes}`)),
          icon('right', 18));
      })));
    } else {
      replace(box, h('div', { class: 'cards' }, rows.map((r) => {
        const s = stats(r.data);
        const img = h('img', { alt: '', style: { width: '84px', height: '112px', objectFit: 'cover', borderRadius: '10px', flex: 'none', background: 'var(--surface-2)' } });
        if (r.data.pages?.[0]) db.fileUrl(r.data.pages[0].path).then((u) => { img.src = u; }).catch(() => {});
        return h('div', { class: 'card link', onclick: () => go('/writing/' + r.id) },
          h('div', { class: 'row', style: { alignItems: 'flex-start' } }, img,
            h('div', { class: 'stack tight grow' },
              h('b', { class: 'small' }, `${fmtDate(r.data.savedAt || r.created_at)} · 한자 오류 ${s.kanji} · 교정 ${s.fixes}`),
              h('p', { class: 'jp small muted' }, r.data.question?.ja || ''),
              h('p', { class: 'jp small', style: { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, r.data.analysis?.corrected_ja || r.data.text || ''))));
      })));
    }
  };
  draw();
  return h('div', { class: 'stack' }, box, h('div', { class: 'bottom-bar' }, viewToggle('writingList', (m) => { mode = m; draw(); }), h('span')));
}

export function weakItems() {
  const kanji = new Map(), fixes = new Map();
  for (const r of db.all('writing')) {
    for (const e of r.data.analysis?.kanji_errors || []) {
      if (e.status !== 'wrong') continue;
      for (const c of [...(e.correct || '')].filter((x) => /[㐀-鿿]/.test(x))) {
        const m = kanji.get(c) || { char: c, count: 0, reasons: new Set(), written: new Set() };
        m.count++; m.reasons.add(e.reason); if (e.written) m.written.add(e.written);
        kanji.set(c, m);
      }
    }
    for (const c of r.data.analysis?.corrections || []) {
      const key = `${c.wrong}→${c.right}`;
      const m = fixes.get(key) || { ...c, count: 0 };
      m.count++;
      fixes.set(key, m);
    }
  }
  return { kanji: [...kanji.values()].sort((a, b) => b.count - a.count), fixes: [...fixes.values()].sort((a, b) => b.count - a.count) };
}

function weakPanel() {
  const { kanji, fixes } = weakItems();
  if (!kanji.length && !fixes.length) return emptyState('작문을 분석하면 자주 틀리는 한자와 표현이 여기에 모여요.');
  return h('div', { class: 'stack' },
    kanji.length > 0 && h('div', { class: 'panel stack' },
      h('div', { class: 'row between' }, h('h2', null, '자주 틀리는 한자'),
        h('button', { type: 'button', class: 'soft small', onclick: () => {
          store.set('pendingTest', { type: 'kanji', chars: kanji.map((k) => k.char), title: '작문에서 틀린 한자' });
          go('/test/run?src=pending');
        } }, icon('layers', 16), '테스트')),
      h('div', { class: 'parts' }, kanji.map((k) => h('button', { type: 'button', class: 'part', onclick: () => openKanji(k.char) },
        h('span', { class: 'pc' }, k.char), h('span', { class: 'pn' }, `${k.count}번 · ${[...k.reasons].join('·')}`))))),
    fixes.length > 0 && h('div', { class: 'panel stack' },
      h('h2', null, '자주 고친 표현'),
      h('ul', { class: 'fix-list' }, fixes.slice(0, 30).map((c) => h('li', null,
        h('p', { class: 'fix-line' }, h('del', null, furi(c.wrong)), ' → ', h('ins', null, furi(c.right)), c.count > 1 ? h('span', { class: 'tag bad', style: { marginLeft: '6px' } }, `${c.count}번`) : null),
        h('p', { class: 'fix-why' }, c.reason),
        h('div', { class: 'listen-row' },
          h('button', { type: 'button', class: 'ghost small', onclick: async () => (await import('./words.js')).quickAddWord({ orig: c.right, tags: ['작문'], note: c.reason }) }, icon('plus', 14), '단어장'),
          h('button', { type: 'button', class: 'ghost small', onclick: async () => (await import('./grammar.js')).quickAddGrammar({ pattern: c.right, note: `${c.wrong} → ${c.right}\n${c.reason}`, tags: ['작문'] }) }, icon('plus', 14), '문법')))))));
}

/* ---------------- 기록 상세 ---------------- */

export function writingDetailView({ id }, _q, ctx) {
  const el = h('div', { class: 'stack' });
  const draw = () => {
    const r = db.get(id);
    if (!r) { replace(el, emptyState('작문 기록을 찾을 수 없어요.')); return; }
    const w = r.data;
    replace(el,
      h('div', { class: 'panel row between wrap' },
        h('div', { class: 'stack tight' }, h('b', null, w.title || writingTitle(w)),
          h('span', { class: 'muted small' }, `${fmtDate(w.savedAt || r.created_at, true)}${w.elapsedSec ? ' · 걸린 시간 ' + mmss(w.elapsedSec) : ''}${w.setting?.exam ? ` · 제한 ${w.setting.limitMin}분` : ''}`)),
        h('button', { type: 'button', class: 'icon-btn', title: '삭제', onclick: async () => {
          if (!(await confirmDialog('이 작문 기록과 사진을 지울까요?', { danger: true, ok: '지우기' }))) return;
          db.removeFiles((w.pages || []).map((p) => p.path));
          db.remove(id);
          go('/writing', { replace: true });
        } }, icon('trash', 18))),
      renderWritingResult(w));
  };
  draw();
  ctx.onDb((e) => { if (e.id === id && e.remote) draw(); });
  return { el, title: '작문 기록', back: '/writing' };
}

/* ---------------- 분석 결과 ---------------- */

const sec = (title, ...children) => h('section', { class: 'a-sec' }, h('h3', null, title), ...children);

function markRect(w, item, pageIdx) {
  const s = w.setting;
  if (s.paper !== 'plain') return item.noPos ? null : cellRect(s.paper, s.rows, s.cols, item.row - 1, item.col - 1);
  if (Array.isArray(item.box_2d) && item.box_2d.length === 4) {
    const [y0, x0, y1, x1] = item.box_2d.map((v) => v / 1000);
    return [x0, y0, Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0)];
  }
  // 일반 종이: 줄 위치와 글자 순서로 대략 계산
  const line = w.ocr?.[pageIdx]?.lines?.[item.row - 1];
  if (line?.box_2d?.length === 4) {
    const [y0, x0, y1, x1] = line.box_2d.map((v) => v / 1000);
    const n = Math.max(1, [...line.text].length);
    const cw = (x1 - x0) / n;
    return [x0 + cw * (item.col - 1), y0, cw, y1 - y0];
  }
  return null;
}

export function renderWritingResult(w) {
  const a = w.analysis;
  const wrap = h('div', { class: 'analysis' });
  if (!a) { wrap.append(h('p', { class: 'note' }, '아직 분석하지 않았어요.')); return wrap; }
  for (const x of w.warnings || []) wrap.append(h('p', { class: 'note warn' }, x));

  const kErr = a.kanji_errors || [];
  const genko = [...(w.local || []).map((g) => ({ ...g, row: g.line, col: g.cell })), ...(a.genko || []).map((g) => ({ ...g, name: g.rule, source: 'ai', sure: true }))];
  kErr.forEach((e, i) => { e.n = i + 1; });
  genko.forEach((g, i) => { g.n = i + 1; });

  // 사진 + 표시
  (w.pages || []).forEach((p, pi) => {
    const box = h('div', { class: 'photo-mark' });
    const img = h('img', { alt: `${pi + 1}쪽 사진` });
    box.append(img);
    let blob = null;
    db.download(p.path).then((b) => { blob = b; img.src = URL.createObjectURL(b); }).catch(() => { img.alt = '사진을 불러오지 못했어요'; });
    const addMark = (item, cls, label, title, detail) => {
      const r = markRect(w, item, pi);
      if (!r) return;
      const m = h('button', { type: 'button', class: ['mk', cls], style: { left: r[0] * 100 + '%', top: r[1] * 100 + '%', width: r[2] * 100 + '%', height: r[3] * 100 + '%', padding: 0, minHeight: 0, background: 'transparent' }, title },
        h('span', { class: 'mk-n' }, label));
      m.addEventListener('click', () => blob && zoomRegion(blob, r, title, detail));
      box.append(m);
    };
    kErr.filter((e) => (e.page || 1) === pi + 1).forEach((e) => addMark(e, e.status === 'wrong' ? '' : 'unsure', e.n, `${e.n}. ${e.written} → ${e.correct}`, h('p', null, `${e.reason} · ${e.detail || ''}`)));
    if (w.setting.paper !== 'plain') genko.filter((g) => (g.page || 1) === pi + 1).forEach((g) => addMark(g, 'genko', '原' + g.n, `원고지 ${g.n}. ${g.name}`, h('p', null, g.detail)));
    wrap.append(sec(`사진 ${w.pages.length > 1 ? pi + 1 + '쪽 ' : ''}· 표시를 누르면 확대`, box,
      h('p', { class: 'hint' }, '빨간 테두리=틀린 한자, 회색 점선=판독 불확실, 노란 테두리=원고지 표기')));
  });

  wrap.append(sec('한자 오류',
    kErr.length ? h('ul', { class: 'fix-list' }, kErr.map((e) => h('li', null,
      h('div', { class: 'row wrap' }, h('span', { class: 'qa-num', style: e.status === 'wrong' ? {} : { background: 'var(--surface-2)', color: 'var(--muted)' } }, e.n),
        h('span', { class: ['tag', e.status === 'wrong' ? 'bad' : 'gray'] }, e.status === 'wrong' ? '틀림' : '판독 불확실'),
        h('span', { class: 'tag gray' }, e.reason),
        e.notJoyo && h('span', { class: 'tag warn' }, `상용한자 아님: ${e.notJoyo}`),
        h('span', { class: 'muted small' }, w.setting.paper === 'plain' ? `${e.row}줄 ${e.col}번째` : `${w.pages.length > 1 ? (e.page || 1) + '쪽 ' : ''}${e.row}${w.setting.paper === 'genko-v' ? '줄' : '행'} ${e.col}칸`)),
      h('p', { class: 'fix-line' }, '쓴 글자 ', h('del', null, e.written), ' → 바른 글자 ',
        ...[...e.correct].map((c) => (/[㐀-鿿]/.test(c) ? h('button', { type: 'button', class: 'pill btn-pill', onclick: () => openKanji(c) }, c) : c))),
      e.detail && h('p', { class: 'fix-why' }, e.detail))))
      : h('p', { class: 'note ok' }, '잘못 쓴 한자를 찾지 못했어요.')));

  wrap.append(sec('질문', furi(w.question?.ja || '', { cls: 'a-ja', tag: 'p' }), h('p', { class: 'a-ko' }, a.question_ko || w.question?.ko || '')));
  wrap.append(sec('내 답 (사진에서 읽은 글)', furi(w.text || '', { cls: 'a-ja pre', tag: 'p' }), h('p', { class: 'a-ko' }, a.answer_ko || '')));

  const cs = a.corrections || [];
  wrap.append(sec('문장 교정',
    cs.length ? h('ul', { class: 'fix-list' }, cs.map((c, i) => h('li', null,
      h('div', { class: 'row' }, h('span', { class: 'qa-num' }, i + 1)),
      h('p', { class: 'fix-line' }, h('del', null, furi(c.wrong)), ' → ', h('ins', null, furi(c.right))),
      h('p', { class: 'fix-why' }, c.reason),
      h('div', { class: 'listen-row' }, sayBtn('듣기', c.right),
        h('button', { type: 'button', class: 'ghost small', onclick: async () => (await import('./words.js')).quickAddWord({ orig: c.right, tags: ['작문'], note: c.reason }) }, icon('plus', 14), '단어장'),
        h('button', { type: 'button', class: 'ghost small', onclick: async () => (await import('./grammar.js')).quickAddGrammar({ pattern: c.right, note: `${c.wrong} → ${c.right}\n${c.reason}`, tags: ['작문'] }) }, icon('plus', 14), '문법')))))
      : h('p', { class: 'note ok' }, '고칠 문장이 없었어요.')));

  if (w.setting.paper !== 'plain') {
    const unit = w.setting.paper === 'genko-v' ? '줄' : '행';
    wrap.append(sec('원고지 표기',
      genko.length ? h('ul', { class: 'fix-list' }, genko.map((g) => h('li', null,
        h('div', { class: 'row wrap' }, h('span', { class: 'qa-num', style: { background: '#fff4c2', color: '#7a5d00' } }, g.n), h('span', { class: 'tag warn' }, g.name || RULE_NAME[g.rule]),
          h('span', { class: 'muted small' }, `${w.pages.length > 1 ? (g.page || 1) + '쪽 ' : ''}${g.row}${unit} ${g.col}칸`),
          !g.sure && h('span', { class: 'tag gray' }, '확인 필요'),
          h('span', { class: 'tag gray' }, g.source === 'ai' ? '사진 판단(AI)' : '자동 검사')),
        h('p', { class: 'fix-why' }, g.detail))))
        : h('p', { class: 'note ok' }, '켜 둔 원고지 규칙에 어긋난 곳이 없어요.'),
      h('p', { class: 'hint' }, '검사 항목은 설정 > 원고지 검사 항목에서 켜고 끌 수 있어요.')));
  }

  wrap.append(sec('교정본',
    furi(a.corrected_ja, { cls: 'a-ja', tag: 'p' }), h('p', { class: 'a-ko' }, a.corrected_ko || ''),
    h('div', { class: 'listen-row' }, sayBtn('듣기', a.corrected_ja), listenBtn('느리게', () => speak(a.corrected_ja, { rate: 0.8 })))));
  return wrap;
}

