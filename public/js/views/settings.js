// 공통 설정: 모두 settings 행 하나에 저장(기기 간 동기화). 기기 내장 음성 선택만 이 기기에 저장.
import { h, icon, replace, segmented, chipToggle, toast, store, confirmDialog, fmtDate } from '../core.js';
import { db } from '../db.js';
import { GENKO_RULES, genkoRuleOn } from '../prefs.js';
import { GEMINI_VOICES, deviceVoices, speak, unlock } from '../tts.js';
import { listModels } from '../ai.js';
import { isFreeModel } from '../../ai-rules.js';
import { parseCsv, saveWord } from './words.js';

const row = (label, control, hint) => h('div', { class: 'set-row' }, h('span', null, label, hint && h('span', { class: 'hint', style: { display: 'block', fontWeight: 400 } }, hint)), control);

export function settingsView(_p, _q, ctx) {
  const el = h('div', { class: 'stack' });
  const set = (patch) => db.setSettings(patch);
  const draw = () => {
    const s = db.settings();
    const sample = '本日はどうぞよろしくお願いいたします。';
    const voiceSel = h('select', { style: { maxWidth: '230px' }, onchange: (e) => set({ voice: e.target.value }) },
      h('optgroup', { label: 'Gemini 음성 (모든 기기 공통)' }, GEMINI_VOICES.map(([n, d]) => h('option', { value: 'gemini:' + n, selected: (s.voice || 'gemini:Kore') === 'gemini:' + n }, `${n} — ${d}`))),
      h('option', { value: 'device', selected: s.voice === 'device' }, '이 기기 음성 (오프라인·무료)'));
    const dv = deviceVoices();
    const devSel = h('select', { style: { maxWidth: '230px' }, onchange: (e) => store.set('deviceVoice', e.target.value) },
      dv.length ? dv.map((v) => h('option', { value: v.voiceURI, selected: store.get('deviceVoice') === v.voiceURI }, v.name)) : h('option', null, '일본어 기기 음성 없음'));
    const voicePick = (key, def) => h('select', { style: { maxWidth: '200px' }, onchange: (e) => set({ [key]: e.target.value }) },
      GEMINI_VOICES.map(([n, d]) => h('option', { value: n, selected: (s[key] || def) === n }, `${n} — ${d}`)));

    const models = s.models || {};
    const modelBox = h('div', { class: 'stack tight' }, h('p', { class: 'muted small' }, `분석·교정·발음: ${models.flash || '자동'} · 질문·초안·후리가나: ${models.lite || '자동'} · 음성: ${models.tts || '자동'}`));
    const loadModels = h('button', { type: 'button', class: 'ghost small' }, '모델 목록 불러오기');
    loadModels.onclick = async () => {
      loadModels.disabled = true;
      try {
        const list = (await listModels()).map((m) => m.id).filter((id) => /gemini/.test(id) && !/embed|image|live|aqa/.test(id));
        const sel = (key, filter) => h('select', { onchange: (e) => set({ models: { ...db.settings().models, [key]: e.target.value } }) },
          list.filter(filter).map((id) => h('option', { value: id, selected: models[key] === id }, `${isFreeModel(id) ? '★ ' : ''}${id}`)));
        replace(modelBox,
          row('분석·교정·발음 (Flash)', sel('flash', (id) => !/tts/.test(id))),
          row('질문·단어 초안·후리가나 (Flash-Lite)', sel('lite', (id) => !/tts/.test(id))),
          row('음성 (TTS)', sel('tts', (id) => /tts/.test(id))),
          h('p', { class: 'hint' }, '★ 표시가 무료 등급 모델이에요. 무료 한도는 Google AI Studio에서 확인하세요.'));
      } catch (e) { toast(e.message, 'err'); loadModels.disabled = false; }
    };

    replace(el,
      h('div', { class: 'panel' },
        h('h2', null, '보기'),
        row('후리가나 (모든 한자 위)', segmented([[true, '켜기'], [false, '끄기']], s.furigana !== false, (v) => set({ furigana: v }), { small: true }),
          '질문·답변·교정·예문 등 일본어 문장의 한자 위에 히라가나를 작게 표시해요. 단어 테스트·가리기에서는 정답이 보이지 않게 표시하지 않아요.'),
        row('기본 보기 형식', segmented([['list', '리스트형'], ['card', '카드형']], s.defaultView || 'list', (v) => set({ defaultView: v, viewModes: {} }), { small: true }), '각 목록 왼쪽 아래 버튼으로도 바꿀 수 있고, 화면별로 마지막 선택을 기억해요.'),
        row('가리기 — 리스트형', segmented([[false, '모두 표시'], [true, '가리기']], s.hideList === true, (v) => set({ hideList: v }), { small: true })),
        row('가리기 — 카드형', segmented([[false, '모두 표시'], [true, '가리기']], s.hideCard !== false, (v) => set({ hideCard: v }), { small: true }), '누를 때마다 후리가나 → 뜻 → 숨김'),
        row('단어 후리가나 위치', segmented([['whole', '단어 전체 위'], ['kanji', '한자 위에만']], s.furiganaPos || 'whole', (v) => set({ furiganaPos: v }), { small: true })),
        row('글자 크기', segmented([['small', '작게'], ['normal', '보통'], ['large', '크게']], s.fontSize || 'normal', (v) => set({ fontSize: v }), { small: true })),
        row('테마', segmented([['light', '라이트'], ['dark', '다크'], ['system', '시스템']], s.theme || 'system', (v) => set({ theme: v }), { small: true }))),
      h('div', { class: 'panel' },
        h('h2', null, '듣기'),
        row('음성', voiceSel),
        s.voice === 'device' && row('이 기기의 일본어 음성', devSel, '기기마다 따로 저장돼요'),
        row('듣기 속도', segmented([[0.8, '0.8배'], [1, '1.0배'], [1.2, '1.2배']], Number(s.rate) || 1, (v) => set({ rate: v }), { small: true })),
        row('면접관 음성', voicePick('interviewerVoice', 'Charon')),
        row('다른 지원자 음성', voicePick('otherVoice', 'Leda')),
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'soft small', onclick: () => { unlock(); speak(sample); } }, icon('speaker', 14), '들어 보기'))),
      h('div', { class: 'panel' },
        h('h2', null, '연습'),
        row('답변 목표 시간', segmented([[30, '30초'], [45, '45초'], [60, '60초']], Number(s.answerSeconds) || 45, (v) => set({ answerSeconds: v }), { small: true }), '10분을 두 사람이 나누므로 1분을 넘지 않게'),
        row('연속 정답 횟수', segmented([[1, 'x1'], [2, 'x2'], [3, 'x3']], Number(s.streak) || 1, (v) => set({ streak: v }), { small: true }), '단어 테스트·면접 복습'),
        h('div', { class: 'set-row', style: { display: 'grid' } },
          h('span', null, '원고지 검사 항목', h('span', { class: 'hint', style: { display: 'block', fontWeight: 400 } }, '학교·시험마다 규칙이 다를 수 있어요. 장음·한자 숫자는 세로쓰기에서만 검사해요.')),
          h('div', { class: 'chips' }, GENKO_RULES.map(([k, name, desc]) => {
            const c = chipToggle(name, genkoRuleOn(k), (on) => set({ genkoRules: { ...(db.settings().genkoRules || {}), [k]: on } }));
            c.title = desc;
            return c;
          })))),
      h('div', { class: 'panel' }, h('h2', null, 'AI 모델'), modelBox, h('div', { class: 'row end' }, loadModels)),
      h('div', { class: 'panel stack' },
        h('h2', null, '데이터'),
        h('p', { class: 'hint' }, '모든 데이터는 Supabase에 내 계정 전용으로 저장돼요. 무료 프로젝트는 1주일 쓰지 않으면 일시 중지되니 한 달에 한 번 백업을 내보내 두세요.'),
        s.lastBackup && h('p', { class: 'muted small' }, `마지막 백업: ${fmtDate(s.lastBackup, true)}`),
        h('div', { class: 'row wrap' },
          h('button', { type: 'button', class: 'soft small', onclick: exportJson }, icon('download', 14), '백업 내보내기 (JSON)'),
          h('button', { type: 'button', class: 'plain small', onclick: exportCsv }, icon('download', 14), '단어 CSV'),
          h('button', { type: 'button', class: 'plain small', onclick: importBackup }, icon('upload', 14), '가져오기 (JSON·CSV)'))),
      h('div', { class: 'panel stack' },
        h('h2', null, '계정'),
        h('p', { class: 'muted small' }, db.user?.email || ''),
        h('div', { class: 'row wrap' },
          h('a', { class: 'btn ghost small', href: '/check.html' }, '0단계 점검 페이지'),
          h('button', { type: 'button', class: 'ghost small', onclick: async () => { if (await confirmDialog('로그아웃할까요?')) db.signOut(); } }, '로그아웃'))),
      h('p', { class: 'credit' }, '한자 데이터: KANJIDIC2 (EDRDG, CC BY-SA 4.0) · 획순: KanjiVG (© Ulrich Apel, CC BY-SA 3.0) · 상용 음훈: 文化庁「常用漢字表」(2010)·위키백과 常用漢字一覧(CC BY-SA 4.0) 대조'));
  };
  draw();
  ctx.onDb((e) => { if (e.kind === 'settings' && e.remote) draw(); });
  return { el, title: '설정', back: true };
}

