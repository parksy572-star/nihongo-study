// 작문 진행: 설정 → AI 질문(일본어만) → 손으로 쓰기(입시 타이머) → 사진 올리기(자르기·회전)
// → 글자 읽기 확인(건너뛸 수 없음) → 분석 → 저장. 진행 상태는 progress('writing')에 저장돼 다른 기기에서 이어서 한다.

import { h, icon, go, replace, toast, confirmDialog, modal, mmss, uid, field, segmented, chipToggle, debounce } from '../core.js';
import { db } from '../db.js';
import { runTask, blobKey, blobToBase64, busy } from '../ai.js';
import {
  writingQuestionPrompt, WRITING_QUESTION_SCHEMA, checkWritingQuestion,
  ocrPrompt, OCR_GRID_SCHEMA, OCR_PLAIN_SCHEMA, checkOcr,
  writingAnalyzePrompt, WRITING_ANALYZE_SCHEMA, checkWritingAnalysis,
} from '../../ai-rules.js';
import { editPhoto, aiImages, pickFiles } from '../photo.js';
import { dims, checkGenko, gridToText, gridText, charCount, VISUAL_RULES, RULE_NAME } from '../genko.js';
import { genkoRuleOn } from '../prefs.js';
import { loadJoyo } from '../kanji.js';
import { renderWritingResult, writingTitle } from './writing.js';
import { furi } from '../furigana.js';
import { keepAwake } from '../wake.js';

export const CATEGORIES = ['자기소개', '지원동기', '일상', '의견문', 'JLPT형', '입시 예상'];
const PAPERS = [['genko-h', '원고지 가로'], ['genko-v', '원고지 세로'], ['plain', '일반 종이']];

export function defaultGrid(chars) {
  if (chars === 200) return { rows: 10, cols: 20, pagesHint: 1 };
  if (chars === 800) return { rows: 20, cols: 20, pagesHint: 2 };
  return { rows: 20, cols: 20, pagesHint: 1 };
}

export function writingRunView(_p, _q, ctx) {
  let row = db.progress('writing');
  if (!row) {
    const last = db.settings().writingSetup || {};
    row = db.saveProgress('writing', {
      wid: uid(), phase: 'setup',
      setting: { category: last.category || '지원동기', situation: '', chars: last.chars || 400, paper: last.paper || 'genko-h', rows: last.rows || 20, cols: last.cols || 20, exam: !!last.exam, limitMin: last.limitMin || 40 },
      prevQuestions: [], pages: [], ocr: [], startedAt: new Date().toISOString(),
    });
  }
  const r = new WritingRunner(row.data, ctx);
  return { el: r.el, title: '작문 연습', back: () => go('/writing'), cleanup: () => r.destroy() };
}

class WritingRunner {
  constructor(state, ctx) {
    this.w = state;
    this.el = h('div', { class: 'stack' });
    this.alive = true;
    if (this.w.phase === 'ocr') this.w.phase = 'photos';
    if (this.w.phase === 'analyzing') this.w.phase = 'verify';
    this.tick = setInterval(() => this.onTick(), 1000);
    ctx.onDb((e) => this.onRemote(e));
    this.render();
  }
  destroy() { this.alive = false; clearInterval(this.tick); this.saveSoon.flush?.(); }
  save() { if (!this.alive || this.ended) return; const r = db.saveProgress('writing', this.w); this.myAt = r.data._at; this.dirty = false; }
  saveSoon = debounce(() => this.save(), 1500);

