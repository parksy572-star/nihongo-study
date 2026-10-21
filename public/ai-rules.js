// AI 분석 가이드라인 (코드판). 기획서의 'AI 분석 가이드라인' 섹션과 같은 규칙을 쓴다.
// 모든 AI 기능(발음·면접·작문·단어 초안)이 이 공통 규칙을 프롬프트 맨 앞에 붙이고,
// 정해진 응답 스키마로 받고, 아래 check* 함수로 한 번 더 검사한 뒤 화면에 보여준다.

export const COMMON_RULES = [
  '[공통 규칙]',
  '1. 입력(녹음·사진·글)에 실제로 있는 것만 근거로 삼는다. 들리지 않거나 보이지 않는 것을 추측해 채우지 않는다.',
  '2. 불확실한 부분은 그렇다고 표시한다. 확신이 낮으면 confidence를 "low"로 둔다.',
  '3. 정해진 JSON 형식으로만 답한다. 형식 밖의 말을 덧붙이지 않는다.',
  '4. 설명은 한국어, 예시·교정 표현은 일본어로 쓴다. 일본어 표기는 일본 상용한자 기준.',
  '5. 지적은 중요한 것부터 최대 5개. 사소한 것을 늘어놓지 않는다.',
  '6. 칭찬이나 평가는 근거(어느 부분이 어땠는지)와 함께만 쓴다.',
].join('\n');

/* ---------- 모델 ---------- */

// Gemini API 가격표(ai.google.dev/gemini-api/docs/pricing)에서 무료 등급으로 표시된 모델, 우선순위 순.
// Omni·Pro 계열은 무료 등급에서 '사용 불가'라 쓰지 않는다. 모델 이름은 자주 바뀌므로 개발 시점에 다시 확인한다.
const V = '(-latest|-\\d{3})?$';
export const FREE_FLASH_MODELS = ['gemini-3\\.8-flash', 'gemini-3\\.6-flash', 'gemini-3-flash-preview', 'gemini-2\\.5-flash']
  .map((b) => new RegExp('^' + b + V));
export const FREE_LITE_MODELS = ['gemini-3\\.5-flash-lite', 'gemini-3\\.1-flash-lite', 'gemini-3\\.8-flash-lite', 'gemini-2\\.5-flash-lite']
  .map((b) => new RegExp('^' + b + V));
export const FREE_TTS_MODELS = [/^gemini-3\.8-flash-tts$/, /^gemini-3\.8-flash-lite-tts$/, /^gemini-3\.1-flash-tts/, /^gemini-2\.5-flash-preview-tts/];
export const isFreeModel = (id) => [...FREE_FLASH_MODELS, ...FREE_LITE_MODELS].some((re) => re.test(id));

// 작업별 모델 등급과 무작위성. 분석·교정은 0, 질문 생성만 0.7.
export const TASKS = {
  transcribe:        { tier: 'flash', temperature: 0 },
  pronunciation:     { tier: 'flash', temperature: 0 },
  interviewQuestion: { tier: 'lite', temperature: 0.7 },
  otherCandidate:    { tier: 'lite', temperature: 0.7 },
  interviewAnalyze:  { tier: 'flash', temperature: 0 },
  writingQuestion:   { tier: 'lite', temperature: 0.7 },
  writingOcr:        { tier: 'flash', temperature: 0 },
  writingAnalyze:    { tier: 'flash', temperature: 0 },
  wordDraft:         { tier: 'lite', temperature: 0 },
};

/* ---------- 공통 검사 도구 ---------- */

const S = (extra = {}) => ({ type: 'STRING', ...extra });
const ARR = (items) => ({ type: 'ARRAY', items });
const OBJ = (properties, required = Object.keys(properties)) => ({ type: 'OBJECT', properties, required });
const CONF = S({ enum: ['high', 'medium', 'low'] });

const JP = /[぀-ヿ㐀-鿿]/;
const HANGUL = /[가-힣]/;
const clip = (arr, n = 5) => (Array.isArray(arr) ? arr.slice(0, n) : []);

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

