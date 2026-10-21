// 면접·회화 기록 상세와 복습 모드
import { h, icon, go, replace, toast, confirmDialog, modal, field, fmtDate, mmss, emptyState, chipToggle } from '../core.js';
import { db } from '../db.js';
import { runTask, blobToBase64, busy, blobKey } from '../ai.js';
import { speak, unlock, stopAll, voiceSettings, playBlob } from '../tts.js';
import { Recorder, toWav16k, speechLevel } from '../../audio.js';
import { pronunciationPrompt, PRONUNCIATION_SCHEMA, checkPronunciation, interviewAnalyzePrompt, INTERVIEW_ANALYZE_SCHEMA, checkInterviewAnalysis } from '../../ai-rules.js';
import { renderAnalysis, listenBtn, sayBtn, playRecording } from '../analysis-ui.js';
import { lastAttempt } from '../talk-common.js';
import { sessionStats } from './talk.js';
import { RoundDeck } from '../deck.js';
import { streakSetting } from '../prefs.js';
import { kataToHira } from '../kana.js';
import { furi } from '../furigana.js';

/* ---------------- 기록 상세 ---------------- */

export function sessionView({ id }, _q, ctx) {
  const el = h('div', { class: 'stack' });
  const draw = () => {
    const r = db.get(id);
    if (!r) { replace(el, emptyState('기록을 찾을 수 없어요.', h('button', { type: 'button', onclick: () => go('/talk?tab=records') }, '기록 목록'))); return; }
    const s = r.data;
    const st = sessionStats(s);
    const conv = s.kind === 'conversation';
    replace(el,
      h('div', { class: 'panel stack' },
        h('div', { class: 'row between wrap' },
          h('div', { class: 'stack tight' }, h('h2', null, s.title), h('span', { class: 'muted small' },
            `${fmtDate(s.startedAt || r.created_at, true)} · ${s.mode === 'real' ? '실전' : '연습'}${s.group ? ' · 2인 그룹' : ''} · 질문 ${st.q} · 교정 ${st.fixes}`)),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'icon-btn', title: '제목 바꾸기', onclick: () => rename(r) }, icon('edit', 18)),
            h('button', { type: 'button', class: 'icon-btn', title: '삭제', onclick: () => removeSession(r) }, icon('trash', 18)))),
        s.group && s.persona && h('p', { class: 'hint jp' }, '다른 지원자: ', s.persona),
        h('button', { type: 'button', class: 'soft', onclick: () => go('/talk/review?s=' + r.id) }, icon('refresh', 16), '이 기록으로 복습')),
      ...(s.turns || []).map((t, i) => turnPanel(r, t, i, conv)));
  };
  draw();
  ctx.onDb((e) => { if (e.id === id && e.remote) draw(); });
  return { el, title: '면접 기록', back: '/talk?tab=records' };
}