  // 긴 글(읽은 글 수정) 동시 수정: 덮어쓰기 전에 알린다
  async onRemote(e) {
    if (e.kind !== 'progress' || !e.remote) return;
    if (e.type === 'delete') { if (!this.ended) { toast('다른 기기에서 이 작문을 끝냈어요'); go('/writing'); } return; }
    if (e.row?.data?.type !== 'writing' || e.row.data._at === this.myAt) return;
    if (this.dirty) {
      const pick = await modal({
        title: '다른 기기에서 바뀜',
        body: h('p', null, '다른 기기에서 이 작문을 수정했어요. 어느 쪽을 남길까요?'),
        actions: [{ label: '이 기기 내용 유지', value: 'mine' }, { label: '다른 기기 내용 불러오기', value: 'theirs', primary: true }],
        dismissible: false,
      });
      if (pick === 'mine') { this.save(); return; }
    }
    this.w = e.row.data;
    toast('다른 기기에서 진행한 내용을 불러왔어요');
    this.render();
  }

  onTick() {
    if (!this.timerEl || !this.w.timer?.startedAt) return;
    const limit = this.w.timer.limitMin * 60;
    const used = ((this.w.timer.stoppedAt ? new Date(this.w.timer.stoppedAt) : new Date()) - new Date(this.w.timer.startedAt)) / 1000;
    const rem = limit - used;
    this.timerEl.textContent = rem >= 0 ? mmss(rem) : '+' + mmss(-rem);
    this.timerEl.classList.toggle('over', rem < 60);
    if (rem <= 0 && !this.w.timer.alerted) {
      this.w.timer.alerted = true; this.save();
      toast('제한 시간이 끝났어요', 'err', 4000);
      navigator.vibrate?.([200, 100, 200]);
    }
  }

  render() {
    if (!this.alive) return;
    const ph = this.w.phase;
    this.timerEl = null;
    let body;
    if (ph === 'setup') body = this.setupView();
    else if (ph === 'question') body = this.questionView();
    else if (ph === 'photos') body = this.photosView();
    else if (ph === 'verify') body = this.verifyView();
    else if (ph === 'result') body = this.resultView();
    else body = h('div', { class: 'loading' }, h('span', { class: 'spin' }));
    replace(this.el, body);
  }

  /* ---------- 1. 설정 ---------- */
  setupView() {
    const s = this.w.setting;
    const situation = h('input', { value: s.situation || '', placeholder: '상황을 직접 입력 (선택) 예: 학교에서 본 패션쇼의 감상' });
    const rows = h('input', { type: 'number', min: 5, max: 30, value: s.rows, style: { width: '80px' } });
    const cols = h('input', { type: 'number', min: 5, max: 30, value: s.cols, style: { width: '80px' } });
    const limit = h('input', { type: 'number', min: 5, max: 120, value: s.limitMin, style: { width: '90px' } });
    const gridRow = h('div', { class: 'row wrap' }, h('span', { class: 'field-label' }, '원고지 칸'), rows, h('span', null, '행 ×'), cols, h('span', null, '칸'));
    const catChips = h('div', { class: 'chips' });
    const drawCats = () => replace(catChips, CATEGORIES.map((c) => chipToggle(c, s.category === c, () => { s.category = c; drawCats(); })));
    drawCats();
    const updGridVis = () => { gridRow.hidden = s.paper === 'plain'; };
    updGridVis();
    const qBtn = h('button', { type: 'button', class: 'wide' }, icon('pen', 18), '질문 받기');
    qBtn.addEventListener('click', async () => {
      s.situation = situation.value.trim();
      s.rows = Math.max(5, Math.min(30, Number(rows.value) || 20));
      s.cols = Math.max(5, Math.min(30, Number(cols.value) || 20));
      s.limitMin = Math.max(5, Math.min(120, Number(limit.value) || 40));
      db.setSettings({ writingSetup: { category: s.category, chars: s.chars, paper: s.paper, rows: s.rows, cols: s.cols, exam: s.exam, limitMin: s.limitMin } });
      const done = busy(qBtn, '질문 만드는 중…');
      try { await this.newQuestion(); this.w.phase = 'question'; this.save(); this.render(); } catch (e) { toast(e.message, 'err', 5000); done(); }
    });
    return h('div', { class: 'panel stack' },
      h('h2', null, '작문 설정'),
      h('div', { class: 'stack tight' }, h('span', { class: 'field-label' }, '카테고리'), catChips),
      situation,
      field('목표 글자 수', segmented([[200, '200자'], [400, '400자'], [800, '800자']], s.chars, (v) => { s.chars = v; const g = defaultGrid(v); s.rows = g.rows; s.cols = g.cols; rows.value = g.rows; cols.value = g.cols; })),
      field('쓰는 종이', segmented(PAPERS, s.paper, (v) => { s.paper = v; updGridVis(); })),
      gridRow,
      h('div', { class: 'row wrap' },
        chipToggle('입시 연습 타이머', s.exam, (v) => { s.exam = v; }),
        limit, h('span', { class: 'muted small' }, '분 (실제 시험은 필기+작문 70분)')),
      qBtn);
  }

