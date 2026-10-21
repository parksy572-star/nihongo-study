// 면접·회화 답변 분석 화면 (연습 모드 결과, 실전 모드 결과, 기록 상세에서 함께 쓴다)
import { h, icon, toast } from './core.js';
import { db } from './db.js';
import { speak, playBlob, unlock, voiceSettings } from './tts.js';

export function listenBtn(label, play, cls = 'soft small') {
  const b = h('button', { type: 'button', class: cls }, icon('speaker', 16), label);
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    unlock();
    b.disabled = true;
    try { await play(); } catch (e) { toast('재생 실패: ' + (e?.message || e), 'err'); } finally { b.disabled = false; }
  });
  return b;
}

export const sayBtn = (label, text, voice) => listenBtn(label, () => speak(text, { voice }));

export async function playRecording(path) {
  const blob = await db.download(path);
  return playBlob(blob);
}

// 답변 원문에 교정 위치 밑줄 + 번호
export function underlined(text, corrections = []) {
  const marks = [];
  corrections.forEach((c, i) => {
    if (!c.wrong) return;
    let from = 0, idx;
    while ((idx = text.indexOf(c.wrong, from)) >= 0) {
      if (!marks.some((m) => idx < m.end && idx + c.wrong.length > m.start)) { marks.push({ start: idx, end: idx + c.wrong.length, n: i + 1 }); break; }
      from = idx + 1;
    }
  });
  marks.sort((a, b) => a.start - b.start);
  const out = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) out.push(text.slice(pos, m.start));
    out.push(h('span', { class: 'u-err', title: `교정 ${m.n}` }, text.slice(m.start, m.end), h('sup', { class: 'u-num' }, m.n)));
    pos = m.end;
  }
  out.push(text.slice(pos));
  return out;
}

const sec = (title, ...children) => h('section', { class: 'a-sec' }, h('h3', null, title), ...children);
const TYPE_TAG = { 장음: 'warn', 촉음: 'warn', ん: 'warn', '탁음·청음': 'bad', 요음: 'warn', 모음: 'bad', 억양: 'gray', '속도·끊어읽기': 'gray', 누락: 'bad', 추가: 'bad' };

/**
 * @param turn    { question_ja, other, category, is_followup }
 * @param attempt { audio, seconds, heard, heard_kana, answer, analysis, warnings }
 */
