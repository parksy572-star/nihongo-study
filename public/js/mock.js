// 로컬 체험 모드(localhost?demo) 전용 가짜 Gemini. 실제 사이트에서는 불러오지 않는다.
// 화면 흐름을 시험하기 위한 정해진 답을 돌려준다.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const wrap = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

const QUESTIONS = [
  ['では、お一人ずつ、1分ほどで自己紹介をお願いします。', '그럼 한 분씩 1분 정도로 자기소개를 부탁합니다.', '자기소개', false],
  ['数ある学校の中で、なぜ文化服装学院を選んだのですか。', '많은 학교 중에서 왜 문화복장학원을 선택했습니까?', '지원 동기', false],
  ['韓国で学士を取得されたそうですが、どのような方法で学ばれましたか。', '한국에서 학사를 취득했다고 하는데, 어떤 방법으로 공부했습니까?', '학력', false],
  ['その制度について、もう少し詳しく説明していただけますか。', '그 제도에 대해 조금 더 자세히 설명해 주시겠습니까?', '학력', true],
  ['ブランドでのインターンでは、どのような仕事を担当しましたか。', '브랜드 인턴에서는 어떤 일을 담당했습니까?', '경험', false],
  ['舞台衣装を作るとき、一番難しかったことは何ですか。', '무대의상을 만들 때 가장 어려웠던 것은 무엇입니까?', '경험', false],
  ['服装科で特に学びたいことは何ですか。', '복장과에서 특히 배우고 싶은 것은 무엇입니까?', '기술·관심', false],
  ['卒業後はどのような進路を考えていますか。', '졸업 후에는 어떤 진로를 생각하고 있습니까?', '졸업 후', false],
];
const CONV = [
  ['いらっしゃいませ。何かお探しですか。', '어서 오세요. 뭔가 찾으시나요?'],
  ['サイズはいかがでしたか。', '사이즈는 어떠셨나요?'],
  ['ほかの色もございますが、ご覧になりますか。', '다른 색도 있는데 보시겠어요?'],
];

const DICT = {
  面接: 'めんせつ', 自己紹介: 'じこしょうかい', 一人: 'ひとり', 分: 'ぷん', 願: 'ねが', 数: 'かず', 学校: 'がっこう', 中: 'なか',
  文化服装学院: 'ぶんかふくそうがくいん', 選: 'えら', 韓国: 'かんこく', 学士: 'がくし', 取得: 'しゅとく', 方法: 'ほうほう', 学: 'まな',
  私: 'わたし', 勉強: 'べんきょう', 制度: 'せいど', 単位銀行制度: 'たんいぎんこうせいど', 働: 'はたら', 積: 'つ', 重: 'かさ', 学位: 'がくい',
  得: 'え', 学士号: 'がくしごう', 時間: 'じかん', 終: 'お', 疲: 'つか', 入: 'はい', 将来: 'しょうらい', 夢: 'ゆめ', 自分: 'じぶん',
  作: 'つく', 服飾: 'ふくしょく', 舞台衣装: 'ぶたいいしょう', 経験: 'けいけん', 立体裁断: 'りったいさいだん', 技術: 'ぎじゅつ', 足: 'た',
  感: 'かん', 年: 'ねん', 基礎: 'きそ', 考: 'かんが', 書: 'か', 台湾: 'たいわん', 参: 'まい', 林: 'りん', 申: 'もう', 台北: 'たいぺい',
  大学: 'だいがく', 興味: 'きょうみ', 持: 'も', 志望: 'しぼう', 先生: 'せんせい', 話: 'はなし', 聞: 'き', 画面: 'がめん', 音声: 'おんせい',
  始: 'はじ', 本日: 'ほんじつ', 失礼: 'しつれい', 退出: 'たいしゅつ', 問題: 'もんだい',
};