  async newQuestion() {
    const s = this.w.setting;
    const prev = this.w.prevQuestions || [];
    const res = await runTask({
      task: 'writingQuestion',
      prompt: writingQuestionPrompt({ category: s.category, situation: s.situation, chars: s.chars, previous: prev }),
      schema: WRITING_QUESTION_SCHEMA, check: (j) => checkWritingQuestion(j, prev),
    });
    this.w.question = { ja: res.result.question_ja.trim(), ko: res.result.question_ko };
    this.w.prevQuestions = [...prev, this.w.question.ja].slice(-10);
  }

  /* ---------- 2. 질문 ---------- */
  questionView() {
    const other = h('button', { type: 'button', class: 'plain' }, icon('refresh', 16), '다른 질문');
    other.addEventListener('click', async () => {
      const done = busy(other, '바꾸는 중…');
      try { await this.newQuestion(); this.save(); this.render(); } catch (e) { toast(e.message, 'err'); done(); }
    });
    return h('div', { class: 'stack' },
      furi(this.w.question.ja, { cls: 'q-box', tag: 'div' }),
      h('p', { class: 'hint' }, '해석은 분석 후에 공개돼요.'),
      h('div', { class: 'row wrap' }, other,
        h('button', { type: 'button', class: 'grow', onclick: () => {
          if (this.w.setting.exam) this.w.timer = { startedAt: new Date().toISOString(), limitMin: this.w.setting.limitMin };
          else this.w.timer = { startedAt: new Date().toISOString(), limitMin: 0, free: true };
          this.w.phase = 'photos'; this.save(); this.render();
        } }, icon('pen', 16), '이 질문으로 쓰기')));
  }