// 글자 2개 묶음 겹침 비율(0~1). 질문이 이전 질문과 거의 같은지 볼 때 쓴다.
export function overlap(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1); return m; };
  const ga = grams(A), gb = grams(B);
  let inter = 0, total = 0;
  for (const [g, n] of ga) { inter += Math.min(n, gb.get(g) || 0); total += n; }
  for (const n of gb.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

const sentenceCount = (s) => String(s || '').split(/[。？！?!]/).filter((x) => x.trim()).length;

/* ---------- 발음 평가 (목표 문장이 있을 때: 다듬은 답변 읽기·복습) ---------- */

export const PRONUNCIATION_TYPES = ['장음', '촉음', 'ん', '탁음·청음', '요음', '모음', '억양', '속도·끊어읽기', '누락', '추가'];

const ISSUE = OBJ({
  target: S(), heard: S(), type: S({ enum: PRONUNCIATION_TYPES }), tip: S(),
});

export const PRONUNCIATION_SCHEMA = OBJ({
  speech_detected: { type: 'BOOLEAN' },
  transcript: S(),
  transcript_kana: S(),
  off_script: { type: 'BOOLEAN' },
  confidence: CONF,
  issues: ARR(ISSUE),
  overall: S(),
});

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
  j.issues = clip(j.issues).filter((i) => PRONUNCIATION_TYPES.includes(i.type));
  return { ok: true, score, warnings };
}

/* ---------- 받아쓰기 (목표 문장 없이 들린 소리만) ---------- */

export const TRANSCRIBE_SCHEMA = OBJ({
  speech_detected: { type: 'BOOLEAN' },
  transcript: S(),
  transcript_kana: S(),
  confidence: CONF,
});

export function transcribePrompt(seconds) {
  return [
    COMMON_RULES,
    '',
    '[역할] 한국인 학습자가 일본어로 말한 녹음을 받아 적는다. 이 단계에서는 평가하지 않는다.',
    seconds ? `[녹음 길이] 약 ${seconds}초` : '',
    '- 들린 소리를 그대로 적는다. 학습자가 틀리게 말한 부분도 고치지 말고 들린 대로 적는다.',
    '- 문맥으로 추측해 매끄럽게 만들지 않는다. 안 들리는 부분은 「？」로 적는다.',
    '- transcript: 한자·가나 혼용(들린 말에 맞는 표기), transcript_kana: 전부 히라가나.',
    '- 말소리가 없거나 잡음뿐이면 speech_detected=false, transcript는 빈 문자열.',
  ].filter(Boolean).join('\n');
}

export function checkTranscribe(j) {
  if (!j || typeof j.transcript !== 'string') return { ok: false, warnings: ['받아쓰기 결과 형식이 올바르지 않아요.'] };
  const warnings = [];
  if (j.speech_detected === false || !j.transcript.trim()) {
    return { ok: true, silent: true, warnings: ['말소리가 들리지 않았대요. 다시 녹음해 주세요.'] };
  }
  if (!JP.test(j.transcript)) warnings.push('일본어로 인식되지 않았어요. 다시 녹음해 보세요.');
  if (j.confidence === 'low') warnings.push('AI가 잘 알아듣지 못했다고 답했어요. 글자를 확인해 주세요.');
  return { ok: true, warnings };
}

/* ---------- 면접 질문 ---------- */

export const INTERVIEW_CATEGORIES = ['자기소개', '지원 동기', '학력', '경험', '기술·관심', '졸업 후', '일본어·생활'];
export const CONVERSATION_CATEGORIES = ['대화'];

export const QUESTION_SCHEMA = OBJ({
  question_ja: S(),
  question_ko: S(),
  category: S(),
  is_followup: { type: 'BOOLEAN' },
});