function questionCount(prompt) {
  return (prompt.match(/^Q\d+\[/gm) || []).length;
}

export async function mockGemini(body) {
  if (body.action === 'models') {
    await wait(150);
    return { models: [
      { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-3.8-flash-tts', displayName: 'Gemini 3.8 Flash TTS' },
    ] };
  }
  const task = body._task;
  const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
  await wait(task === 'interviewAnalyze' || task === 'writingAnalyze' || task === 'writingOcr' ? 1200 : 500);
  switch (task) {
    case 'interviewQuestion': {
      if (prompt.includes('회화 연습 상대')) {
        const [ja, ko] = CONV[questionCount(prompt) % CONV.length];
        return wrap({ question_ja: ja, question_ko: ko, category: '대화', is_followup: false });
      }
      const n = questionCount(prompt);
      const [ja, ko, cat, fu] = QUESTIONS[n % QUESTIONS.length];
      return wrap({ question_ja: ja, question_ko: ko, category: cat, is_followup: fu });
    }
    case 'otherCandidate':
      return wrap({
        answer_ja: '私は台湾から参りました林と申します。台北の大学で服飾デザインを学び、特にニットに興味を持っています。文化服装学院で基礎からしっかり学びたいと思い、志望いたしました。',
        answer_ko: '저는 대만에서 온 린이라고 합니다. 타이베이의 대학에서 의상 디자인을 배웠고 특히 니트에 관심이 있습니다. 문화복장학원에서 기초부터 제대로 배우고 싶어 지원했습니다.',
      });
    case 'transcribe':
      return wrap({ speech_detected: true, transcript: 'わたしは韓国でファッションデザインを勉強しました。学点銀行制という制度で学士をとりました。', transcript_kana: 'わたしはかんこくでふぁっしょんでざいんをべんきょうしました。がくてんぎんこうせいというせいどでがくしをとりました。', confidence: 'medium' });
    case 'pronunciation':
      return wrap({ speech_detected: true, transcript: 'わたしは韓国でファッションデザインを学びました。', transcript_kana: 'わたしはかんこくでふぁっしょんでざいんをまなびました', off_script: false, confidence: 'medium', issues: [{ target: 'ファッション', heard: 'ふぁしょん', type: '촉음', tip: '「ッ」에서 한 박자 멈춘 뒤 「ション」을 발음하세요.' }], overall: '문장 끝까지 또렷했어요. 촉음 길이를 한 박자 확보하세요.' });
    case 'interviewAnalyze':
      return wrap({
        question_ko: '질문의 한국어 해석입니다.',
        answer_ko: '저는 한국에서 패션디자인을 공부했습니다. 학점은행제라는 제도로 학사를 취득했습니다.',
        pronunciation: {
          confidence: 'medium',
          issues: [
            { target: 'ファッション', heard: 'ふぁしょん', type: '촉음', tip: '「ッ」에서 한 박자 멈추세요.' },
            { target: '勉強', heard: 'べんきょ', type: '장음', tip: '「きょう」의 장음을 끝까지 늘이세요.' },
          ],
          intonation: '문장 끝이 올라가 질문처럼 들렸어요. 「ました」는 내려 주세요.',
          speed: '조금 빨라요. 쉼표마다 짧게 쉬세요.',
          endings: '문제 없음',
          overall: '내용 전달은 분명했어요. 장음과 촉음 길이를 먼저 고치세요.',
        },
        corrections: [
          { wrong: '学点銀行制', right: '単位銀行制度（韓国の学位取得制度）', reason: '일본에 없는 제도이므로 짧은 설명을 붙이는 것이 좋아요.', kind: '어휘' },
          { wrong: 'とりました', right: '取得いたしました', reason: '면접에서는 겸양 표현이 더 자연스러워요.', kind: '경어' },
        ],
        refined_ja: '私は韓国でファッションデザインを学びました。単位銀行制度という、働きながら単位を積み重ねて学位を得られる制度で、学士号を取得いたしました。',
        refined_ko: '저는 한국에서 패션디자인을 배웠습니다. 일하면서 학점을 쌓아 학위를 받을 수 있는 학점은행제라는 제도로 학사 학위를 취득했습니다.',
        evaluation: {
          intent: '질문(학습 방법)에 맞게 답했어요.',
          keigo: '「とりました」는 「取得いたしました」로 바꾸면 면접 수준이에요.',
          conclusion_first: '첫 문장에 결론을 말했어요.',
          length: '목표 시간 안이에요.',
          overlap: prompt.includes('다른 지원자가 먼저') ? '앞 지원자와 겹치지 않았어요.' : '해당 없음',
          summary: '결론은 분명하지만 제도 설명을 한 문장 덧붙이세요.',
        },
      });
    case 'writingQuestion':
      return wrap({ question_ja: 'あなたが文化服装学院で学びたいことと、将来の夢について書きなさい。（400字程度）', question_ko: '당신이 문화복장학원에서 배우고 싶은 것과 장래의 꿈에 대해 쓰시오. (400자 정도)' });
    case 'writingOcr': {
      if (prompt.includes('일반 종이')) {
        return wrap({ lines: [
          { text: '私の夢は、自分のブランドを作ることです。', box_2d: [80, 60, 140, 940] },
          { text: '韓国で服飾を勉強しました。', box_2d: [160, 60, 220, 700] },
        ], confidence: 'medium', notes: '' });
      }
      const rows = [
        '　　将来の夢',
        '　　　　　　　　　　　　　キム　スヨン　',
        '　私の夢は、自分のブランドを作ることで',
        'す。韓国で服飾を勉強しながら、舞台衣装',
        'を作る経験をしました',
        '。そのとき、立体裁断の技術が足りないと',
        '感じました。',
        '　文化服装学院では、２０２７年から基',
        '礎を学びたいです「先生の話をよく聞く」',
      ];
      return wrap({
        rows: rows.map((r, i) => ({ row: i + 1, cells: Array.from({ length: 20 }, (_, c) => {
          const ch = [...r][c] || '';
          return ch === '　' ? '' : ch;
        }) })),
        confidence: 'medium', notes: '',
      });
    }
    case 'writingAnalyze':
      return wrap({
        question_ko: '당신이 문화복장학원에서 배우고 싶은 것과 장래의 꿈에 대해 쓰시오.',
        answer_ko: '제 꿈은 제 브랜드를 만드는 것입니다. 한국에서 복식을 공부하면서 무대의상을 만드는 경험을 했습니다.',
        kanji_errors: [
          { page: 1, row: 4, col: 8, written: '服', correct: '服', reason: '획 빠짐', detail: '「服」의 오른쪽 아래 획이 빠졌어요.', status: 'wrong' },
          { page: 1, row: 6, col: 7, written: '断', correct: '断', reason: '글자 모양', detail: '글씨가 흐려 판단이 어려워요.', status: 'uncertain' },
        ],
        corrections: [
          { wrong: '勉強しながら', right: '学びながら', reason: '작문에서는 「学ぶ」가 더 자연스러워요.' },
          { wrong: '学びたいです', right: '学びたいと考えています', reason: '문장 끝을 다듬어 의지를 분명하게.' },
        ],
        genko: [{ rule: '작은 글자 っゃゅょ', page: 1, row: 3, col: 5, detail: '작은 글자는 칸의 왼쪽 아래에 써요.' }],
        corrected_ja: '私の夢は、自分のブランドを作ることです。韓国で服飾を学びながら、舞台衣装を作る経験をしました。そのとき、立体裁断の技術が足りないと感じました。文化服装学院では、2027年から基礎を学びたいと考えています。',
        corrected_ko: '제 꿈은 제 브랜드를 만드는 것입니다. 한국에서 복식을 배우면서 무대의상을 만드는 경험을 했습니다. 그때 입체재단 기술이 부족하다고 느꼈습니다. 문화복장학원에서는 2027년부터 기초를 배우고 싶습니다.',
      });
    case 'wordDraft': {
      const word = (/\[단어\] (.+)/.exec(prompt) || [])[1] || '';
      return wrap({ furigana: 'つぐ', meaning: '잇다, 이어받다', level: 'N3', pos: '1그룹 동사', example_ja: '父の仕事を継いだ。', example_ruby: '[父|ちち]の[仕事|しごと]を[継|つ]いだ。', example_ko: '아버지의 일을 이어받았다.', example_mark: '継いだ', _word: word });
    }
    case 'furigana': {
      const texts = [...prompt.matchAll(/^(\d+): (.*)$/gm)].map((m) => m[2]);
      const words = Object.keys(DICT).sort((a, b) => b.length - a.length);
      return wrap({ items: texts.map((t, i) => {
        let out = '';
        for (let k = 0; k < t.length;) {
          const w = words.find((x) => t.startsWith(x, k));
          if (w) { out += `[${w}|${DICT[w]}]`; k += w.length; } else { out += t[k]; k++; }
        }
        return { i, ruby: out };
      }) });
    }
    default:
      return wrap({});
  }
}

// 체험 모드에서 마이크를 쓸 수 없을 때(시험용 브라우저 등) 말소리처럼 오르내리는 소리로 대신 녹음한다.
export function installFakeMic() {
  const md = navigator.mediaDevices;
  if (!md) return;
  const real = md.getUserMedia?.bind(md);
  md.getUserMedia = async (c) => {
    try { if (real) return await real(c); } catch { /* 대신 가짜 소리 */ }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    osc.frequency.value = 220; lfo.frequency.value = 3; lfoGain.gain.value = 0.25; gain.gain.value = 0.3;
    lfo.connect(lfoGain).connect(gain.gain);
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start(); lfo.start();
    const stream = dest.stream;
    const track = stream.getAudioTracks()[0];
    const stop = track.stop.bind(track);
    track.stop = () => { stop(); try { osc.stop(); lfo.stop(); ctx.close(); } catch { /* 무시 */ } };
    return stream;
  };
}