  /* ---------- 3. 쓰기 + 사진 ---------- */
  photosView() {
    const s = this.w.setting;
    const thumbs = h('div', { class: 'photo-strip' });
    const urls = [];
    this.w.pages.forEach((p, i) => {
      const img = h('img', { alt: `${i + 1}쪽` });
      db.fileUrl(p.path).then((u) => { urls.push(u); img.src = u; }).catch(() => { img.alt = '불러오지 못함'; });
      thumbs.append(h('div', { class: 'thumb' }, img, h('span', { class: 'pg' }, `${i + 1}쪽`),
        h('div', { class: 'thumb-tools' },
          h('button', { type: 'button', class: 'icon-btn', title: '앞으로', disabled: i === 0, onclick: () => { const a = this.w.pages; [a[i - 1], a[i]] = [a[i], a[i - 1]]; this.w.ocr = []; this.save(); this.render(); } }, icon('left', 16)),
          h('button', { type: 'button', class: 'icon-btn', title: '삭제', onclick: async () => {
            if (!(await confirmDialog(`${i + 1}쪽 사진을 뺄까요?`, { ok: '빼기' }))) return;
            db.removeFiles([p.path]); this.w.pages.splice(i, 1); this.w.ocr = []; this.save(); this.render();
          } }, icon('trash', 16)))));
    });
    const grid = s.paper === 'plain' ? null : { rows: s.rows, cols: s.cols };
    const add = async (camera) => {
      const files = await pickFiles({ camera });
      for (const f of files) {
        const out = await editPhoto(f, { grid });
        if (!out) continue;
        const n = this.w.pages.length + 1;
        const path = await db.upload(`writing/${this.w.wid}/p${n}-${Date.now()}.jpg`, out.blob, 'image/jpeg');
        this.w.pages.push({ path, w: out.width, h: out.height, key: await blobKey(out.blob) });
        this.w.ocr = [];
        this.save();
        this.render();
      }
    };
    const timer = this.w.timer && !this.w.timer.free;
    if (timer) this.timerEl = h('div', { class: 'timer-big' }, '--:--');
    const readBtn = h('button', { type: 'button', class: 'wide', disabled: !this.w.pages.length }, icon('check', 18), '글자 읽기');
    readBtn.addEventListener('click', () => this.runOcr(readBtn));
    setTimeout(() => this.onTick(), 0);
    return h('div', { class: 'stack' },
      h('div', { class: 'panel stack' },
        h('div', { class: 'row between' }, h('b', null, '질문'), timer ? this.timerEl : h('span', { class: 'tag gray' }, `${s.chars}자 · ${PAPERS.find((p) => p[0] === s.paper)[1]}`)),
        furi(this.w.question.ja, { tag: 'p' })),
      h('div', { class: 'panel stack' },
        h('h2', null, '손으로 쓴 답 사진 올리기'),
        h('p', { class: 'hint' }, s.paper === 'plain' ? '글이 잘 보이게 밝은 곳에서 찍어 주세요. 여러 장도 돼요.' : '원고지 한 장씩 찍고, 자를 때 노란 칸 맞춤선을 원고지 칸에 맞춰 주세요. 흐리거나 기울면 잘못 읽혀요.'),
        h('div', { class: 'row wrap' },
          h('button', { type: 'button', class: 'soft', onclick: () => add(true) }, icon('camera', 18), '카메라'),
          h('button', { type: 'button', class: 'plain', onclick: () => add(false) }, icon('image', 18), '파일에서')),
        this.w.pages.length ? thumbs : h('p', { class: 'muted small' }, '아직 올린 사진이 없어요.'),
        readBtn));
  }

  async runOcr(btn) {
    const s = this.w.setting;
    const awake = keepAwake(); // 읽는 동안 화면이 꺼지지 않게
    const done0 = busy(btn, '사진 속 글자 읽는 중…');
    const done = () => { done0(); awake(); };
    if (this.w.timer && !this.w.timer.stoppedAt) this.w.timer.stoppedAt = new Date().toISOString();
    this.w.phase = 'ocr';
    this.save();
    try {
      const results = [];
      for (let i = 0; i < this.w.pages.length; i++) {
        btn.textContent = `${i + 1} / ${this.w.pages.length}쪽 읽는 중… (20~40초)`;
        const p = this.w.pages[i];
        const blob = await db.download(p.path);
        const imgs = await aiImages(blob, s);
        const media = [{ mimeType: 'image/jpeg', data: await blobToBase64(imgs.full) }];
        for (const t of imgs.tiles) media.push({ mimeType: 'image/jpeg', data: await blobToBase64(t) });
        const res = await runTask({
          task: 'writingOcr',
          prompt: ocrPrompt({ paper: s.paper, rows: s.rows, cols: s.cols, tiles: imgs.desc }),
          media, schema: s.paper === 'plain' ? OCR_PLAIN_SCHEMA : OCR_GRID_SCHEMA,
          check: (j) => checkOcr(j, s), cacheKey: `${p.key || await blobKey(blob)}|${s.paper}|${s.rows}x${s.cols}`,
        });
        const j = structuredClone(res.result);
        const chk = checkOcr(j, s);
        results.push(s.paper === 'plain' ? { lines: j.lines, warnings: chk.warnings } : { grid: j.grid, warnings: chk.warnings });
      }
      this.w.ocr = results;
      this.w.phase = 'verify';
      this.save();
      awake();
      this.render();
    } catch (e) {
      toast(e.message, 'err', 5000);
      this.w.phase = 'photos';
      this.save();
      done();
    }
  }