export function renderAnalysis(turn, attempt, { conversation = false, targetSeconds = 45 } = {}) {
  const a = attempt.analysis;
  const vs = voiceSettings();
  const wrap = h('div', { class: 'analysis' });
  if (!a) { wrap.append(h('p', { class: 'note' }, '아직 분석하지 않았어요.')); return wrap; }

  for (const w of attempt.warnings || []) wrap.append(h('p', { class: 'note warn' }, w));

  wrap.append(sec(conversation ? '상대의 말' : '질문',
    h('p', { class: 'a-ja', lang: 'ja' }, turn.question_ja),
    h('p', { class: 'a-ko' }, a.question_ko || turn.question_ko || ''),
    h('div', { class: 'listen-row' }, sayBtn('질문 듣기', turn.question_ja, vs.interviewer))));

  if (turn.other?.answer_ja && turn.order === 'other-first') {
    wrap.append(sec('먼저 답한 다른 지원자',
      h('p', { class: 'a-ja', lang: 'ja' }, turn.other.answer_ja),
      h('p', { class: 'a-ko' }, turn.other.answer_ko || ''),
      h('div', { class: 'listen-row' }, sayBtn('다시 듣기', turn.other.answer_ja, vs.other))));
  }

  const over = attempt.seconds > Math.max(60, targetSeconds * 1.33);
  wrap.append(sec('내 답변',
    h('p', { class: 'a-ja', lang: 'ja' }, underlined(attempt.answer || '', a.corrections)),
    h('p', { class: 'a-ko' }, a.answer_ko || ''),
    h('div', { class: 'row wrap' },
      attempt.audio && listenBtn('내 녹음', () => playRecording(attempt.audio)),
      h('span', { class: ['tag', over ? 'bad' : attempt.seconds > targetSeconds ? 'warn' : 'good'] },
        `${Math.round(attempt.seconds || 0)}초 / 목표 ${targetSeconds}초`))));

  // 발음
  const p = a.pronunciation || {};
  const issues = p.issues || [];
  wrap.append(sec('발음',
    h('div', { class: 'listen-row' },
      sayBtn('모범 발음', attempt.answer),
      attempt.audio && listenBtn('내 녹음', () => playRecording(attempt.audio)),
      sayBtn('AI가 들은 대로', attempt.heard_kana || attempt.heard)),
    h('p', { class: 'hint' }, "'AI가 들은 대로'는 AI가 받아 적은 글자를 그대로 읽어 줘요. 모범 발음과 다르게 들리는 곳이 고칠 부분이에요."),
    issues.length
      ? h('ul', { class: 'fix-list' }, issues.map((i) => h('li', null,
        h('div', { class: 'row wrap' }, h('span', { class: ['tag', TYPE_TAG[i.type] || ''] }, i.type),
          h('span', { class: 'fix-line', lang: 'ja' }, i.target, ' → 「', i.heard, '」로 들림')),
        h('p', { class: 'fix-why' }, i.tip),
        h('div', { class: 'listen-row' }, sayBtn('올바른 발음', i.target), sayBtn('들린 소리', i.heard)))))
      : h('p', { class: 'note ok' }, '단어 단위로 다르게 들린 곳은 없었어요.'),
    h('div', { class: 'eval-grid' },
      p.intonation && h('div', null, h('b', null, '억양'), h('span', null, p.intonation)),
      p.speed && h('div', null, h('b', null, '속도'), h('span', null, p.speed)),
      p.endings && h('div', null, h('b', null, '말끝'), h('span', null, p.endings))),
    p.overall && h('p', null, p.overall),
    h('p', { class: 'hint' }, `AI 확신도: ${({ high: '높음', medium: '보통', low: '낮음' })[p.confidence] || '—'} · 발음 평가는 참고용이에요.`)));

  // 교정
  const cs = a.corrections || [];
  wrap.append(sec('교정',
    cs.length
      ? h('ul', { class: 'fix-list' }, cs.map((c, i) => h('li', null,
        h('div', { class: 'row wrap' }, h('span', { class: 'qa-num' }, i + 1), c.kind && h('span', { class: 'tag gray' }, c.kind),
          !c.found && h('span', { class: 'tag warn', title: '내 답 원문에서 위치를 찾지 못했어요' }, '위치 불명')),
        h('p', { class: 'fix-line', lang: 'ja' }, h('del', null, c.wrong), ' → ', h('ins', null, c.right)),
        h('p', { class: 'fix-why' }, c.reason),
        h('div', { class: 'listen-row' },
          sayBtn('듣기', c.right),
          h('button', { type: 'button', class: 'ghost small', onclick: () => sendToWords(c) }, icon('plus', 14), '단어장'),
          h('button', { type: 'button', class: 'ghost small', onclick: () => sendToGrammar(c) }, icon('plus', 14), '문법')))))
      : h('p', { class: 'note ok' }, '고칠 표현이 없었어요.')));

  wrap.append(sec('다듬은 답변',
    h('p', { class: 'a-ja', lang: 'ja' }, a.refined_ja),
    h('p', { class: 'a-ko' }, a.refined_ko || ''),
    h('div', { class: 'listen-row' }, sayBtn('듣기', a.refined_ja), listenBtn('느리게', () => speak(a.refined_ja, { rate: 0.8 }))),
    h('p', { class: 'hint' }, '다듬은 답변을 매일 소리 내어 읽어 보세요. 기록 > 복습에서 다시 연습할 수 있어요.')));

  const e = a.evaluation || {};
  wrap.append(sec('한줄 평가',
    e.summary && h('p', { style: { fontWeight: 650 } }, e.summary),
    h('div', { class: 'eval-grid' },
      [['질문 의도', e.intent], ['경어', e.keigo], ['결론 먼저', e.conclusion_first], ['길이', e.length], ['겹침', e.overlap]]
        .filter(([, v]) => v && !(v === '해당 없음' && conversation)).map(([k, v]) => h('div', null, h('b', null, k), h('span', null, v))))));
  return wrap;
}

async function sendToWords(c) {
  const { quickAddWord } = await import('./views/words.js');
  quickAddWord({ orig: c.whole ? '' : c.right, example: c.whole ? c.right : '', exampleKo: c.whole ? c.reason : '', tags: ['면접'], note: c.whole ? '' : c.reason });
}
async function sendToGrammar(c) {
  const { quickAddGrammar } = await import('./views/grammar.js');
  quickAddGrammar({ pattern: c.right, note: `${c.wrong} → ${c.right}\n${c.reason}`, tags: ['교정'] });
}
