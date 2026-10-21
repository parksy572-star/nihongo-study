// 회화·면접 공통 값
import { db, DEMO } from './db.js';
import { uid } from './core.js';
import { OTHER_PERSONAS } from '../ai-rules.js';

export const DEFAULT_INTERVIEW = {
  type: 'interview',
  name: '文化服装学院 服装科 留学生入試',
  school: '文化服装学院',
  dept: '服装科（2年課程）留学生入試',
  group: true,
  place: '대면',
  tone: '정중체·경어',
  resume: '한국에서 패션디자인 학사 취득(학점은행제). 패션 브랜드 인턴 6개월. 아이돌 무대의상 제작 경험. 신입 유학생.',
  builtin: true,
};

export const SCENES = [
  ['가게', '洋服店の店員'], ['병원', '病院の受付・医師'], ['직장 동료와 잡담', '職場の同僚'],
  ['길 묻기', '通りすがりの人'], ['학교 선생님', '専門学校の先生'], ['아르바이트 면접', 'アルバイト先の店長'],
];
export const TONES = ['반말', '정중체', '경어'];

export function presets(type) {
  const own = db.all('preset').filter((r) => r.data.type === type).map((r) => ({ ...r.data, id: r.id }));
  if (type === 'interview' && !own.some((p) => p.replacesBuiltin)) return [DEFAULT_INTERVIEW, ...own];
  return own;
}

// 실전 모드 대본(면접관의 정해진 말). AI 요청 없이 진행해 한도를 아낀다.
export const SCRIPT = {
  enter: 'どうぞ、お入りください。',
  seat: 'どうぞ、おかけください。それでは、これから面接を始めます。よろしくお願いします。',
  closing: '時間になりましたので、これで面接を終わります。お疲れさまでした。',
  enterHint: '入室のあいさつ（例：失礼いたします。〇〇と申します。よろしくお願いいたします。）',
  closeHint: '退室のあいさつ（例：本日はありがとうございました。失礼いたします。）',
};

export function newTalk({ setting, mode, kind }) {
  return {
    sid: uid(),
    kind,                         // 'interview' | 'conversation'
    mode,                         // 'practice' | 'real'
    setting,
    group: kind === 'interview' && !!setting.group,
    persona: OTHER_PERSONAS[Math.floor(Math.random() * OTHER_PERSONAS.length)],
    startedAt: new Date().toISOString(),
    // 체험 모드에서만 ?dur=초 로 실전 시간을 줄여 시험할 수 있다
    durationSec: (DEMO && Number(new URLSearchParams(location.search).get('dur'))) || 600,
    phase: mode === 'real' ? 'lobby' : 'next',
    turns: [],
    cur: -1,
  };
}

export function talkTitle(t) {
  const d = new Date(t.startedAt);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (t.kind === 'conversation') return `${md} 회화 · ${t.setting.scene || '일상'}`;
  return `${md} ${t.setting.school || '면접'} ${t.mode === 'real' ? '실전 10분' : '연습'}${t.group ? ' (2인)' : ''}`;
}

export const lastAttempt = (turn) => turn.attempts?.[turn.attempts.length - 1] || null;