  /* ---------- 4. 글자 읽기 확인 ---------- */
  verifyView() {
    const s = this.w.setting;
    const box = h('div', { class: 'stack' },
      h('div', { class: 'panel stack' },
        h('h2', null, '읽은 글자 확인'),
        h('p', { class: 'hint' }, 'AI가 사진에서 읽은 결과예요. 잘못 읽은 칸만 고치세요. 내가 잘못 쓴 한자는 고치지 말고 그대로 두세요(그래야 틀린 한자를 찾아요). 노란 칸「？」은 AI가 알아보지 못한 칸이에요.')));
    this.w.pages.forEach((p, i) => {
      const o = this.w.ocr[i];
      const img = h('img', { alt: `${i + 1}쪽`, style: { width: '100%', borderRadius: '12px', display: 'block' } });
      db.fileUrl(p.path).then((u) => { img.src = u; });
      const editor = s.paper === 'plain' ? this.plainEditor(o) : this.gridEditor(o, s);
      box.append(h('div', { class: 'panel stack' },
        h('b', null, `${i + 1}쪽`),
        ...(o.warnings || []).map((w) => h('p', { class: 'note warn' }, w)),
        h('details', { open: i === 0 }, h('summary', { class: 'hint' }, '사진 보기'), img),
        editor));
    });
    const count = charCount(this.w.ocr);
    const btn = h('button', { type: 'button', class: 'wide' }, icon('check', 18), '분석하기');
    btn.addEventListener('click', () => this.analyze(btn));
    box.append(h('div', { class: 'panel stack' },
      h('p', { class: 'muted small' }, `읽은 글자 ${count}자 / 목표 ${s.chars}자`),
      btn,
      h('button', { type: 'button', class: 'ghost small', onclick: () => { this.w.phase = 'photos'; this.save(); this.render(); } }, '사진 다시 올리기')));
    return box;
  }

  gridEditor(o, s) {
    const { lines, cells } = dims(s.paper, s.rows, s.cols);
    const vertical = s.paper === 'genko-v';
    const size = Math.max(14, Math.min(24, Math.floor((Math.min(window.innerWidth, 720) - 72) / (vertical ? lines : cells))));
    const wrap = h('div', { class: ['genko', vertical && 'v'], style: { '--cell': size + 'px' } });
    wrap.style.setProperty('--cell', size + 'px');
    const input = (l, c) => {
      const v = o.grid[l]?.[c] || '';
      const el = h('input', { class: ['cell', v.includes('？') && 'q'], value: v, maxlength: 2, lang: 'ja', 'aria-label': `${l + 1}${vertical ? '줄' : '행'} ${c + 1}칸` });
      el.addEventListener('input', () => { o.grid[l][c] = el.value.trim().slice(0, 2); el.classList.toggle('q', el.value.includes('？')); this.dirty = true; this.saveSoon(); });
      el.addEventListener('focus', () => el.select());
      return el;
    };
    if (!vertical) {
      for (let l = 0; l < lines; l++) {
        const r = h('div', { class: 'genko-row', style: { gridTemplateColumns: `repeat(${cells}, var(--cell))` } });
        for (let c = 0; c < cells; c++) r.append(input(l, c));
        wrap.append(r);
      }
      wrap.style.gridTemplateRows = `repeat(${lines}, var(--cell))`;
    } else {
      wrap.style.gridTemplateColumns = `repeat(${lines}, var(--cell))`;
      wrap.style.gridAutoFlow = 'column';
      for (let l = 0; l < lines; l++) {
        const col = h('div', { class: 'genko-col', style: { gridTemplateRows: `repeat(${cells}, var(--cell))` } });
        for (let c = 0; c < cells; c++) col.append(input(l, c));
        wrap.append(col);
      }
    }
    return h('div', { class: 'genko-scroll' }, wrap);
  }