export function interviewQuestionPrompt({ setting, history, mustFollowup, avoidCategories = [], conversation = false }) {
  const past = history.length
    ? history.map((t, i) => `Q${i + 1}[${t.category}${t.is_followup ? '·꼬리' : ''}] ${t.question_ja}\n  학습자 답: ${t.answer || '(답 없음)'}`).join('\n')
    : '(아직 없음)';
  if (conversation) {
    return [
      COMMON_RULES,
      '',
      `[역할] 일본어 회화 연습 상대. 장면: ${setting.scene || '일상 대화'}. 당신의 역할: ${setting.role || '상대방'}.`,
      `[말투] ${setting.tone || '정중체'}`,
      '[지금까지의 대화]',
      past,
      '',
      '- 학습자에게 건넬 다음 한마디를 1~2문장으로 만든다. 앞 대화의 흐름을 이어 간다.',
      '- 이미 한 말은 반복하지 않는다. 학습자가 대답하기 쉬운 자연스러운 말을 고른다.',
      '- question_ja: 일본어, question_ko: 한국어 해석, category: "대화", is_followup: 앞 답에 이어지는 말이면 true.',
    ].join('\n');
  }
  return [
    COMMON_RULES,
    '',
    `[역할] ${setting.school || '일본 전문학교'} ${setting.dept || ''} 입시 면접관. 형식: ${setting.group ? '2인 1조 집단 면접(지원자 2명에게 같은 질문)' : '1:1 면접'}.`,
    `[지원자 이력 요약] ${setting.resume || '(없음)'}`,
    `[말투] 면접관은 정중체로 묻는다. 지원자는 ${setting.tone || '정중체·경어'}로 답한다.`,
    `[질문 범주] ${INTERVIEW_CATEGORIES.join(' / ')}`,
    '[지금까지의 문답]',
    past,
    '',
    '[규칙]',
    '- 다음 질문 1개만 만든다. 정중체 일본어 한 문장(질문이 둘로 나뉘지 않게).',
    '- 이미 한 질문과 같은 내용은 다시 묻지 않는다. 앞 답변에 대한 꼬리 질문을 섞는다.',
    '- 지원자의 이력에 맞게 구체적으로 바꾼다. 실제 기출 질문이라고 단정하지 않는다.',
    '- 학점은행제처럼 일본에 없는 제도가 답에 나오면 그 설명을 요구하는 꼬리 질문을 한다.',
    mustFollowup ? '- 이번 질문은 바로 앞 답변에 대한 꼬리 질문이어야 한다(is_followup=true).' : '',
    avoidCategories.length ? `- 이번에는 다음 범주는 피한다: ${avoidCategories.join(', ')}` : '',
    '- question_ko: 한국어 해석, category: 위 범주 중 하나(꼬리 질문이면 원래 범주), is_followup: 꼬리 질문이면 true.',
  ].filter(Boolean).join('\n');
}

export function checkQuestion(j, history, conversation = false) {
  if (!j || typeof j.question_ja !== 'string' || !j.question_ja.trim()) return { ok: false, warnings: ['질문 형식이 올바르지 않아요.'] };
  if (!JP.test(j.question_ja) || HANGUL.test(j.question_ja)) return { ok: false, warnings: ['일본어 질문이 아니에요.'] };
  if (!conversation && sentenceCount(j.question_ja) > 2) return { ok: false, warnings: ['한 문장 질문이 아니에요.'] };
  if (history.some((t) => overlap(t.question_ja, j.question_ja) > 0.8)) return { ok: false, warnings: ['이전 질문과 거의 같아요.'] };
  if (!conversation && !INTERVIEW_CATEGORIES.includes(j.category)) j.category = '기술·관심';
  return { ok: true, warnings: [] };
}

/* ---------- 집단 면접의 다른 지원자 ---------- */

export const OTHER_SCHEMA = OBJ({ answer_ja: S(), answer_ko: S() });

export function otherCandidatePrompt({ persona, question, setting, myAnswer, history }) {
  return [
    '[역할] 일본 전문학교 입시 집단 면접에서 학습자와 같은 조인 다른 지원자 역할을 한다.',
    `[다른 지원자 설정] ${persona}`,
    `[학교·학과] ${setting.school || ''} ${setting.dept || ''}`,
    history.length ? `[이 지원자가 앞에서 한 답]\n${history.map((t) => '- ' + t).join('\n')}` : '',
    myAnswer ? `[같은 질문에 학습자가 먼저 한 답] ${myAnswer}\n- 학습자의 답과 겹치지 않는 내용으로 답한다.` : '',
    `[면접관 질문] ${question}`,
    '',
    '- 유학생다운 자연스러운 정중체·경어로 25~40초 분량(150~220자)으로 답한다. 결론부터 말한다.',
    '- 설정과 앞의 답과 모순되지 않게 한다. answer_ja: 일본어, answer_ko: 한국어 해석. JSON으로만 답한다.',
  ].filter(Boolean).join('\n');
}

export function checkOther(j) {
  if (!j || !JP.test(j.answer_ja || '') || HANGUL.test(j.answer_ja)) return { ok: false, warnings: ['다른 지원자 답 형식 오류'] };
  return { ok: true, warnings: [] };
}