function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportJson() {
  const kinds = ['word', 'kanji', 'grammar', 'preset', 'session', 'writing', 'log', 'settings'];
  const items = kinds.flatMap((k) => db.all(k)).map((r) => ({ id: r.id, kind: r.kind, data: r.data, created_at: r.created_at }));
  const d = new Date();
  download(`nihongo-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`,
    JSON.stringify({ app: 'nihongo-study', version: 1, exportedAt: d.toISOString(), items }, null, 1), 'application/json');
  db.setSettings({ lastBackup: d.toISOString() });
  toast('백업 파일을 저장했어요 (녹음·사진 파일은 보관함에 그대로 있어요)');
}

function exportCsv() {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['원문', '후리가나', '뜻', '레벨', '품사', '예문', '해석', '태그'].join(',')];
  for (const r of db.all('word')) {
    const d = r.data;
    lines.push([d.orig, d.furigana, d.meaning, d.level, d.pos, d.example, d.exampleKo, (d.tags || []).join(';')].map(esc).join(','));
  }
  download('nihongo-words.csv', '﻿' + lines.join('\n'), 'text/csv');
}

function importBackup() {
  const input = h('input', { type: 'file', accept: '.json,.csv,.tsv,.txt' });
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    const text = await f.text();
    if (/\.json$/i.test(f.name)) {
      let j;
      try { j = JSON.parse(text); } catch { toast('JSON 파일을 읽지 못했어요', 'err'); return; }
      const items = (j.items || []).filter((x) => x.kind && x.data && x.kind !== 'settings');
      if (!(await confirmDialog(`백업의 ${items.length}개 항목을 가져올까요? 같은 항목은 백업 내용으로 바뀌어요.`))) return;
      for (const it of items) db.put(it.kind, it.data, it.id);
      toast(`${items.length}개를 가져왔어요`);
    } else {
      const rows = parseCsv(text);
      const body = rows[0]?.[0]?.trim() === '원문' ? rows.slice(1) : rows;
      let n = 0;
      for (const r of body) if (r[0] && r[1] && r[2]) { saveWord({ orig: r[0], furigana: r[1], meaning: r[2], level: r[3] || '', pos: r[4] || '', example: r[5] || '', exampleKo: r[6] || '', tags: r[7] || '' }); n++; }
      toast(`단어 ${n}개를 가져왔어요`);
    }
  };
  input.click();
}
