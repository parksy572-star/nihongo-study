// 화면별 설정 도우미 (설정 행에 저장 → 기기 간 동기화)
import { h, icon } from './core.js';
import { db } from './db.js';

export function viewMode(screen) {
  const s = db.settings();
  return s.viewModes?.[screen] || s.defaultView || 'list';
}
export function setViewMode(screen, mode) {
  const s = db.settings();
  db.setSettings({ viewModes: { ...(s.viewModes || {}), [screen]: mode } });
}

// 왼쪽 아래 보기 형식 전환 버튼
export function viewToggle(screen, onChange) {
  let mode = viewMode(screen);
  const btn = h('button', { type: 'button', class: 'round fab', title: '보기 형식 전환', 'aria-label': '보기 형식 전환' });
  const paint = () => { btn.replaceChildren(icon(mode === 'list' ? 'cards' : 'list', 22)); btn.title = mode === 'list' ? '카드형으로 보기' : '리스트형으로 보기'; };
  paint();
  btn.addEventListener('click', () => { mode = mode === 'list' ? 'card' : 'list'; setViewMode(screen, mode); paint(); onChange(mode); });
  return btn;
}

export function targetSeconds() { return Number(db.settings().answerSeconds) || 45; }
export function streakSetting() { return Number(db.settings().streak) || 1; }

export const GENKO_RULES = [
  ['title', '제목', '첫 행, 위에서 2~3칸 띄우고 쓴다'],
  ['name', '이름', '다음 행 아래쪽에, 끝 칸을 1칸 비우고 쓴다. 성과 이름 사이 1칸'],
  ['indent', '문단 시작', '첫 칸을 1칸 비우고 시작한다'],
  ['punct', '구두점 。、', '한 칸을 차지한다. 행의 첫 칸에 오면 안 되고, 앞 행 마지막 칸에 글자와 함께 넣는다'],
  ['close', '닫는 괄호 」', '구두점과 같이 행 첫 칸에 오면 안 된다. 。와 」가 이어지면 한 칸에 함께'],
  ['dialog', '대화문 「」', '새 행 첫 칸부터 쓴다'],
  ['small', '작은 글자 っゃゅょ', '한 칸을 차지한다. 세로쓰기는 칸의 오른쪽 위, 가로쓰기는 왼쪽 아래'],
  ['choon', '장음 ー', '세로쓰기에서는 세로로 쓴다'],
  ['number', '숫자', '세로쓰기는 한자 숫자(二〇二六), 가로쓰기는 아라비아 숫자 2자를 한 칸에'],
  ['dash', '…… / ――', '2칸에 걸쳐 쓴다'],
];
export function genkoRuleOn(key) {
  const s = db.settings();
  return s.genkoRules?.[key] !== false;
}