export const OTHER_PERSONAS = [
  '台湾出身の女性。台北の大学で服飾デザインを学び、ニットとテキスタイルに興味がある。将来は台湾で自分のブランドを作りたい。',
  '中国・上海出身の男性。高校卒業後に日本語学校で1年半学んでいる。古着とストリートファッションが好きで、パタンナー志望。',
  'タイ出身の女性。バンコクで洋裁店を営む家族の影響で服作りを始めた。伝統織物を現代の服に生かしたい。',
  'ベトナム出身の男性。ホーチミンの縫製工場で2年働いた経験がある。日本の縫製技術と品質管理を学びたい。',
];

/* ---------- 면접 답변 분석 ---------- */

export const CORRECTION_KINDS = ['문법', '어휘', '경어', '면접 표현', '발음 표기'];

export const INTERVIEW_ANALYZE_SCHEMA = OBJ({
  question_ko: S(),
  answer_ko: S(),
  pronunciation: OBJ({
    confidence: CONF,
    issues: ARR(ISSUE),
    intonation: S(),
    speed: S(),
    endings: S(),
    overall: S(),
  }),
  corrections: ARR(OBJ({ wrong: S(), right: S(), reason: S(), kind: S({ enum: CORRECTION_KINDS }) })),
  refined_ja: S(),
  refined_ko: S(),
  evaluation: OBJ({
    intent: S(), keigo: S(), conclusion_first: S(), length: S(), overlap: S(), summary: S(),
  }),
});

export function interviewAnalyzePrompt({ setting, question, heard, answer, seconds, targetSeconds, otherAnswer, conversation }) {
  return [
    COMMON_RULES,
    '',
    conversation
      ? `[역할] 일본어 회화 코치. 장면: ${setting.scene || ''}. 말투: ${setting.tone || '정중체'}.`
      : `[역할] ${setting.school || ''} ${setting.dept || ''} 입시 면접 코치. 기준 경어: 면접 수준(です・ます + 겸양어).`,
    `[질문] ${question}`,
    `[AI가 녹음에서 받아 적은 그대로] ${heard || '(없음)'}`,
    `[학습자가 확인·수정한 답변 원문] ${answer}`,
    `[답변 시간] ${seconds ?? '?'}초 / 목표 ${targetSeconds}초 이내`,
    otherAnswer ? `[같은 질문에 다른 지원자가 먼저 한 답] ${otherAnswer}` : '',
    '',
    '[해야 할 일]',
    '1. question_ko, answer_ko: 질문과 답변 원문의 자연스러운 한국어 해석.',
    '2. pronunciation: 녹음을 직접 듣고 평가한다. 발음 평가는 수정한 원문이 아니라 원래 녹음 기준이다.',
    `   issues의 type은 ${PRONUNCIATION_TYPES.join('/')} 중 하나. target=원래 말하려던 표현, heard=들린 소리(히라가나), tip=한국어 한 문장.`,
    '   intonation(억양), speed(속도), endings(말끝 흐림)은 한국어 한 문장씩. 문제가 없으면 "문제 없음".',
    `2-1. corrections: 틀린 부분(wrong, 답변 원문에 있는 그대로의 부분 문자열) → 고친 표현(right), 이유(reason, 한국어), kind는 ${CORRECTION_KINDS.join('/')} 중 하나.`,
    '3. refined_ja: 학습자의 내용·경험·사실은 바꾸거나 지어내지 말고 표현만 다듬은 모범 답변. 원문 길이의 1.5배를 넘지 않게.',
    '   학점은행제 같은 한국 제도가 나오면 일본어로 짧게 설명하는 표현을 넣는다. refined_ko: 해석.',
    '4. evaluation (각각 한국어 한 문장, 근거와 함께):',
    '   intent=질문 의도에 맞았는지, keigo=경어, conclusion_first=결론을 먼저 말했는지,',
    `   length=길이(목표 ${targetSeconds}초, 1분 넘으면 지적), overlap=${otherAnswer ? '앞 지원자 답과 겹쳤는지' : '"해당 없음"'}, summary=한줄 평가.`,
  ].filter(Boolean).join('\n');
}

