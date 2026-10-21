// 회화·면접 첫 화면: 이어서 하기, 새로 시작(상황 설정·프리셋), 기록, 발음 주의 단어
import { h, icon, go, segmented, chipToggle, field, toast, confirmDialog, modal, fmtDate, emptyState, replace, store } from '../core.js';
import { db } from '../db.js';
import { viewToggle, viewMode, targetSeconds } from '../prefs.js';
import { DEFAULT_INTERVIEW, SCENES, TONES, presets, newTalk, lastAttempt } from '../talk-common.js';
import { sayBtn } from '../analysis-ui.js';

export function talkHomeView(_p, query, ctx) {
  const el = h('div', { class: 'stack' });
  let tab = query.tab || store.get('talkTab', 'new');

  const draw = () => {
    replace(el,
      resumeCard(),
      segmented([['new', '새로 시작'], ['records', '기록'], ['watch', '발음 주의']], tab, (v) => { tab = v; store.set('talkTab', v); draw(); }),
      tab === 'new' ? setupPanel() : tab === 'records' ? recordsPanel(draw) : watchPanel());
  };
  draw();
  ctx.onDb((e) => { if (['progress', 'session', 'preset'].includes(e.kind) || e.type === 'reset') { if (!el.contains(document.activeElement) || e.kind === 'progress') draw(); } });
  return { el, title: '회화·면접' };
}

function resumeCard() {
  const r = db.progress('talk');
  if (!r) return null;
  const t = r.data;
  const answered = t.turns.filter((x) => lastAttempt(x)).length;
  return h('div', { class: 'panel', style: { borderColor: 'var(--accent)' } },
    h('div', { class: 'row between wrap' },
      h('div', { class: 'stack tight' },
        h('b', null, '진행 중인 ' + (t.kind === 'conversation' ? '회화' : '면접')),
        h('span', { class: 'muted small' }, `${t.mode === 'real' ? '실전 10분' : '연습'}${t.group ? ' · 2인 그룹' : ''} · 답변 ${answered}개 · ${t._dev || ''}에서 ${fmtDate(r.updated_at, true)}`)),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'ghost small', onclick: async () => { if (await confirmDialog('진행 중인 기록을 버릴까요? 답변 녹음도 지워져요.', { danger: true, ok: '버리기' })) { db.clearProgress('talk'); } } }, '버리기'),
        h('button', { type: 'button', onclick: () => go('/talk/run') }, '이어서 하기'))));
}

/* ---------------- 새로 시작 ---------------- */

function setupPanel() {
  const last = db.settings().talkSetup || {};
  let kind = last.kind || 'interview';
  let mode = last.mode || 'practice';
  const box = h('div', { class: 'stack' });

  const draw = () => {
    const list = presets(kind);
    let cur = list.find((p) => p.id === last.presetId) || list[0] || (kind === 'interview' ? DEFAULT_INTERVIEW : { type: 'conversation', scene: SCENES[0][0], role: SCENES[0][1], tone: '정중체', name: '' });
    const form = kind === 'interview' ? interviewForm(cur) : conversationForm(cur);

    replace(box,
      h('div', { class: 'panel' },
        h('div', { class: 'row between wrap' },
          segmented([['interview', '면접'], ['conversation', '회화']], kind, (v) => { kind = v; last.presetId = null; draw(); }),
          kind === 'interview' && segmented([['practice', '연습'], ['real', '실전 10분']], mode, (v) => { mode = v; draw(); })),
        h('p', { class: 'hint' }, kind === 'interview'
          ? (mode === 'real' ? '10분 타이머가 멈추지 않고 돌아요. 입실 → 인사 → 질문 → 마무리 인사까지 한 번에 하고, 끝난 뒤 문답 전체를 분석해요.'
            : '질문 하나씩 답하고 바로 분석·교정을 받아요. 다음 질문으로 갈지 매번 골라요.')
          : 'AI가 상대역(점원·동료 등)으로 말을 걸어요. 질문은 음성으로만 나와요.'),
        list.length > 0 && h('div', { class: 'stack tight' },
          h('span', { class: 'field-label' }, '프리셋'),
          h('div', { class: 'chips' }, list.map((p) => chipToggle(p.name || p.scene || '이름 없음', p === cur, () => { last.presetId = p.id || null; cur = p; draw(); })))),
        form.el,
        h('div', { class: 'row between wrap' },
          h('span', { class: 'muted small' }, `답변 목표 ${targetSeconds()}초 (설정에서 변경)`),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'ghost small', onclick: () => savePreset(kind, form.value(), cur) }, '프리셋으로 저장'),
            cur.id && h('button', { type: 'button', class: 'ghost small', onclick: async () => { if (await confirmDialog(`프리셋 '${cur.name}'을 지울까요?`, { danger: true, ok: '지우기' })) db.remove(cur.id); } }, '삭제'))),
        h('button', {
          type: 'button', class: 'wide',
          onclick: () => {
            if (db.progress('talk')) { toast('진행 중인 기록이 있어요. 먼저 이어서 하거나 버려 주세요.', 'err'); return; }
            const setting = form.value();
            db.setSettings({ talkSetup: { kind, mode: kind === 'interview' ? mode : 'practice', presetId: cur.id || null } });
            db.saveProgress('talk', newTalk({ setting, mode: kind === 'interview' ? mode : 'practice', kind }));
            go('/talk/run');
          },
        }, icon('mic', 18), kind === 'interview' ? (mode === 'real' ? '실전 면접 시작' : '면접 연습 시작') : '회화 시작')));
  };
  draw();
  return box;
}

