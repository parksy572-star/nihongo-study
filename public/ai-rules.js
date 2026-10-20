// AI 분석 가이드라인 (코드판). 기획서의 'AI 분석 가이드라인' 섹션과 같은 규칙을 쓴다.
// 모든 AI 기능(발음·면접·작문·단어 초안)이 이 공통 규칙을 프롬프트 맨 앞에 붙인다.

export const COMMON_RULES = [
  '[공통 규칙]',
  '1. 입력(녹음·사진·글)에 실제로 있는 것만 근거로 삼는다. 들리지 않거나 보이지 않는 것을 추측해 채우지 않는다.',
  '2. 불확실한 부분은 그렇다고 표시한다. 확신이 낮으면 confidence를 "low"로 둔다.',
  '3. 정해진 JSON 형식으로만 답한다. 형식 밖의 말을 덧붙이지 않는다.',
  '4. 설명은 한국어, 예시·교정 표현은 일본어로 쓴다. 일본어 표기는 일본 상용한자 기준.',
  '5. 지적은 중요한 것부터 최대 5개. 사소한 것을 늘어놓지 않는다.',
  '6. 칭찬이나 평가는 근거(어느 부분이 어땠는지)와 함께만 쓴다.',
].join('\n');

/* ---------- 발음 평가 ---------- */

export const PRONUNCIATION_TYPES = ['장음', '촉음', 'ん', '탁음·청음', '요음', '모음', '억양', '속도·끊어읽기', '누락', '추가'];

export const PRONUNCIATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    speech_detected: { type: 'BOOLEAN' },
    transcript: { type: 'STRING' },
    transcript_kana: { type: 'STRING' },
    off_script: { type: 'BOOLEAN' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          target: { type: 'STRING' },
          heard: { type: 'STRING' },
          type: { type: 'STRING', enum: PRONUNCIATION_TYPES },
          tip: { type: 'STRING' },
        },
        required: ['target', 'heard', 'type', 'tip'],
      },
    },
    overall: { type: 'STRING' },
  },
  required: ['speech_detected', 'transcript', 'transcript_kana', 'off_script', 'confidence', 'issues', 'overall'],
};

export function pronunciationPrompt(target, seconds) {
  return [
    COMMON_RULES,
    '',
    '[역할] 한국인 학습자의 일본어 발음을 평가한다.',
    `[목표 문장] 「${target}」`,
    seconds ? `[녹음 길이] 약 ${seconds}초` : '',
    '',
    '[순서]',
    '1. 먼저 목표 문장을 잊고, 녹음에서 들린 소리만 그대로 받아 적는다 → transcript(한자·가나), transcript_kana(전부 히라가나).',
    '   - 목표 문장을 보고 빈 곳을 채우지 않는다. 안 들리는 부분은 「？」로 적는다.',
    '   - 말소리가 없거나 잡음뿐이면 speech_detected=false, transcript는 빈 문자열, issues는 빈 배열.',
    '2. 받아 적은 소리를 목표 문장과 비교한다.',
    '   - 목표와 다른 말을 했으면 off_script=true로 두고 issues는 비운다.',
    `   - 다른 지점만 issues에 적는다. type은 ${PRONUNCIATION_TYPES.join('/')} 중 하나.`,
    '   - target=목표 표현, heard=실제로 들린 소리(히라가나), tip=고치는 방법 한국어 한 문장.',
    '3. overall: 한국어 2문장 이내. 잘된 점 1개와 가장 먼저 고칠 점 1개.',
  ].filter(Boolean).join('\n');
}

// 히라가나/가타카나/한자 외 기호를 빼고 비교용 문자열로 만든다.
const norm = (s) => String(s || '').replace(/[\s。、！？!?.,「」『』（）()・ー〜~？]/g, '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// 두 문자열의 일치율(0~100). 레벤슈타인 거리 기반.
export function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a && !b) return 100;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return Math.round((1 - d[m][n] / Math.max(m, n)) * 100);
}

// AI 답을 그대로 믿지 않고 기본 검사를 한다. 문제가 있으면 warnings에 담는다.
export function checkPronunciation(j, targetKana) {
  const warnings = [];
  if (!j || typeof j !== 'object') return { ok: false, warnings: ['AI 답 형식이 올바르지 않아요.'] };
  if (j.speech_detected === false) return { ok: false, warnings: ['말소리가 들리지 않았대요. 조용한 곳에서 마이크에 가까이 대고 다시 녹음해 주세요.'] };
  const score = targetKana ? similarity(j.transcript_kana, targetKana) : null;
  if (j.off_script) warnings.push('목표 문장과 다른 말로 인식됐어요.');
  if (j.confidence === 'low') warnings.push('AI가 확신이 낮다고 답했어요. 다시 녹음해 보는 게 좋아요.');
  if (score !== null && score >= 95 && (j.issues || []).length > 2) warnings.push('거의 일치하는데 지적이 많아요. 지적 내용은 참고만 하세요.');
  if (score !== null && score < 60 && !j.off_script) warnings.push('들린 문장과 목표 문장의 차이가 커요. 녹음 상태를 확인해 주세요.');
  return { ok: true, score, warnings };
}