export function checkInterviewAnalysis(j, answer) {
  if (!j || typeof j !== 'object' || !j.pronunciation || !j.evaluation || typeof j.refined_ja !== 'string') {
    return { ok: false, warnings: ['분석 결과 형식이 올바르지 않아요.'] };
  }
  const warnings = [];
  j.corrections = clip(j.corrections).filter((c) => c && c.wrong && c.right);
  j.corrections.forEach((c) => { c.found = String(answer).includes(c.wrong); });
  j.pronunciation.issues = clip(j.pronunciation.issues).filter((i) => i && PRONUNCIATION_TYPES.includes(i.type));
  const ratio = norm(j.refined_ja).length / Math.max(1, norm(answer).length);
  if (ratio > 1.5) warnings.push(`다듬은 답변이 내 답보다 꽤 길어요(${ratio.toFixed(1)}배). 내 답에 없는 내용이 들어갔는지 확인해 주세요.`);
  if (j.pronunciation.confidence === 'low') warnings.push('발음 평가는 AI 확신도가 낮아요. 참고만 하세요.');
  return { ok: true, warnings, ratio };
}

/* ---------- 작문 질문 ---------- */

export const WRITING_QUESTION_SCHEMA = OBJ({ question_ja: S(), question_ko: S() });

export function writingQuestionPrompt({ category, situation, chars, previous = [] }) {
  return [
    COMMON_RULES,
    '',
    '[역할] 일본 전문학교(문화복장학원 복장과) 유학생 입시 작문 출제자.',
    `[카테고리] ${category || '자유'}`,
    situation ? `[상황] ${situation}` : '',
    `[분량] 약 ${chars}자`,
    previous.length ? `[이미 낸 질문 — 다시 내지 않는다]\n${previous.map((q) => '- ' + q).join('\n')}` : '',
    '- 작문 주제·질문을 일본어로 1~2문장 만든다. 실제 기출이라고 단정하지 않는다.',
    '- question_ja: 일본어, question_ko: 한국어 해석.',
  ].filter(Boolean).join('\n');
}

export function checkWritingQuestion(j, previous = []) {
  if (!j || !JP.test(j.question_ja || '') || HANGUL.test(j.question_ja)) return { ok: false, warnings: ['일본어 질문이 아니에요.'] };
  if (previous.some((q) => overlap(q, j.question_ja) > 0.85)) return { ok: false, warnings: ['이전 질문과 거의 같아요.'] };
  return { ok: true, warnings: [] };
}

/* ---------- 작문 글자 읽기 ---------- */

// 원고지: 행마다 칸 배열. 빈 칸은 ""(빈 문자열), 알아볼 수 없는 칸은 "？".
export const OCR_GRID_SCHEMA = OBJ({
  rows: ARR(OBJ({ row: { type: 'INTEGER' }, cells: ARR(S()) })),
  confidence: CONF,
  notes: S(),
});
export const OCR_PLAIN_SCHEMA = OBJ({
  lines: ARR(OBJ({ text: S(), box_2d: ARR({ type: 'INTEGER' }) })),
  confidence: CONF,
  notes: S(),
});

export function ocrPrompt({ paper, rows, cols, tiles }) {
  const grid = paper !== 'plain';
  const vertical = paper === 'genko-v';
  return [
    COMMON_RULES,
    '',
    '[역할] 한국인 학습자가 손으로 쓴 일본어 작문 사진을 글자 그대로 옮긴다. 이 단계에서는 평가하지 않는다.',
    '- 학습자가 잘못 쓴 한자·가나도 고치지 말고 쓴 모양 그대로 옮긴다. 비슷한 바른 글자로 바꾸지 않는다.',
    '- 알아볼 수 없는 글자는 「？」로 적는다. 추측해서 채우지 않는다.',
    grid
      ? [
        `- 첫 번째 이미지는 원고지 한 장 전체(칸 영역만 잘라 둠), ${vertical ? `세로쓰기: 오른쪽 줄부터 왼쪽으로 ${cols}줄, 한 줄에 ${rows}칸` : `가로쓰기: 위에서부터 ${rows}행, 한 행에 ${cols}칸`}.`,
        tiles ? `- 나머지 이미지는 같은 장을 확대한 조각이다: ${tiles}. 작은 글자는 조각에서 확인한다.` : '',
        `- rows: ${vertical ? '줄(오른쪽부터 1)' : '행(위부터 1)'}마다 {row: 번호, cells: 칸 ${vertical ? rows : cols}개}. 빈 칸은 "", 구두점·작은 글자도 한 칸으로 적는다.`,
        '- 한 칸에 두 글자(예: 。」 또는 숫자 2자)가 있으면 그 칸에 두 글자를 함께 적는다.',
        '- 칸 번호를 정확히 맞춘다. 글자가 칸 사이에 걸쳐 있으면 더 많이 걸친 칸에 넣는다.',
      ].join('\n')
      : [
        '- 일반 종이다. 줄마다 lines에 {text, box_2d}로 적는다. box_2d는 첫 번째 이미지 기준 [ymin, xmin, ymax, xmax] (0~1000).',
        tiles ? `- 나머지 이미지는 확대 조각이다: ${tiles}. 좌표는 항상 첫 번째 이미지 기준.` : '',
      ].join('\n'),
  ].filter(Boolean).join('\n');
}

