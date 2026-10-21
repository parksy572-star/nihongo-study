// 가나·한글 도구
// - 가타카나 → 히라가나, 로마자 → 가나(wanakana)
// - 후리가나 → 한글 발음 키(검색 전용, 화면에 표시하지 않음)와 같은 규칙의 정규화
// - 후리가나를 한자 부분에만 나눠 붙이기, 예문 루비 표기 [漢字|かんじ] 읽기

const WANAKANA = 'https://cdn.jsdelivr.net/npm/wanakana@5.3.1/+esm';
let wk = null;
export async function loadWanakana() {
  if (!wk) { try { wk = await import(WANAKANA); } catch { wk = false; } }
  return wk || null;
}

export const kataToHira = (s) => String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const hiraToKata = (s) => String(s || '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
export const isHiraganaOnly = (s) => /^[ぁ-ゖー\s]+$/.test(s);
export const isKanaOnly = (s) => /^[ぁ-ゖァ-ヺー\s]+$/.test(s);
export const isRomaji = (s) => /^[a-zA-Z\s'-]+$/.test(s) && /[aeiou]/i.test(s);

export async function romajiToHira(s) {
  const w = await loadWanakana();
  return w ? w.toHiragana(s) : s;
}

/* ---------------- 한글 발음 키 ---------------- */

// 한글 자모 번호 (초성 19, 중성 21, 종성 28)
const L = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const V = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const T = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
const compose = (l, v, t = 0) => String.fromCharCode(0xac00 + (l * 21 + v) * 28 + t);
const decompose = (ch) => {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  return [Math.floor(c / 588), Math.floor((c % 588) / 28), c % 28];
};

// 가나 1~2글자 → [한글 음절, 모음(a/i/u/e/o)]
const BASE = {
  あ: '아a', い: '이i', う: '우u', え: '에e', お: '오o',
  か: '카a', き: '키i', く: '쿠u', け: '케e', こ: '코o',
  が: '가a', ぎ: '기i', ぐ: '구u', げ: '게e', ご: '고o',
  さ: '사a', し: '시i', す: '스u', せ: '세e', そ: '소o',
  ざ: '자a', じ: '지i', ず: '즈u', ぜ: '제e', ぞ: '조o',
  た: '타a', ち: '치i', つ: '츠u', て: '테e', と: '토o',
  だ: '다a', ぢ: '지i', づ: '즈u', で: '데e', ど: '도o',
  な: '나a', に: '니i', ぬ: '누u', ね: '네e', の: '노o',
  は: '하a', ひ: '히i', ふ: '후u', へ: '헤e', ほ: '호o',
  ば: '바a', び: '비i', ぶ: '부u', べ: '베e', ぼ: '보o',
  ぱ: '파a', ぴ: '피i', ぷ: '푸u', ぺ: '페e', ぽ: '포o',
  ま: '마a', み: '미i', む: '무u', め: '메e', も: '모o',
  や: '야a', ゆ: '유u', よ: '요o',
  ら: '라a', り: '리i', る: '루u', れ: '레e', ろ: '로o',
  わ: '와a', ゐ: '이i', ゑ: '에e', を: '오o', ゔ: '부u',
  ぁ: '아a', ぃ: '이i', ぅ: '우u', ぇ: '에e', ぉ: '오o', ゃ: '야a', ゅ: '유u', ょ: '요o', ゎ: '와a',
};
const YOON = {
  きゃ: '캬a', きゅ: '큐u', きょ: '쿄o', ぎゃ: '갸a', ぎゅ: '규u', ぎょ: '교o',
  しゃ: '샤a', しゅ: '슈u', しょ: '쇼o', じゃ: '자a', じゅ: '주u', じょ: '조o',
  ちゃ: '차a', ちゅ: '추u', ちょ: '초o', ぢゃ: '자a', ぢゅ: '주u', ぢょ: '조o',
  にゃ: '냐a', にゅ: '뉴u', にょ: '뇨o', ひゃ: '햐a', ひゅ: '휴u', ひょ: '효o',
  びゃ: '뱌a', びゅ: '뷰u', びょ: '뵤o', ぴゃ: '퍄a', ぴゅ: '퓨u', ぴょ: '표o',
  みゃ: '먀a', みゅ: '뮤u', みょ: '묘o', りゃ: '랴a', りゅ: '류u', りょ: '료o',
  ふぁ: '파a', ふぃ: '피i', ふぇ: '페e', ふぉ: '포o', てぃ: '티i', でぃ: '디i', とぅ: '투u', どぅ: '두u',
  うぃ: '위i', うぇ: '웨e', うぉ: '워o', しぇ: '셰e', じぇ: '제e', ちぇ: '체e', つぁ: '차a',
  ゔぁ: '바a', ゔぃ: '비i', ゔぇ: '베e', ゔぉ: '보o', いぇ: '예e',
};
const LONG = { o: 'uo', e: 'ie', u: 'u', a: 'a', i: 'i' }; // 앞 모음 → 길게 만드는 뒤 모음 가나
const VOWEL_KANA = { あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o' };
const REPEAT = { a: '아', i: '이', u: '우', e: '에', o: '오' };

function syllables(hira) {
  const s = kataToHira(hira).replace(/\s/g, '');
  const out = []; // {h: 음절 또는 null, v, long: bool, kana}
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    const c = s[i];
    if (YOON[two]) { out.push({ h: YOON[two][0], v: YOON[two][1] }); i++; continue; }
    if (c === 'っ') { out.push({ sokuon: true }); continue; }
    if (c === 'ん') { out.push({ n: true }); continue; }
    if (c === 'ー') { const p = out[out.length - 1]; if (p?.v) out.push({ h: REPEAT[p.v], v: p.v, long: true }); continue; }
    const prev = out[out.length - 1];
    if (VOWEL_KANA[c] && prev?.v && LONG[prev.v].includes(VOWEL_KANA[c])) {
      out.push({ h: BASE[c][0], v: VOWEL_KANA[c], long: true, repeat: REPEAT[prev.v] });
      continue;
    }
    if (BASE[c]) { out.push({ h: BASE[c][0], v: BASE[c][1] }); continue; }
    // 그 밖의 글자(한자·영문 등)는 무시
  }
  return out;
}

function render(sy, mode) {
  // mode: 'literal' 코우 / 'repeat' 코오 / 'short' 코
  const res = [];
  for (const x of sy) {
    if (x.sokuon) { attachFinal(res, 'ㅅ'); continue; }
    if (x.n) { if (!attachFinal(res, 'ㄴ')) res.push('응'); continue; }
    if (x.long) {
      if (mode === 'short') continue;
      res.push(mode === 'repeat' && x.repeat ? x.repeat : x.h);
      continue;
    }
    res.push(x.h);
  }
  return res.join('');
}

function attachFinal(res, jamo) {
  const last = res[res.length - 1];
  const d = last && decompose(last);
  if (!d || d[2]) return false;
  res[res.length - 1] = compose(d[0], d[1], T.indexOf(jamo));
  return true;
}

// 후리가나 → 한글 발음 키들(긴 형태·되풀이 형태·줄인 형태). 저장할 때 자동으로 만든다.
export function hangulKeys(furigana) {
  const sy = syllables(furigana);
  return [...new Set(['literal', 'repeat', 'short'].map((m) => render(sy, m)))].filter(Boolean);
}
export const hangulKey = (furigana) => hangulKeys(furigana)[0] || '';

// 검색어와 키를 같은 규칙으로 정규화한다.
// 순서: つ(츠·쓰·쯔)·요음처럼 한 소리인 것 먼저 → 자음 통일 → 받침(ん·っ) 정리.
const TSU = new Set(['츠', '쓰', '쯔']);
const LMAP = { 'ㅋ': 'ㄱ', 'ㄲ': 'ㄱ', 'ㅌ': 'ㄷ', 'ㄸ': 'ㄷ', 'ㅍ': 'ㅂ', 'ㅃ': 'ㅂ', 'ㅊ': 'ㅈ', 'ㅉ': 'ㅈ', 'ㅆ': 'ㅅ' };
const VMAP_SJ = { 'ㅑ': 'ㅏ', 'ㅕ': 'ㅓ', 'ㅛ': 'ㅗ', 'ㅠ': 'ㅜ', 'ㅒ': 'ㅔ', 'ㅖ': 'ㅔ' };
export function normalizeHangul(str) {
  const out = [];
  for (const ch of String(str || '')) {
    const d = decompose(ch);
    if (!d) continue; // 띄어쓰기·기호 무시
    let [l, v, t] = d;
    let lj = L[l], vj = V[v], tj = T[t].trim();
    if (TSU.has(compose(l, v))) { out.push('Ⓣ' + finalTok(tj)); continue; }
    if (lj === 'ㅇ' && vj === 'ㅡ' && ['ㅇ', 'ㄴ', 'ㅁ'].includes(tj)) { // '응' = ん
      if (out.length && !/N$/.test(out[out.length - 1])) out[out.length - 1] += 'N'; else out.push('N');
      continue;
    }
    lj = LMAP[lj] || lj;
    if (lj === 'ㅅ' || lj === 'ㅈ') vj = VMAP_SJ[vj] || vj;
    if (vj === 'ㅐ') vj = 'ㅔ';
    out.push(lj + vj + finalTok(tj));
  }
  return out.join('');
}
function finalTok(tj) {
  if (!tj) return '';
  if (tj === 'ㄴ' || tj === 'ㅁ' || tj === 'ㅇ') return 'N';
  if (tj === 'ㅅ' || tj === 'ㅆ') return '';
  return tj;
}

export function hangulMatch(query, keys) {
  const q = normalizeHangul(query);
  if (!q) return null;
  let best = null;
  for (const k of keys || []) {
    const nk = normalizeHangul(k);
    if (nk === q) return 'exact';
    if (nk.startsWith(q)) best = 'prefix';
    else if (!best && nk.includes(q)) best = 'contains';
  }
  return best;
}

/* ---------------- 후리가나 나눠 붙이기 ---------------- */

const isK = (c) => /[㐀-鿿豈-﫿々〆ヶ]/.test(c);

// 受け継ぐ + うけつぐ → [{t:'受',r:'う'},{t:'け'},{t:'継',r:'つ'},{t:'ぐ'}]
export function alignFurigana(word, reading) {
  word = String(word || ''); reading = kataToHira(reading || '');
  if (!word) return [];
  if (![...word].some(isK)) return [{ t: word }];
  const runs = [];
  for (const c of word) {
    const k = isK(c);
    const last = runs[runs.length - 1];
    if (last && last.k === k) last.t += c; else runs.push({ t: c, k });
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + runs.map((r) => (r.k ? '(.+?)' : `(${esc(kataToHira(r.t))})`)).join('') + '$');
  const m = re.exec(reading);
  if (!m) return [{ t: word, r: reading }];
  return runs.map((r, i) => (r.k ? { t: r.t, r: m[i + 1] } : { t: r.t }));
}

// '[父|ちち]の[仕事|しごと]を[継|つ]いだ。' → [{t:'父',r:'ちち'},{t:'の'},...]
export function parseRuby(markup) {
  const out = [];
  const re = /\[([^|\]]+)\|([^\]]+)\]/g;
  let last = 0, m;
  const s = String(markup || '');
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    out.push({ t: m[1], r: m[2] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
}
export const rubyPlain = (markup) => parseRuby(markup).map((x) => x.t).join('');