function interviewForm(p) {
  const school = h('input', { value: p.school || '' });
  const dept = h('input', { value: p.dept || '' });
  const resume = h('textarea', { rows: 3 }, p.resume || '');
  let group = p.group !== false;
  let place = p.place || '대면';
  let tone = p.tone || '정중체·경어';
  const el = h('div', { class: 'stack' },
    field('학교·회사', school), field('학과·직무', dept),
    h('div', { class: 'row wrap' },
      segmented([[true, '2인 그룹'], [false, '1:1']], group, (v) => { group = v; }),
      segmented([['대면', '대면'], ['온라인', '온라인']], place, (v) => { place = v; })),
    field('내 말투', segmented([['정중체·경어', '정중체·경어'], ['정중체', '정중체']], tone, (v) => { tone = v; })),
    field('이력 요약', resume, '이름·학교명·연락처는 넣지 마세요(무료 등급은 입력이 Google 제품 개선에 쓰일 수 있어요).'));
  return {
    el,
    value: () => ({ type: 'interview', name: p.name, school: school.value.trim(), dept: dept.value.trim(), group, place, tone, resume: resume.value.trim() }),
  };
}

function conversationForm(p) {
  const scene = h('input', { value: p.scene || '' , placeholder: '예: 옷가게에서 사이즈 묻기' });
  const role = h('input', { value: p.role || '', placeholder: '예: 洋服店の店員' });
  let tone = p.tone || '정중체';
  const el = h('div', { class: 'stack' },
    h('div', { class: 'chips' }, SCENES.map(([s, r]) => h('button', { type: 'button', class: 'chip', onclick: () => { scene.value = s; role.value = r; } }, s))),
    field('장면', scene), field('AI 역할', role),
    field('말투', segmented(TONES.map((t) => [t, t]), tone, (v) => { tone = v; })));
  return { el, value: () => ({ type: 'conversation', name: p.name, scene: scene.value.trim() || '일상 대화', role: role.value.trim() || '相手', tone }) };
}

async function savePreset(type, value, cur) {
  const name = h('input', { value: cur.builtin ? cur.name + ' (내 설정)' : (cur.name || value.scene || '') });
  const ok = await modal({ title: '프리셋 저장', body: field('이름', name), actions: [{ label: '취소', value: false }, { label: '저장', value: true, primary: true }] });
  if (!ok) return;
  const data = { ...value, type, name: name.value.trim() || '내 프리셋' };
  db.put('preset', data, cur.id && !cur.builtin ? cur.id : null);
  toast('프리셋을 저장했어요');
}

/* ---------------- 기록 ---------------- */

export function sessionStats(s) {
  const turns = s.turns || [];
  const fixes = turns.reduce((n, t) => n + (lastAttempt(t)?.analysis?.corrections?.length || 0), 0);
  return { q: turns.length, fixes };
}

function recordsPanel() {
  const box = h('div', { class: 'stack' });
  const sessions = db.all('session').sort((a, b) => (b.data.startedAt || b.created_at).localeCompare(a.data.startedAt || a.created_at));
  if (!sessions.length) return emptyState('저장한 면접·회화 기록이 아직 없어요.');
  let mode = viewMode('talkRecords');
  const listEl = h('div');
  const draw = () => {
    if (mode === 'list') {
      replace(listEl, h('div', { class: 'list' }, sessions.map((r) => {
        const st = sessionStats(r.data);
        return h('div', { class: 'item link', onclick: () => go('/talk/session/' + r.id) },
          h('div', { class: 'item-main' },
            h('span', { class: 'item-title' }, r.data.title),
            h('span', { class: 'item-sub' }, `${fmtDate(r.data.startedAt || r.created_at)} · 질문 ${st.q} · 교정 ${st.fixes}`)),
          icon('right', 18));
      })));
    } else {
      replace(listEl, h('div', { class: 'cards' }, sessions.map((r) => sessionCard(r))));
    }
  };
  draw();
  replace(box,
    h('div', { class: 'toolbar' }, h('span', { class: 'count' }, `기록 ${sessions.length}개`),
      h('button', { type: 'button', class: 'soft small', onclick: () => go('/talk/review') }, icon('refresh', 16), '복습 모드')),
    listEl,
    h('div', { class: 'bottom-bar' }, viewToggle('talkRecords', (m) => { mode = m; draw(); }), h('span')));
  return box;
}