export function checkOcr(j, { paper, rows, cols }) {
  if (!j) return { ok: false, warnings: ['글자 읽기 결과 형식이 올바르지 않아요.'] };
  const warnings = [];
  if (paper === 'plain') {
    if (!Array.isArray(j.lines)) return { ok: false, warnings: ['글자 읽기 결과 형식이 올바르지 않아요.'] };
    j.lines = j.lines.filter((l) => typeof l.text === 'string');
  } else {
    if (!Array.isArray(j.rows)) return { ok: false, warnings: ['글자 읽기 결과 형식이 올바르지 않아요.'] };
    const lineCount = paper === 'genko-v' ? cols : rows;
    const cellCount = paper === 'genko-v' ? rows : cols;
    const grid = Array.from({ length: lineCount }, () => Array(cellCount).fill(''));
    let outside = 0;
    for (const r of j.rows) {
      const ri = (r.row | 0) - 1;
      if (ri < 0 || ri >= lineCount) { outside++; continue; }
      (r.cells || []).slice(0, cellCount).forEach((c, ci) => { grid[ri][ci] = String(c ?? '').trim().slice(0, 2); });
      if ((r.cells || []).length > cellCount) outside++;
    }
    if (outside) warnings.push(`원고지 칸 수를 벗어난 결과 ${outside}곳을 버렸어요.`);
    j.grid = grid;
  }
  if (j.confidence === 'low') warnings.push('AI가 잘 읽지 못했다고 답했어요. 꼼꼼히 확인해 주세요.');
  return { ok: true, warnings };
}

/* ---------- 작문 분석 ---------- */

export const KANJI_ERROR_REASONS = ['획 빠짐', '획 추가', '비슷한 한자 혼동', '오쿠리가나 오류', '글자 모양', '기타'];

export const WRITING_ANALYZE_SCHEMA = OBJ({
  question_ko: S(),
  answer_ko: S(),
  kanji_errors: ARR(OBJ({
    page: { type: 'INTEGER' }, row: { type: 'INTEGER' }, col: { type: 'INTEGER' },
    written: S(), correct: S(), reason: S({ enum: KANJI_ERROR_REASONS }), detail: S(),
    status: S({ enum: ['wrong', 'uncertain'] }),
    box_2d: ARR({ type: 'INTEGER' }),
  }, ['page', 'row', 'col', 'written', 'correct', 'reason', 'detail', 'status'])),
  corrections: ARR(OBJ({ wrong: S(), right: S(), reason: S() })),
  genko: ARR(OBJ({ rule: S(), page: { type: 'INTEGER' }, row: { type: 'INTEGER' }, col: { type: 'INTEGER' }, detail: S() })),
  corrected_ja: S(),
  corrected_ko: S(),
});

export function writingAnalyzePrompt({ question, text, gridText, paper, visualRules }) {
  const grid = paper !== 'plain';
  return [
    COMMON_RULES,
    '',
    '[역할] 한국인 학습자의 손글씨 일본어 작문을 교정한다. 첨부 사진이 원본이고, 아래 글은 학습자가 확인한 읽기 결과다.',
    `[질문] ${question}`,
    `[읽은 글]\n${text}`,
    grid ? `[원고지 칸 위치]\n${gridText}` : '',
    '',
    '[해야 할 일]',
    '1. question_ko, answer_ko: 질문과 읽은 글의 한국어 해석.',
    `2. kanji_errors: 사진을 보고 잘못 쓴 한자를 찾는다. written=쓴 모양(읽은 글 그대로), correct=바른 상용한자, reason은 ${KANJI_ERROR_REASONS.join('/')} 중 하나, detail=한국어 한 문장.`,
    '   확실히 틀린 것만 status="wrong", 글씨가 흐리거나 판단이 애매하면 status="uncertain".',
    grid ? '   page·row·col은 위 원고지 칸 위치(1부터). box_2d는 비워도 된다.' : '   page는 1부터, row·col은 읽은 글의 줄·글자 순서(1부터), box_2d=[ymin,xmin,ymax,xmax](0~1000, 해당 사진 기준).',
    '3. corrections: 문장 교정. wrong=읽은 글에 있는 그대로의 부분, right=고친 표현, reason=이유(문법·어휘·문체 통일 등, 한국어).',
    grid && visualRules.length
      ? `4. genko: 사진에서만 판단할 수 있는 원고지 규칙만 본다: ${visualRules.join(' / ')}. rule=규칙 이름, page·row·col, detail=한국어.`
      : '4. genko: 빈 배열.',
    '5. corrected_ja: 학습자의 내용을 살려 고친 글 전체. 문체(です・ます 또는 だ・である)는 원문에 맞춰 통일. corrected_ko: 해석.',
  ].filter(Boolean).join('\n');
}