  plainEditor(o) {
    const ta = h('textarea', { class: 'transcript-edit', lang: 'ja', rows: Math.max(6, o.lines.length + 2) }, o.lines.map((l) => l.text).join('\n'));
    ta.addEventListener('input', () => {
      const texts = ta.value.split('\n');
      o.lines = texts.map((t, i) => ({ text: t, box_2d: o.lines[i]?.box_2d || null }));
      this.dirty = true; this.saveSoon();
    });
    return ta;
  }

  /* ---------- 5. 분석 ---------- */
  async analyze(btn) {
    const s = this.w.setting;
    const awake = keepAwake(); // 분석하는 동안 화면이 꺼지지 않게
    const done0 = busy(btn, '분석 중… (20~40초)');
    const done = () => { done0(); awake(); };
    this.w.phase = 'analyzing';
    this.save();
    try {
      const enabled = (k) => genkoRuleOn(k) && (k !== 'choon' || s.paper === 'genko-v');
      const local = checkGenko(this.w.ocr, { paper: s.paper, rows: s.rows, cols: s.cols, enabled });
      const visualRules = s.paper === 'plain' ? [] : VISUAL_RULES.filter(enabled).map((k) => RULE_NAME[k]);
      const text = gridToText(this.w.ocr, s.paper, s.rows, s.cols);
      const gt = gridText(this.w.ocr, s.paper);
      const media = [];
      for (const p of this.w.pages) {
        const blob = await db.download(p.path);
        const imgs = await aiImages(blob, s);
        media.push({ mimeType: 'image/jpeg', data: await blobToBase64(imgs.full) });
      }
      const joyo = await loadJoyo();
      const ctx = { paper: s.paper, pages: this.w.pages.length, rows: s.rows, cols: s.cols, visualRules, isJoyo: (c) => joyo.has(c) };
      const res = await runTask({
        task: 'writingAnalyze',
        prompt: writingAnalyzePrompt({ question: this.w.question.ja, text, gridText: gt, paper: s.paper, visualRules }),
        media, schema: WRITING_ANALYZE_SCHEMA,
        check: (j) => checkWritingAnalysis(j, ctx),
        cacheKey: await blobKey(new Blob([this.w.pages.map((p) => p.key).join(',') + '|' + text + '|' + gt + '|' + visualRules.join(',') + '|' + this.w.question.ja])),
      });
      const a = structuredClone(res.result);
      checkWritingAnalysis(a, ctx);
      this.w.text = text;
      this.w.analysis = a;
      this.w.local = local;
      this.w.warnings = res.cached ? ['같은 사진·글이라 저장된 분석 결과를 보여줘요.', ...res.warnings] : res.warnings;
      this.w.phase = 'result';
      this.save();
      awake();
      this.render();
    } catch (e) {
      toast(e.message, 'err', 5000);
      this.w.phase = 'verify';
      this.save();
      done();
    }
  }

  /* ---------- 6. 결과·저장 ---------- */
  resultView() {
    const saveBtn = h('button', { type: 'button', class: 'wide' }, icon('check', 18), '작문 기록으로 저장');
    saveBtn.addEventListener('click', () => this.finish());
    return h('div', { class: 'stack' },
      renderWritingResult(this.w),
      h('div', { class: 'panel stack' }, saveBtn,
        h('button', { type: 'button', class: 'ghost small', onclick: () => { this.w.phase = 'verify'; this.save(); this.render(); } }, '읽은 글자 다시 고치기')));
  }

  finish() {
    const t = this.w.timer;
    const data = {
      ...this.w, phase: undefined, type: undefined,
      title: writingTitle(this.w),
      savedAt: new Date().toISOString(),
      elapsedSec: t?.startedAt ? Math.round(((t.stoppedAt ? new Date(t.stoppedAt) : new Date()) - new Date(t.startedAt)) / 1000) : null,
    };
    delete data.phase; delete data.type;
    this.ended = true;
    const row = db.put('writing', data);
    db.clearProgress('writing');
    toast('작문 기록을 저장했어요');
    go('/writing/' + row.id, { replace: true });
  }
}