function sessionCard(r) {
  const s = r.data;
  const st = sessionStats(s);
  const body = h('div', { class: 'stack tight', hidden: true });
  const card = h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('div', { class: 'stack tight' }, h('b', null, s.title), h('span', { class: 'muted small' }, `${fmtDate(s.startedAt || r.created_at, true)} · 질문 ${st.q} · 교정 ${st.fixes}`)),
      h('button', { type: 'button', class: 'ghost small', onclick: () => { body.hidden = !body.hidden; } }, '펼치기')),
    body);
  (s.turns || []).forEach((t, i) => {
    const a = lastAttempt(t);
    body.append(h('div', { class: 'qa', style: { padding: '8px 0', borderTop: '1px solid var(--line)' } },
      h('div', { class: 'qa-head' }, h('span', { class: 'qa-num' }, i + 1), h('div', { class: 'stack tight grow' },
        h('span', { class: 'jp' }, t.question_ja), h('span', { class: 'muted small' }, a?.analysis?.question_ko || ''))),
      a && h('p', { class: 'jp small' }, a.answer),
      a?.analysis?.refined_ja && h('p', { class: 'jp small', style: { color: 'var(--good)' } }, '→ ', a.analysis.refined_ja)));
  });
  body.append(h('button', { type: 'button', class: 'ghost small', onclick: () => go('/talk/session/' + r.id) }, '자세히 보기'));
  return card;
}

/* ---------------- 발음 주의 단어 ---------------- */

export function pronunciationWatch() {
  const map = new Map();
  for (const r of db.all('session')) {
    for (const t of r.data.turns || []) {
      for (const at of t.attempts || []) {
        for (const i of at.analysis?.pronunciation?.issues || []) {
          const key = String(i.target || '').trim();
          if (!key || ['억양', '속도·끊어읽기'].includes(i.type)) continue;
          const m = map.get(key) || { target: key, count: 0, types: new Set(), heard: new Set(), tips: [], sessions: new Set() };
          m.count++; m.types.add(i.type); if (i.heard) m.heard.add(i.heard); if (i.tip && m.tips.length < 2) m.tips.push(i.tip); m.sessions.add(r.id);
          map.set(key, m);
        }
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function watchPanel() {
  const all = pronunciationWatch();
  const repeated = all.filter((w) => w.count >= 2);
  const once = all.filter((w) => w.count < 2);
  if (!all.length) return emptyState('아직 발음 지적이 없어요. 면접 연습을 하면 여러 번 지적된 단어가 여기에 모여요.');
  const row = (w) => h('div', { class: 'item' },
    h('div', { class: 'item-main' },
      h('span', { class: 'item-title jp' }, w.target, ' ', h('span', { class: 'tag ' + (w.count >= 2 ? 'bad' : 'gray') }, `${w.count}번`)),
      h('span', { class: 'item-sub' }, [...w.types].join('·'), ' · 들린 소리: ', h('span', { class: 'jp' }, [...w.heard].slice(0, 3).join(', '))),
      w.tips[0] && h('span', { class: 'item-sub' }, w.tips[0])),
    h('div', { class: 'item-actions' },
      sayBtn('', w.target),
      h('button', { type: 'button', class: 'ghost small', onclick: async () => {
        const { quickAddWord } = await import('./words.js');
        quickAddWord({ orig: w.target, tags: ['발음주의'] });
      } }, icon('plus', 14), '단어장')));
  return h('div', { class: 'stack' },
    h('p', { class: 'note' }, 'AI 발음 평가는 참고용이에요. 같은 지적이 여러 번 나온 단어부터 단어장(태그: 발음주의)으로 보내 매일 테스트하세요.'),
    repeated.length > 0 && h('h3', { class: 'group-title' }, '여러 번 지적된 단어'),
    repeated.length > 0 && h('div', { class: 'list' }, repeated.map(row)),
    once.length > 0 && h('h3', { class: 'group-title' }, '한 번 지적된 단어'),
    once.length > 0 && h('div', { class: 'list' }, once.slice(0, 40).map(row)));
}