export function checkWritingAnalysis(j, { paper, pages, rows, cols, visualRules, isJoyo }) {
  if (!j || !Array.isArray(j.kanji_errors) || typeof j.corrected_ja !== 'string') return { ok: false, warnings: ['분석 결과 형식이 올바르지 않아요.'] };
  const warnings = [];
  const lineCount = paper === 'genko-v' ? cols : rows;
  const cellCount = paper === 'genko-v' ? rows : cols;
  const inGrid = (e) => paper === 'plain' || (e.page >= 1 && e.page <= pages && e.row >= 1 && e.row <= lineCount && e.col >= 1 && e.col <= cellCount);
  j.kanji_errors = j.kanji_errors.filter((e) => e && e.correct && KANJI_ERROR_REASONS.includes(e.reason)).slice(0, 10);
  for (const e of j.kanji_errors) {
    if (!inGrid(e)) { e.status = 'uncertain'; e.noPos = true; }
    const nonJoyo = [...e.correct].filter((c) => /[㐀-鿿]/.test(c) && isJoyo && !isJoyo(c));
    if (nonJoyo.length) { e.status = 'uncertain'; e.notJoyo = nonJoyo.join(''); }
  }
  j.corrections = clip(j.corrections, 8).filter((c) => c && c.wrong && c.right);
  j.genko = (j.genko || []).filter((g) => g && visualRules.includes(g.rule) && inGrid(g));
  return { ok: true, warnings };
}

/* ---------- 단어 초안 ---------- */

export const WORD_DRAFT_SCHEMA = OBJ({
  furigana: S(),
  meaning: S(),
  level: S({ enum: ['N5', 'N4', 'N3', 'N2', 'N1', '기타'] }),
  pos: S(),
  example_ja: S(),
  example_ruby: S(),
  example_ko: S(),
  example_mark: S(),
});

export function wordDraftPrompt(word) {
  return [
    COMMON_RULES,
    '',
    `[단어] ${word}`,
    '- furigana: 단어 전체 읽기, 히라가나만(가타카나 단어도 히라가나로).',
    '- meaning: 한국어 뜻. 여러 뜻은 쉼표로 구분, 자주 쓰는 순서로 최대 3개.',
    '- level: JLPT 레벨 추정(N5~N1, 해당 없으면 기타). 추정임을 사용자에게 알린다.',
    '- pos: 품사를 한국어로(예: 1그룹 동사, 2그룹 동사, する동사, い형용사, な형용사, 명사, 부사).',
    '- example_ja: 이 단어가 들어간 짧고 자연스러운 예문. example_ko: 해석.',
    '- example_ruby: 예문의 한자에 읽기를 붙인 표기. 형식: [漢字|かんじ] 예) [父|ちち]の[仕事|しごと]を[継|つ]いだ。',
    '- example_mark: 예문 속에서 이 단어가 활용된 부분 그대로(예: 継いだ).',
  ].join('\n');
}

export function checkWordDraft(j) {
  if (!j || !j.furigana || !j.meaning) return { ok: false, warnings: ['초안 형식이 올바르지 않아요.'] };
  const warnings = [];
  if (!/^[ぁ-ゖー]+$/.test(j.furigana.replace(/\s/g, ''))) {
    return { ok: false, warnings: ['후리가나가 히라가나만으로 되어 있지 않아요.'] };
  }
  if (j.example_mark && j.example_ja && !j.example_ja.includes(j.example_mark)) j.example_mark = '';
  warnings.push('JLPT 레벨은 AI 추정이에요.');
  return { ok: true, warnings };
}