function turnPanel(r, t, i, conv) {
  const at = lastAttempt(t);
  const body = h('div', { hidden: i > 0 });
  const fill = () => {
    replace(body);
    if (!at) return;
    if (at.analysis) body.append(renderAnalysis(t, at, { conversation: conv, targetSeconds: r.data.targetSeconds || 45 }));
    else {
      const btn = h('button', { type: 'button' }, '지금 분석하기');
      btn.onclick = async () => {
        const done = busy(btn, '분석 중…');
        try {
          const wav = await db.download(at.audio);
          const res = await runTask({
            task: 'interviewAnalyze',
            prompt: interviewAnalyzePrompt({ setting: r.data.setting, question: t.question_ja, heard: at.heard, answer: at.answer, seconds: at.seconds, targetSeconds: r.data.targetSeconds || 45, otherAnswer: t.order === 'other-first' ? t.other?.answer_ja : '', conversation: conv }),
            media: [{ mimeType: 'audio/wav', data: await blobToBase64(wav) }],
            schema: INTERVIEW_ANALYZE_SCHEMA, check: (j) => checkInterviewAnalysis(j, at.answer),
            cacheKey: `${at.key || await blobKey(wav)}|${await blobKey(new Blob([at.answer + '|' + t.question_ja + '|' + (t.order === 'other-first' ? t.other?.answer_ja || '' : '') + '|' + (r.data.targetSeconds || 45)]))}`,
          });
          at.analysis = res.result; at.warnings = res.warnings;
          db.patch(r.id, { turns: r.data.turns });
          fill();
        } catch (e) { toast(e.message, 'err'); } finally { done(); }
      };
      body.append(h('p', { class: 'jp' }, at.answer), btn);
    }
    if (t.attempts.length > 1) {
      body.append(h('details', { class: 'a-sec' }, h('summary', null, `이전 답변 ${t.attempts.length - 1}개`),
        ...t.attempts.slice(0, -1).map((p, k) => h('div', { class: 'stack tight', style: { padding: '6px 0' } },
          h('b', { class: 'small' }, `${k + 1}번째 (${Math.round(p.seconds)}초)`), h('p', { class: 'jp small' }, p.answer),
          p.audio && listenBtn('녹음', () => playRecording(p.audio))))));
    }
  };
  fill();
  return h('div', { class: 'panel stack' },
    h('button', { type: 'button', class: 'plain', style: { justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left', height: 'auto' }, onclick: () => { body.hidden = !body.hidden; } },
      h('span', { class: 'qa-num' }, i + 1),
      h('span', { class: 'stack tight grow' }, furi(t.question_ja),
        h('span', { class: 'muted small' }, [t.category, t.is_followup && '꼬리 질문', at && `${Math.round(at.seconds)}초`, t.replays && `다시 듣기 ${t.replays}회`].filter(Boolean).join(' · ')))),
    body);
}

async function rename(r) {
  const input = h('input', { value: r.data.title });
  const ok = await modal({ title: '제목 바꾸기', body: field('제목', input), actions: [{ label: '취소', value: false }, { label: '저장', value: true, primary: true }] });
  if (ok) db.patch(r.id, { title: input.value.trim() || r.data.title });
}

async function removeSession(r) {
  if (!(await confirmDialog('이 기록과 녹음을 모두 지울까요? 되돌릴 수 없어요.', { danger: true, ok: '지우기' }))) return;
  const paths = (r.data.turns || []).flatMap((t) => (t.attempts || []).map((a) => a.audio));
  db.remove(r.id);
  db.removeFiles(paths);
  go('/talk?tab=records', { replace: true });
}

/* ---------------- 복습 모드 ---------------- */

function reviewItems(filterIds) {
  const items = [];
  for (const r of db.all('session')) {
    if (filterIds && !filterIds.includes(r.id)) continue;
    for (const t of r.data.turns || []) {
      const at = lastAttempt(t);
      if (t.scripted || !at) continue;
      items.push({ key: `${r.id}:${t.id}`, sid: r.id, title: r.data.title, turn: t, at, conv: r.data.kind === 'conversation' });
    }
  }
  return items;
}

export function reviewView(_p, query, ctx) {
  const el = h('div', { class: 'stack' });
  const prog = db.progress('talkReview');
  if (prog && !query.s) { runReview(el, prog.data, ctx); return { el, title: '면접 복습', back: '/talk?tab=records', immersive: true, cleanup: () => el._cleanup?.() }; }

  const sessions = db.all('session').sort((a, b) => (b.data.startedAt || '').localeCompare(a.data.startedAt || ''));
  if (!sessions.length) { el.append(emptyState('복습할 기록이 없어요.')); return { el, title: '면접 복습', back: '/talk?tab=records' }; }
  const chosen = new Set(query.s ? [query.s] : sessions.slice(0, 5).map((r) => r.id));
  let weakOnly = false;
  const count = h('span', { class: 'muted small' });
  const upd = () => {
    const items = pick();
    count.textContent = `질문 ${items.length}개`;
  };
  const pick = () => reviewItems([...chosen]).filter((it) => !weakOnly || isWeak(it));
  el.append(h('div', { class: 'panel stack' },
    h('h2', null, '복습할 기록'),
    h('p', { class: 'hint' }, '저장한 질문을 음성으로 다시 듣고 답한 뒤 다듬은 답변과 비교해요. 모르는 질문은 단어 테스트처럼 다시 나와요.'),
    h('div', { class: 'stack tight' }, sessions.map((r) => {
      const cb = h('input', { type: 'checkbox', checked: chosen.has(r.id) });
      cb.onchange = () => { if (cb.checked) chosen.add(r.id); else chosen.delete(r.id); upd(); };
      return h('label', { class: 'check' }, cb, h('span', null, r.data.title, h('span', { class: 'muted small' }, ' · ' + fmtDate(r.data.startedAt || r.created_at))));
    })),
    chipToggle('약한 질문만 (교정 3개 이상·1분 초과·발음 지적 2개 이상)', false, (v) => { weakOnly = v; upd(); }),
    h('div', { class: 'row between' }, count,
      h('button', { type: 'button', onclick: () => {
        const items = pick();
        if (!items.length) { toast('고른 기록에 질문이 없어요', 'err'); return; }
        const state = { keys: items.map((i) => i.key), deck: new RoundDeck({ ids: items.map((i) => i.key), streak: streakSetting() }).state, startedAt: new Date().toISOString() };
        db.saveProgress('talkReview', state);
        replace(el);
        runReview(el, state, ctx);
      } }, '복습 시작'))));
  upd();
  return { el, title: '면접 복습', back: '/talk?tab=records', immersive: true, cleanup: () => el._cleanup?.() };
}

function isWeak(it) {
  const a = it.at.analysis;
  return !a || (a.corrections?.length || 0) >= 3 || it.at.seconds > 60 || (a.pronunciation?.issues?.length || 0) >= 2;
}

function runReview(el, state, ctx) {
  const all = new Map(reviewItems().map((i) => [i.key, i]));
  const deck = new RoundDeck({ state: state.deck });
  const vs = voiceSettings();
  const recorder = new Recorder();
  let revealed = false;
  let myWav = null;
  let t0 = Date.now();
  const save = () => { state.deck = deck.state; db.saveProgress('talkReview', state); };

  const draw = () => {
    revealed = false; myWav = null;
    stopAll();
    if (deck.finished) return finishView();
    const key = deck.current();
    const it = all.get(key);
    if (!it) { deck.answer(true); save(); return draw(); }
    const p = deck.progress();
    const refined = it.at.analysis?.refined_ja || it.at.answer;
    const reveal = h('div', { class: 'stack', hidden: true },
      h('section', { class: 'a-sec' }, h('h3', null, '질문'), furi(it.turn.question_ja, { cls: 'a-ja', tag: 'p' }), h('p', { class: 'a-ko' }, it.at.analysis?.question_ko || '')),
      h('section', { class: 'a-sec' }, h('h3', null, '다듬은 답변'), furi(refined, { cls: 'a-ja', tag: 'p' }), h('p', { class: 'a-ko' }, it.at.analysis?.refined_ko || ''),
        h('div', { class: 'listen-row' }, sayBtn('듣기', refined), listenBtn('느리게', () => speak(refined, { rate: 0.8 })))),
      h('section', { class: 'a-sec' }, h('h3', null, '그때 내 답'), furi(it.at.answer, { cls: 'a-ja', tag: 'p' }),
        h('div', { class: 'listen-row' }, it.at.audio && listenBtn('그때 녹음', () => playRecording(it.at.audio)))));
    const recBtn = h('button', { type: 'button', class: 'plain' }, icon('mic', 16), '소리 내어 답하기');
    const recMsg = h('p', { class: 'msg' });
    const pronBox = h('div', { class: 'stack' });
    recBtn.onclick = async () => {
      if (!recorder.recording) {
        unlock(); stopAll();
        try { await recorder.start(); } catch { toast('마이크를 쓸 수 없어요', 'err'); return; }
        recBtn.replaceChildren(icon('stop', 16), '녹음 끝내기'); recBtn.className = 'danger';
        recMsg.textContent = '녹음 중…';
        return;
      }
      const res = await recorder.stop();
      recBtn.replaceChildren(icon('mic', 16), '다시 녹음'); recBtn.className = 'plain';
      if (!res || res.seconds < 0.6) { recMsg.textContent = '너무 짧아요'; return; }
      myWav = await toWav16k(res.blob);
      const lv = await speechLevel(myWav);
      recMsg.textContent = lv.silent ? '말소리가 거의 안 들려요.' : `${res.seconds.toFixed(1)}초 녹음했어요.`;
      replace(pronBox,
        h('div', { class: 'listen-row' }, listenBtn('내 녹음', () => playBlob(myWav)),
          (() => {
            const b = h('button', { type: 'button', class: 'soft small' }, '다듬은 답변과 발음 비교');
            b.onclick = () => checkPron(b, refined, myWav, res.seconds);
            return b;
          })()));
    };
    const checkPron = async (b, target, wav, seconds) => {
      const done = busy(b, '분석 중…');
      try {
        const out = await runTask({
          task: 'pronunciation', prompt: pronunciationPrompt(target, Math.round(seconds)),
          media: [{ mimeType: 'audio/wav', data: await blobToBase64(wav) }],
          schema: PRONUNCIATION_SCHEMA, check: (j) => checkPronunciation(j, ''), cacheKey: await blobKey(wav, target),
        });
        const j = out.result;
        const chk = checkPronunciation(j, kataToHira(it.at.analysis?.refined_kana || ''));
        replace(pronBox,
          ...chk.warnings.map((w) => h('p', { class: 'note warn' }, w)),
          h('p', { class: 'a-ja' }, '들린 문장: ', j.transcript || '(없음)'),
          h('div', { class: 'listen-row' }, listenBtn('내 녹음', () => playBlob(wav)), sayBtn('모범 발음', target), sayBtn('AI가 들은 대로', j.transcript_kana || j.transcript)),
          (j.issues || []).length ? h('ul', { class: 'fix-list' }, j.issues.map((i) => h('li', null,
            h('div', { class: 'row wrap' }, h('span', { class: 'tag' }, i.type), h('span', { class: 'fix-line' }, i.target, ' → 「', i.heard, '」')),
            h('p', { class: 'fix-why' }, i.tip), h('div', { class: 'listen-row' }, sayBtn('올바른 발음', i.target), sayBtn('들린 소리', i.heard)))))
            : h('p', { class: 'note ok' }, '다르게 들린 단어가 없었어요.'),
          j.overall && h('p', null, j.overall));
      } catch (e) { toast(e.message, 'err'); done(); }
    };
    const showBtn = h('button', { type: 'button', class: 'soft wide', onclick: () => { revealed = true; reveal.hidden = false; showBtn.hidden = true; } }, icon('eye', 16), '질문·다듬은 답변 보기');
    replace(el,
      h('div', { class: 'panel stack' },
        h('div', { class: 'row between' }, h('span', { class: 'muted small' }, `${p.round}판`), h('b', null, `${p.known} / ${p.total}`), h('span', { class: 'muted small' }, mmss((Date.now() - t0) / 1000))),
        h('div', { class: 'bar' }, h('i', { style: { width: (p.known / Math.max(1, p.total)) * 100 + '%' } }))),
      h('div', { class: 'panel stack' },
        h('div', { class: 'row between' }, h('span', { class: 'tag gray' }, it.turn.category || '질문'), h('span', { class: 'muted small' }, it.title)),
        h('p', { class: 'center muted' }, '질문을 듣고 소리 내어 답해 보세요.'),
        h('div', { class: 'row wrap', style: { justifyContent: 'center' } },
          listenBtn('질문 듣기', () => speak(it.turn.question_ja, { voice: vs.interviewer }), ''),
          listenBtn('느리게', () => speak(it.turn.question_ja, { voice: vs.interviewer, rate: 0.8 }), 'plain')),
        h('div', { class: 'row', style: { justifyContent: 'center' } }, recBtn), recMsg, pronBox,
        showBtn, reveal),
      h('div', { class: 'test-controls' },
        h('button', { type: 'button', class: 'big-round no', title: '모름 (←)', onclick: () => mark(false) }, icon('left', 28)),
        h('button', { type: 'button', class: 'round', title: '되돌리기 (Z)', onclick: () => { if (deck.undo()) { save(); draw(); } } }, icon('undo', 20)),
        h('button', { type: 'button', class: 'big-round yes', title: '앎 (→)', onclick: () => mark(true) }, icon('right', 28))));
    speak(it.turn.question_ja, { voice: vs.interviewer }).catch(() => {});
  };
  const mark = (known) => {
    if (recorder.recording) { toast('녹음을 먼저 끝내 주세요'); return; }
    deck.answer(known); save(); draw();
  };
  const onKey = (e) => {
    if (e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowRight') mark(true);
    else if (e.key === 'ArrowLeft') mark(false);
    else if (e.key === 'z' || e.key === 'Z') { if (deck.undo()) { save(); draw(); } }
  };
  document.addEventListener('keydown', onKey);
  el._cleanup = () => { document.removeEventListener('keydown', onKey); stopAll(); if (recorder.recording) recorder.stop(); };
  const finishView = () => {
    document.removeEventListener('keydown', onKey);
    const hard = deck.hard(1).map((x) => all.get(x.id)).filter(Boolean);
    db.clearProgress('talkReview');
    replace(el, h('div', { class: 'panel stack' },
      h('h2', null, '복습 완료'),
      h('div', { class: 'stat' },
        h('div', null, h('b', null, deck.state.total), h('span', null, '질문')),
        h('div', null, h('b', null, deck.state.round), h('span', null, '판')),
        h('div', null, h('b', null, mmss((Date.now() - new Date(state.startedAt).getTime()) / 1000)), h('span', null, '걸린 시간'))),
      hard.length > 0 && h('h3', { class: 'group-title' }, '모른다고 한 질문'),
      ...hard.map((it) => h('p', { class: 'jp small' }, '· ', it.turn.question_ja)),
      h('button', { type: 'button', onclick: () => go('/talk?tab=records') }, '기록으로')));
  };
  draw();
}
