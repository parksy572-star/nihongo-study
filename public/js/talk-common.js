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
  place: '화상',
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
const SCRIPTS = {
  화상: {
    enter: 'こんにちは。画面と音声は問題なく届いていますか。',
    enterKo: '안녕하세요. 화면과 음성은 문제없이 전달되고 있나요?',
    seat: 'ありがとうございます。それでは、これからオンライン面接を始めます。よろしくお願いします。',
    closing: '時間になりましたので、これで面接を終わります。お疲れさまでした。',
    closingKo: '시간이 되어 면접을 마칩니다. 수고하셨습니다.',
    enterHint: '접속 인사 (예: はい、よく聞こえております。〇〇と申します。本日はどうぞよろしくお願いいたします。)',
    closeHint: '마무리 인사 (예: 本日はお時間をいただき、ありがとうございました。失礼いたします。) — 인사한 뒤 화면에서 나가요',
    lobby: ['카메라 눈높이·밝은 조명·조용한 방을 준비하고, 화면이 아니라 카메라를 보며 말하는 연습을 하세요.', '화상 면접은 소리가 조금 늦게 전달돼요. 질문이 끝난 뒤 한 박자 쉬고 답하세요.'],
    enterLabel: '접속하기 (타이머 시작)',
    enterTitle: '접속',
    closeTitle: '퇴장',
  },
  대면: {
    enter: 'どうぞ、お入りください。',
    enterKo: '들어오세요.',
    seat: 'どうぞ、おかけください。それでは、これから面接を始めます。よろしくお願いします。',
    closing: '時間になりましたので、これで面接を終わります。お疲れさまでした。',
    closingKo: '시간이 되어 면접을 마칩니다. 수고하셨습니다.',
    enterHint: '入室のあいさつ（例：失礼いたします。〇〇と申します。よろしくお願いいたします。）',
    closeHint: '退室のあいさつ（例：本日はありがとうございました。失礼いたします。）',
    lobby: ['노크 → 입실 인사 → 착석 → 질문 → 퇴실 인사 순서로 연습해요.'],
    enterLabel: '입장하기 (타이머 시작)',
    enterTitle: '입실',
    closeTitle: '퇴실',
  },
};
export const scriptFor = (setting) => SCRIPTS[setting?.place === '대면' ? '대면' : '화상'];
export const SCRIPT = SCRIPTS.화상;

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
