// 회화·면접 진행 화면
// 연습: 질문 → (다른 지원자) → 내 답 녹음 → 받아쓰기 확인 → 분석 → [다음 질문 / 다시 답하기 / 종료]
// 실전: 10분 타이머(멈추지 않음). 입실 인사 → 질문 반복 → 시간이 되면 마무리 인사 → 받아쓰기 확인 → 전체 분석 → 저장
// 진행 상태는 단계마다 progress 행에 저장되어 다른 기기에서 이어서 할 수 있다.

import { h, icon, go, replace, toast, confirmDialog, modal, mmss, uid, field } from '../core.js';
import { db } from '../db.js';
import { runTask, blobKey, blobToBase64, busy } from '../ai.js';
import { speak, prepare, unlock, stopAll, voiceSettings } from '../tts.js';
import { Recorder, toWav16k, speechLevel } from '../../audio.js';
import {
  interviewQuestionPrompt, QUESTION_SCHEMA, checkQuestion,
  otherCandidatePrompt, OTHER_SCHEMA, checkOther,
  transcribePrompt, TRANSCRIBE_SCHEMA, checkTranscribe,
  interviewAnalyzePrompt, INTERVIEW_ANALYZE_SCHEMA, checkInterviewAnalysis,
  similarity,
} from '../../ai-rules.js';
import { scriptFor, talkTitle, lastAttempt } from '../talk-common.js';
import { targetSeconds } from '../prefs.js';
import { renderAnalysis, listenBtn, playRecording } from '../analysis-ui.js';
import { furi } from '../furigana.js';

export function talkRunView(_p, _q, ctx) {
  const row = db.progress('talk');
  if (!row) { go('/talk', { replace: true }); return null; }
  const runner = new TalkRunner(row.data, ctx);
  return { el: runner.el, title: runner.title(), back: () => runner.leave(), immersive: true, cleanup: () => runner.destroy() };
}

class TalkRunner {
  constructor(state, ctx) {
    this.t = state;
    this.ctx = ctx;
    this.el = h('div', { class: 'stage' });
    this.recorder = new Recorder();
    this.alive = true;
    this.busyAi = false;
    this.target = targetSeconds();
    this.conv = state.kind === 'conversation';
    this.real = state.mode === 'real';
    this.script = scriptFor(state.setting);
    this.vs = voiceSettings();
    if (this.vs.other === this.vs.interviewer) this.vs.other = this.vs.interviewer === 'Leda' ? 'Kore' : 'Leda';
    // 녹음 중·처리 중이던 단계에서 다시 열면(새로고침·다른 기기) 안전한 단계로 되돌린다
    const p = this.t.phase;
    const hasAttempt = !!lastAttempt(this.curTurn() || {});
    if (p === 'recording') this.t.phase = 'ready';
    if (p === 'transcribing' || p === 'waiting') this.t.phase = hasAttempt ? (this.real ? 'next' : 'review') : 'ready';
    if (p === 'analyzing') this.t.phase = 'review';
    if (p === 'analyzing-all') this.t.phase = 'review-all';
    if (this.t.phase === 'ready' && !this.curTurn()) this.t.phase = 'next';
    this.tick = setInterval(() => this.onTick(), 500);
    ctx.onDb((e) => this.onRemote(e));
    this.render();
  }

  title() { return this.conv ? '회화 연습' : this.real ? '실전 면접' : '면접 연습'; }
  curTurn() { return this.t.turns[this.t.cur] || null; }
  // 끝냈거나 화면을 떠난 뒤에는 저장하지 않는다(늦게 끝난 음성·요청이 진행 상태를 되살리지 않게)
  save() { if (!this.alive || this.ended) return; this.t.updated = Date.now(); const r = db.saveProgress('talk', this.t); this.myAt = r.data._at; }

  destroy() {
    this.alive = false;
    clearInterval(this.tick);
    clearTimeout(this._st);
    if (this.recorder.recording) this.recorder.stop();
    this.stopMeter();
    stopAll();
  }

  async leave() {
    if (this.recorder.recording) { toast('녹음을 먼저 끝내 주세요'); return; }
    if (this.real && ['lobby', 'review-all', 'results'].includes(this.t.phase) === false && this.remaining() > 0) {
      if (!(await confirmDialog('실전 면접 중이에요. 나가도 타이머는 계속 돌아요. 나갈까요?', { ok: '나가기' }))) return;
    }
    go('/talk');
  }

  // 다른 기기에서 같은 진행 상태가 바뀌면 알림 후 새로 그림
  onRemote(e) {
    if (e.kind !== 'progress' || !e.remote) return;
    if (e.type === 'delete') { toast('다른 기기에서 이 기록을 끝냈어요'); go('/talk'); return; }
    if (e.row?.data?.type !== 'talk' || e.row.data._at === this.myAt) return;
    if (this.recorder.recording || this.busyAi) { toast('다른 기기에서 진행 상태가 바뀌었어요. 지금 작업을 마치면 이 기기 기준으로 저장돼요.'); return; }
    this.t = e.row.data;
    toast('다른 기기에서 진행한 내용을 불러왔어요');
    this.render();
  }

  /* ---------- 시간 ---------- */
  elapsed() { return (Date.now() - new Date(this.t.realStart || Date.now()).getTime()) / 1000; }
  remaining() { return this.real && this.t.realStart ? Math.max(0, this.t.durationSec - this.elapsed()) : Infinity; }

  onTick() {
    if (!this.alive) return;
    if (this.timerEl && this.real && this.t.realStart) {
      const rem = this.remaining();
      this.timerEl.textContent = mmss(rem);
      this.timerEl.classList.toggle('over', rem < 60);
      if (rem <= 0 && !this.t.timeUp) this.timeUp();
    }
    if (this.recTimerEl && this.recStart) {
      const s = (Date.now() - this.recStart) / 1000;
      this.recTimerEl.textContent = mmss(s);
      if (this.targetBar) {
        this.targetBar.style.width = Math.min(100, (s / this.target) * 100) + '%';
        this.targetBar.style.background = s > 60 ? 'var(--bad)' : s > this.target ? 'var(--warn)' : 'var(--good)';
      }
    }
  }

  async timeUp() {
    this.t.timeUp = true;
    if (this.recorder.recording) { await this.stopRecording(true); }
    this.save();
    // 받아쓰기 중('waiting')이면 그 흐름이 끝난 뒤 마무리한다
    if (['next', 'ready'].includes(this.t.phase)) this.closing();
  }

  /* ---------- 그리기 ---------- */
  render() {
    if (!this.alive) return;
    const ph = this.t.phase;
    this.timerEl = null; this.recTimerEl = null; this.targetBar = null;
    const top = this.header();
    let body;
    if (ph === 'lobby') body = this.lobbyView();
    else if (ph === 'next') body = this.nextView();
    else if (ph === 'ready' || ph === 'recording') body = this.answerView();
    else if (ph === 'review') body = this.reviewView();
    else if (ph === 'result') body = this.resultView();
    else if (ph === 'closing') body = this.closingView();
    else if (ph === 'review-all') body = this.reviewAllView();
    else if (ph === 'results') body = this.resultsView();
    else body = h('div', { class: 'loading' }, h('span', { class: 'spin' }), h('span', null, '준비 중…'));
    replace(this.el, top, body);
  }

  header() {
    const answered = this.t.turns.filter((x) => lastAttempt(x)).length;
    const info = h('div', { class: 'row between wrap' },
      h('div', { class: 'stack tight' },
        h('b', null, this.conv ? `${this.t.setting.scene} · ${this.t.setting.role}` : `${this.t.setting.school}`),
        h('span', { class: 'muted small' }, [this.real ? '실전 10분' : '연습', this.t.group ? '2인 그룹' : (this.conv ? this.t.setting.tone : '1:1'), `답변 ${answered}개`].join(' · '))),
      this.real && this.t.realStart
        ? (this.timerEl = h('div', { class: 'timer-big' }, mmss(this.remaining())))
        : null);
    return h('div', { class: 'panel' }, info, this.speakers());
  }

  speakers(state = {}) {
    const mk = (key, avatar, who) => h('div', { class: ['speaker', key, this.talking === key && 'talking'], dataset: { sp: key } },
      h('div', { class: 'avatar' }, avatar), h('div', { class: 'who' }, who), h('div', { class: 'state' }, state[key] || ''));
    this.spEl = h('div', { class: 'speakers' },
      mk('ai', this.conv ? '話' : '面', this.conv ? '상대' : '면접관'),
      this.t.group ? mk('other', '他', '다른 지원자') : null,
      mk('me', '私', '나'));
    return this.spEl;
  }

  setTalking(key, text = '') {
    this.talking = key;
    if (!this.spEl) return;
    for (const s of this.spEl.children) {
      s.classList.toggle('talking', s.dataset.sp === key);
      const st = s.querySelector('.state');
      st.textContent = s.dataset.sp === key ? text : '';
    }
  }

  /* ---------- 실전: 입실 전 ---------- */
  lobbyView() {
    return h('div', { class: 'panel stack' },
      h('h2', null, this.t.setting.place === '대면' ? '실전 10분 모의 면접' : '실전 10분 모의 화상 면접'),
      h('ul', { class: 'muted small', style: { margin: 0, paddingLeft: '18px' } },
        h('li', null, '시작하면 10분 타이머가 바로 돌고 중간에 멈추지 않아요.'),
        ...this.script.lobby.map((x) => h('li', null, x)),
        h('li', null, '질문은 음성으로만 나와요. 다시 듣기·느리게 듣기만 있어요.'),
        this.t.group && h('li', null, '다른 지원자(AI)와 번갈아 답해요. 누가 먼저 답할지는 질문마다 바뀌어요.'),
        h('li', null, `한 답변은 ${this.target}초, 길어도 1분을 넘기지 않는 걸 목표로 하세요.`),
        h('li', null, '시간이 되면 면접관이 마무리 인사를 하고, 끝난 뒤 전체를 분석해요.')),
      h('button', { type: 'button', class: 'wide', onclick: () => this.enterRoom() }, icon('play', 18), this.script.enterLabel));
  }

  async enterRoom() {
    unlock();
    try { await this.recorder.start(); await this.recorder.stop(); } catch (e) {
      toast('마이크를 쓸 수 없어요. 브라우저의 마이크 권한을 허용해 주세요.', 'err', 5000); return;
    }
    this.t.realStart = new Date().toISOString();
    const turn = this.addTurn({ question_ja: this.script.enter, question_ko: this.script.enterKo, category: '인사', scripted: 'enter', hint: this.script.enterHint });
    turn.order = null;
    this.t.phase = 'ready';
    this.save();
    this.render();
    await this.playQuestion(turn);
  }

  addTurn(q) {
    const turn = { id: uid().slice(0, 8), n: this.t.turns.length + 1, replays: 0, slowReplays: 0, attempts: [], asked: true, ...q };
    this.t.turns.push(turn);
    this.t.cur = this.t.turns.length - 1;
    return turn;
  }

  /* ---------- 다음 질문 만들기 ---------- */
  nextView() {
    const box = h('div', { class: 'panel stack' }, h('div', { class: 'loading' }, h('span', { class: 'spin' }),
      h('span', null, this.t.turns.length ? '면접관이 다음 질문을 고르는 중…' : (this.conv ? '상대가 말을 거는 중…' : '면접관이 첫 질문을 고르는 중…'))));
    if (!this.generating) this.generateNext().catch((e) => {
      replace(box, h('p', { class: 'note err' }, e.message),
        h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => this.render() }, '다시 시도'),
          h('button', { type: 'button', class: 'ghost', onclick: () => this.finish() }, '여기까지 저장')));
    });
    return box;
  }

  history() {
    return this.t.turns.filter((x) => !x.scripted).map((x) => ({
      question_ja: x.question_ja, category: x.category, is_followup: x.is_followup,
      answer: lastAttempt(x)?.answer || lastAttempt(x)?.heard || '',
    }));
  }

  async generateNext() {
    if (this.real && this.remaining() <= 0) { this.closing(); return; }
    this.generating = true;
    try {
      const history = this.history();
      // 학력 질문에는 꼬리 질문을 한 번 이상 붙인다
      const lastQ = history[history.length - 1];
      const eduAsked = history.some((x) => x.category === '학력');
      const eduFollowed = history.some((x) => x.category === '학력' && x.is_followup);
      const mustFollowup = !this.conv && lastQ && lastQ.category === '학력' && !lastQ.is_followup && !eduFollowed;
      const counts = {};
      history.forEach((x) => { counts[x.category] = (counts[x.category] || 0) + 1; });
      const avoid = Object.entries(counts).filter(([, n]) => n >= 2).map(([c]) => c);
      if (!this.conv && history.length >= 3 && !eduAsked) avoid.push(...Object.keys(counts).filter((c) => c !== '학력' && !avoid.includes(c)));
      const prompt = interviewQuestionPrompt({ setting: this.t.setting, history, mustFollowup, avoidCategories: avoid, conversation: this.conv });
      let res;
      for (let i = 0; i < 2; i++) {
        res = await runTask({ task: 'interviewQuestion', prompt, schema: QUESTION_SCHEMA, check: (j) => checkQuestion(j, history, this.conv) });
        if (res.result) break;
      }
      const q = res.result;
      if (!this.alive || (this.real && this.t.timeUp)) return;
      const turn = this.addTurn({ question_ja: q.question_ja.trim(), question_ko: q.question_ko, category: q.category, is_followup: !!q.is_followup });
      // 2인 그룹: 내가 먼저 답할지 나중에 답할지 질문마다 섞는다
      turn.order = this.t.group ? (Math.random() < 0.5 ? 'me-first' : 'other-first') : null;
      this.t.phase = 'ready';
      turn.asked = false;
      this.save();
      await prepare(turn.question_ja, this.vs.interviewer);
      if (turn.order === 'other-first') await this.makeOther(turn);
      if (!this.alive) return;
      turn.asked = true;
      this.save();
      this.render();
      await this.playQuestion(turn);
    } finally {
      this.generating = false;
    }
  }

  async makeOther(turn, myAnswer = '') {
    const otherHistory = this.t.turns.filter((x) => x.other?.answer_ja && x !== turn).map((x) => x.other.answer_ja);
    try {
      const res = await runTask({
        task: 'otherCandidate',
        prompt: otherCandidatePrompt({ persona: this.t.persona, question: turn.question_ja, setting: this.t.setting, myAnswer, history: otherHistory }),
        schema: OTHER_SCHEMA, check: checkOther,
      });
      turn.other = res.result;
      await prepare(turn.other.answer_ja, this.vs.other);
    } catch (e) {
      console.warn(e);
      turn.other = null;
      toast('다른 지원자 답을 만들지 못해 이번 질문은 혼자 답해요');
    }
  }

  async playQuestion(turn, rate = 1) {
    if (!this.alive) return;
    this.setTalking('ai', '말하는 중');
    try { await speak(turn.question_ja, { voice: this.vs.interviewer, rate }); } catch (e) { console.warn(e); }
    if (!this.alive) return;
    if (turn.order === 'other-first' && turn.other && !turn.otherPlayed) {
      this.setTalking('other', '답하는 중');
      await new Promise((r) => setTimeout(r, 500));
      try { await speak(turn.other.answer_ja, { voice: this.vs.other }); } catch (e) { console.warn(e); }
      turn.otherPlayed = true;
      this.save();
    }
    if (!this.alive) return;
    this.setTalking('me', '내 차례');
  }

  /* ---------- 내 답 녹음 ---------- */
  answerView() {
    const turn = this.curTurn();
    const recording = this.recorder.recording;
    const replayBtn = h('button', { type: 'button', class: 'plain small', disabled: recording, onclick: () => { unlock(); turn.replays++; this.save(); replayCount.textContent = `다시 듣기 ${turn.replays}회`; this.playQuestion({ ...turn, order: null }); } }, icon('refresh', 16), '다시 듣기');
    const slowBtn = h('button', { type: 'button', class: 'plain small', disabled: recording, onclick: () => { unlock(); turn.slowReplays++; turn.replays++; this.save(); replayCount.textContent = `다시 듣기 ${turn.replays}회`; this.playQuestion({ ...turn, order: null }, 0.8); } }, icon('slow', 16), '느리게 (0.8배)');
    const replayCount = h('span', { class: 'muted small' }, `다시 듣기 ${turn.replays}회`);
    const micBtn = h('button', { type: 'button', class: ['mic-btn', recording && 'rec'], 'aria-label': recording ? '녹음 끝내기' : '녹음 시작' }, icon(recording ? 'stop' : 'mic', 34));
    micBtn.addEventListener('click', () => (this.recorder.recording ? this.stopRecording() : this.startRecording()));
    const level = h('div', { class: 'level' }, h('i'));
    this.levelBar = level.firstChild;
    this.recTimerEl = h('div', { class: 'timer-big', style: { fontSize: '1.6em' } }, recording ? mmss((Date.now() - this.recStart) / 1000) : '00:00');
    const tb = h('div', { class: 'bar target-bar' }, h('i', { style: { width: '0%' } }));
    this.targetBar = tb.firstChild;

    const intro = turn.scripted
      ? h('p', { class: 'note' }, turn.hint)
      : h('p', { class: 'muted small center' }, turn.order === 'other-first' ? '다른 지원자가 먼저 답했어요. 겹치지 않게 답해 보세요.' : turn.order === 'me-first' ? '이번에는 내가 먼저 답해요.' : (this.conv ? '상대의 말에 대답하세요.' : '질문은 음성으로만 나와요. 답을 마친 뒤 처음 글자로 보여줘요.'));

    return h('div', { class: 'panel stack' },
      h('div', { class: 'row between wrap' }, h('b', null, turn.scripted ? (turn.scripted === 'enter' ? this.script.enterTitle : this.script.closeTitle) : `질문 ${this.t.turns.filter((x) => !x.scripted).indexOf(turn) + 1}`), replayCount),
      intro,
      !turn.scripted && h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, replayBtn, slowBtn,
        turn.order === 'other-first' && turn.other && h('button', { type: 'button', class: 'plain small', disabled: recording, onclick: () => { unlock(); this.setTalking('other', '답하는 중'); speak(turn.other.answer_ja, { voice: this.vs.other }).then(() => this.setTalking('me', '내 차례')); } }, icon('users', 16), '다른 지원자 답 다시')),
      h('div', { class: 'mic-wrap' }, micBtn, this.recTimerEl, tb,
        h('span', { class: 'hint' }, recording ? `목표 ${this.target}초 · 다 말했으면 버튼을 눌러 끝내요` : '버튼을 누르고 말하세요'), level),
      !this.real && h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { type: 'button', class: 'ghost small', disabled: recording, onclick: () => this.finish() }, '면접 종료')));
  }

  async startRecording() {
    unlock();
    stopAll();
    try { await this.recorder.start(); } catch (e) {
      toast('마이크를 쓸 수 없어요. 브라우저 주소창의 마이크 권한을 허용해 주세요. (' + (e.name || e) + ')', 'err', 5000);
      return;
    }
    this.recStart = Date.now();
    this.t.phase = 'recording';
    this.setTalking('me', '말하는 중');
    this.render();
    this.setTalking('me', '말하는 중');
    this.startMeter();
  }

  startMeter() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.actx = new Ctx();
      const src = this.actx.createMediaStreamSource(this.recorder.stream);
      const an = this.actx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const data = new Uint8Array(an.fftSize);
      const loop = () => {
        if (!this.actx) return;
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        if (this.levelBar) this.levelBar.style.width = Math.min(100, peak * 160) + '%';
        this.meterRaf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* 표시만 못 함 */ }
  }
  stopMeter() { cancelAnimationFrame(this.meterRaf); try { this.actx?.close(); } catch { /* 무시 */ } this.actx = null; }

  async stopRecording(fromTimeUp = false) {
    const res = await this.recorder.stop();
    this.stopMeter();
    this.recStart = null;
    const turn = this.curTurn();
    if (!res || res.seconds < 0.6) {
      toast('녹음이 너무 짧아요. 다시 해 주세요.', 'err');
      this.t.phase = 'ready'; this.render(); return;
    }
    this.t.phase = 'transcribing';
    replace(this.el.lastChild, h('div', { class: 'loading' }, h('span', { class: 'spin' }), h('span', null, '녹음을 저장하고 받아 적는 중…')));
    let wav;
    try { wav = await toWav16k(res.blob); } catch (e) {
      toast('소리 변환 실패: ' + e, 'err'); this.t.phase = 'ready'; this.render(); return;
    }
    const lv = await speechLevel(wav);
    if (lv.silent && !fromTimeUp) {
      toast('말소리가 거의 들리지 않아요. 마이크에 가까이 대고 다시 녹음해 주세요.', 'err', 4500);
      this.t.phase = 'ready'; this.render(); return;
    }
    const attempt = { at: new Date().toISOString(), seconds: Math.round(res.seconds * 10) / 10, audio: null, heard: '', heard_kana: '', answer: '', analysis: null, warnings: [] };
    attempt.audio = await db.upload(`rec/${this.t.sid}/${turn.id}-${turn.attempts.length + 1}.wav`, wav, 'audio/wav');
    attempt.key = await blobKey(wav);
    turn.attempts.push(attempt);
    this.wavs = this.wavs || new Map();
    this.wavs.set(attempt.audio, wav);
    this.save();

    // 받아쓰기 (목표 문장 없이 들린 소리만)
    const transcribe = this.transcribe(attempt, wav);
    if (this.real) {
      // 실전: 멈추지 않고 진행. 받아쓰기가 끝나면 다음 질문.
      this.t.phase = 'waiting';
      this.setTalking('ai', '메모하는 중');
      await transcribe;
      if (turn.order === 'me-first' && this.t.group && !turn.other && !turn.scripted) {
        await this.makeOther(turn, attempt.heard);
        if (turn.other) { this.setTalking('other', '답하는 중'); try { await speak(turn.other.answer_ja, { voice: this.vs.other }); } catch { /* 무시 */ } }
      }
      if (!this.alive) return;
      if (turn.scripted === 'enter') {
        this.setTalking('ai', '말하는 중');
        try { await speak(this.script.seat, { voice: this.vs.interviewer }); } catch { /* 무시 */ }
      }
      if (turn.scripted === 'close') { this.t.phase = 'review-all'; this.save(); this.render(); return; }
      if (this.t.timeUp || this.remaining() <= 0) { this.closing(); return; }
      this.t.phase = 'next';
      this.save();
      this.render();
      return;
    }
    await transcribe;
    if (!this.alive) return;
    if (turn.order === 'me-first' && this.t.group && !turn.other) {
      replace(this.el.lastChild, h('div', { class: 'loading' }, h('span', { class: 'spin' }), h('span', null, '다른 지원자가 답하는 중…')));
      await this.makeOther(turn, attempt.answer);
      if (turn.other) { this.setTalking('other', '답하는 중'); try { await speak(turn.other.answer_ja, { voice: this.vs.other }); } catch { /* 무시 */ } }
    }
    this.t.phase = 'review';
    this.save();
    this.render();
  }

  async transcribe(attempt, wav) {
    try {
      const res = await runTask({
        task: 'transcribe', prompt: transcribePrompt(attempt.seconds),
        media: [{ mimeType: 'audio/wav', data: await blobToBase64(wav) }],
        schema: TRANSCRIBE_SCHEMA, check: checkTranscribe, cacheKey: attempt.key,
      });
      attempt.heard = res.result.transcript || '';
      attempt.heard_kana = res.result.transcript_kana || '';
      attempt.answer = attempt.heard;
      attempt.transcribeWarnings = res.warnings;
      attempt.silent = !!checkTranscribe(res.result).silent;
    } catch (e) {
      attempt.transcribeError = e.message;
      attempt.transcribeWarnings = [e.message];
    }
    this.save();
  }

  /* ---------- 연습: 받아쓰기 확인 ---------- */
  reviewView() {
    const turn = this.curTurn();
    const at = lastAttempt(turn);
    const ta = h('textarea', { class: 'transcript-edit', lang: 'ja', rows: 5 }, at.answer || '');
    ta.addEventListener('input', () => { at.answer = ta.value; this.saveSoon(); });
    const analyzeBtn = h('button', { type: 'button', class: 'wide' }, icon('check', 18), '분석하기');
    analyzeBtn.addEventListener('click', () => this.analyzeOne(turn, at, analyzeBtn));
    return h('div', { class: 'panel stack' },
      h('div', { class: 'row between' }, h('b', null, '받아 적은 내 답 확인'), h('span', { class: 'tag gray' }, `${Math.round(at.seconds)}초`)),
      ...(at.transcribeWarnings || []).map((w) => h('p', { class: 'note warn' }, w)),
      at.silent && h('p', { class: 'note err' }, '말소리가 들리지 않았대요. 다시 녹음하는 걸 권해요.'),
      h('p', { class: 'hint' }, 'AI가 녹음을 듣고 옮긴 글이에요. 잘못 옮긴 곳만 고치세요. 발음 평가는 고친 글이 아니라 원래 녹음 기준이에요. 「？」는 알아듣지 못한 부분이에요.'),
      ta,
      h('div', { class: 'row wrap' }, at.audio && listenBtn('내 녹음 듣기', () => playRecording(at.audio))),
      analyzeBtn,
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { type: 'button', class: 'ghost small', onclick: () => { turn.attempts.pop(); this.t.phase = 'ready'; this.save(); this.render(); } }, icon('mic', 14), '다시 녹음')));
  }

  saveSoon() { clearTimeout(this._st); this._st = setTimeout(() => this.save(), 1500); }

  async analyzeOne(turn, at, btn) {
    if (this.busyAi) return;
    if (!at.answer.trim()) { toast('답변 글이 비어 있어요', 'err'); return; }
    this.busyAi = true;
    const done = btn ? busy(btn, '분석 중… (10~30초)') : () => {};
    this.t.phase = 'analyzing';
    this.save();
    try {
      await this.analyze(turn, at);
      this.t.phase = 'result';
      this.save();
      this.render();
    } catch (e) {
      toast(e.message, 'err', 5000);
      this.t.phase = 'review';
    } finally {
      this.busyAi = false;
      done();
    }
  }

  async analyze(turn, at, fresh = false) {
    const wav = this.wavs?.get(at.audio) || await db.download(at.audio);
    const otherAnswer = turn.order === 'other-first' ? turn.other?.answer_ja : '';
    const res = await runTask({
      task: 'interviewAnalyze',
      prompt: interviewAnalyzePrompt({
        setting: this.t.setting, question: turn.question_ja, heard: at.heard, answer: at.answer,
        seconds: at.seconds, targetSeconds: this.target, otherAnswer, conversation: this.conv,
      }),
      media: [{ mimeType: 'audio/wav', data: await blobToBase64(wav) }],
      schema: INTERVIEW_ANALYZE_SCHEMA,
      check: (j) => checkInterviewAnalysis(j, at.answer),
      cacheKey: `${at.key}|${await blobKey(new Blob([at.answer + '|' + turn.question_ja + '|' + otherAnswer + '|' + this.target]))}`,
      fresh,
    });
    at.analysis = res.result;
    const warnings = [...res.warnings];
    // 사이트의 검사: 받아 적은 소리와 내가 고친 글의 일치율
    if (at.heard && at.answer) {
      const rate = similarity(at.heard, at.answer);
      at.matchRate = rate;
      if (rate < 60) warnings.push(`AI가 들은 소리와 고친 글의 일치율이 ${rate}%로 낮아요. 녹음이 다른 문장으로 인식됐을 수 있어요.`);
    }
    if (at.seconds > 60) warnings.push(`답변이 ${Math.round(at.seconds)}초로 1분을 넘었어요. 10분을 두 사람이 나누므로 더 짧게 말해 보세요.`);
    if (res.cached) warnings.unshift('같은 녹음·같은 글이라 저장된 분석 결과를 보여줘요. (다시 분석은 아래 버튼)');
    at.warnings = warnings;
  }

  /* ---------- 연습: 분석 결과 ---------- */
  resultView() {
    const turn = this.curTurn();
    const at = lastAttempt(turn);
    const reBtn = h('button', { type: 'button', class: 'ghost small' }, icon('refresh', 14), '다시 분석');
    reBtn.addEventListener('click', async () => {
      if (this.busyAi) return;
      this.busyAi = true;
      const done = busy(reBtn, '분석 중…');
      try { await this.analyze(turn, at, true); this.save(); this.render(); } catch (e) { toast(e.message, 'err'); } finally { this.busyAi = false; done(); }
    });
    const prev = turn.attempts.length > 1 ? turn.attempts.slice(0, -1) : [];
    return h('div', { class: 'stack' },
      renderAnalysis(turn, at, { conversation: this.conv, targetSeconds: this.target }),
      prev.length > 0 && h('details', { class: 'panel' }, h('summary', null, `이전 답변 ${prev.length}개`),
        ...prev.map((p, i) => h('div', { class: 'stack tight' }, h('b', { class: 'small' }, `${i + 1}번째 답변 (${Math.round(p.seconds)}초)`), h('p', { class: 'jp small' }, p.answer), p.analysis?.evaluation?.summary && h('p', { class: 'muted small' }, p.analysis.evaluation.summary)))),
      h('div', { class: 'row end' }, reBtn),
      h('div', { class: 'panel choice-bar' },
        h('button', { type: 'button', class: 'full', onclick: () => { unlock(); this.t.phase = 'next'; this.save(); this.render(); } }, icon('right', 18), this.conv ? '대화 이어가기' : '다음 질문'),
        h('button', { type: 'button', class: 'plain', onclick: () => { unlock(); this.t.phase = 'ready'; turn.otherPlayed = true; this.save(); this.render(); this.playQuestion({ ...turn, order: null }); } }, icon('undo', 16), '같은 질문 다시'),
        h('button', { type: 'button', class: 'plain', onclick: () => this.finish() }, icon('stop', 16), this.conv ? '회화 종료' : '면접 종료')));
  }

  /* ---------- 실전: 마무리 ---------- */
  async closing() {
    if (this.t.phase === 'closing' || this.closingNow) return;
    this.closingNow = true;
    this.t.timeUp = true;
    // 아직 답하지 않은 질문은 뺀다
    const cur = this.curTurn();
    if (cur && !lastAttempt(cur) && !cur.scripted) { this.t.turns.pop(); this.t.cur = this.t.turns.length - 1; }
    this.t.phase = 'closing';
    this.save();
    this.render();
    this.setTalking('ai', '말하는 중');
    try { await speak(this.script.closing, { voice: this.vs.interviewer }); } catch { /* 무시 */ }
    this.setTalking('me', '퇴실 인사');
    this.closingNow = false;
  }

  closingView() {
    return h('div', { class: 'panel stack' },
      h('h2', null, '면접이 끝났어요'),
      furi(this.script.closing, { tag: 'p' }),
      h('p', { class: 'note' }, this.script.closeHint),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', onclick: () => {
          const turn = this.addTurn({ question_ja: this.script.closing, question_ko: this.script.closingKo, category: '인사', scripted: 'close', hint: this.script.closeHint });
          turn.order = null;
          this.t.phase = 'ready'; this.save(); this.render();
        } }, icon('mic', 16), '마무리 인사 녹음'),
        h('button', { type: 'button', class: 'ghost', onclick: () => { this.t.phase = 'review-all'; this.save(); this.render(); } }, '건너뛰고 분석으로')));
  }

  /* ---------- 실전: 받아쓰기 확인 → 전체 분석 ---------- */
  reviewAllView() {
    const turns = this.t.turns.filter((x) => lastAttempt(x));
    const box = h('div', { class: 'stack' },
      h('div', { class: 'panel stack' },
        h('h2', null, '받아 적은 답 확인'),
        h('p', { class: 'hint' }, '잘못 옮긴 곳만 고친 뒤 전체 분석을 눌러요. 발음 평가는 원래 녹음 기준이에요.')));
    turns.forEach((turn, i) => {
      const at = lastAttempt(turn);
      const ta = h('textarea', { class: 'transcript-edit', lang: 'ja', rows: 3 }, at.answer || '');
      ta.addEventListener('input', () => { at.answer = ta.value; this.saveSoon(); });
      box.append(h('div', { class: 'panel stack' },
        h('div', { class: 'qa-head' }, h('span', { class: 'qa-num' }, i + 1), h('div', { class: 'stack tight grow' },
          h('span', { class: 'jp' }, turn.question_ja), h('span', { class: 'muted small' }, `${turn.category}${turn.order ? (turn.order === 'me-first' ? ' · 내가 먼저' : ' · 다른 지원자 먼저') : ''} · ${Math.round(at.seconds)}초`))),
        ...(at.transcribeWarnings || []).map((w) => h('p', { class: 'note warn' }, w)),
        ta,
        h('div', { class: 'row' }, at.audio && listenBtn('내 녹음', () => playRecording(at.audio)))));
    });
    const btn = h('button', { type: 'button', class: 'wide' }, icon('check', 18), `전체 분석 (${turns.length}개)`);
    const prog = h('p', { class: 'msg' });
    btn.addEventListener('click', async () => {
      if (this.busyAi) return;
      this.busyAi = true;
      const done = busy(btn, '분석 중…');
      this.t.phase = 'analyzing-all';
      try {
        for (let i = 0; i < turns.length; i++) {
          const at = lastAttempt(turns[i]);
          if (at.analysis && !at.dirty) continue;
          prog.textContent = `${i + 1} / ${turns.length} 분석 중… (답변마다 10~30초)`;
          if (!at.answer?.trim()) { at.warnings = ['답변 글이 비어 있어 분석하지 않았어요.']; continue; }
          await this.analyze(turns[i], at);
          this.save();
        }
        this.t.phase = 'results';
        this.save();
        this.render();
      } catch (e) {
        prog.textContent = e.message + ' — 분석된 답은 저장돼 있어요. 다시 누르면 이어서 해요.';
        prog.className = 'msg err';
        this.t.phase = 'review-all';
        this.save();
      } finally { this.busyAi = false; done(); }
    });
    box.append(h('div', { class: 'panel stack' }, btn, prog));
    return box;
  }

  resultsView() {
    const turns = this.t.turns.filter((x) => lastAttempt(x));
    const box = h('div', { class: 'stack' });
    const total = turns.reduce((n, x) => n + (lastAttempt(x).seconds || 0), 0);
    box.append(h('div', { class: 'panel stack' },
      h('h2', null, '실전 결과'),
      h('div', { class: 'stat' },
        h('div', null, h('b', null, turns.filter((x) => !x.scripted).length), h('span', null, '질문')),
        h('div', null, h('b', null, mmss(total)), h('span', null, '내가 말한 시간')),
        h('div', null, h('b', null, turns.reduce((n, x) => n + (lastAttempt(x).analysis?.corrections?.length || 0), 0)), h('span', null, '교정'))),
      h('button', { type: 'button', class: 'wide', onclick: () => this.finish() }, '저장하기')));
    turns.forEach((turn, i) => {
      const at = lastAttempt(turn);
      const body = h('div', { hidden: i > 0 }, renderAnalysis(turn, at, { conversation: this.conv, targetSeconds: this.target }));
      box.append(h('div', { class: 'panel stack' },
        h('button', { type: 'button', class: 'plain', style: { justifyContent: 'space-between' }, onclick: () => { body.hidden = !body.hidden; } },
          h('span', { class: 'jp', style: { whiteSpace: 'normal', textAlign: 'left' } }, `${i + 1}. ${turn.question_ja}`), icon('more', 16)),
        body));
    });
    return box;
  }

  /* ---------- 종료·저장 ---------- */
  async finish() {
    if (this.recorder.recording) { toast('녹음을 먼저 끝내 주세요'); return; }
    const turns = this.t.turns.filter((x) => lastAttempt(x));
    if (!turns.length) {
      if (await confirmDialog('답한 질문이 없어요. 저장하지 않고 끝낼까요?', { ok: '끝내기' })) { this.ended = true; stopAll(); db.clearProgress('talk'); go('/talk'); }
      return;
    }
    if (this.real && turns.some((x) => !lastAttempt(x).analysis) && this.t.phase !== 'results') {
      if (!(await confirmDialog('아직 분석하지 않은 답이 있어요. 분석 없이 저장할까요? (나중에 기록에서 분석할 수 있어요)', { ok: '그대로 저장' }))) return;
    }
    const title = h('input', { value: talkTitle(this.t) });
    const checks = turns.map((turn) => {
      const cb = h('input', { type: 'checkbox', checked: true });
      return { turn, cb, el: h('label', { class: 'check' }, cb, h('span', { class: 'jp small' }, turn.question_ja)) };
    });
    const ok = await modal({
      title: '기록 저장',
      body: h('div', { class: 'stack' }, field('제목', title), h('span', { class: 'field-label' }, '저장할 문답'), ...checks.map((c) => c.el)),
      actions: [{ label: '계속하기', value: false }, { label: '저장', value: true, primary: true }],
    });
    if (!ok) return;
    const keep = checks.filter((c) => c.cb.checked).map((c) => c.turn);
    const dropped = checks.filter((c) => !c.cb.checked).flatMap((c) => c.turn.attempts.map((a) => a.audio));
    const unused = keep.flatMap((t) => t.attempts.slice(0, -1).map((a) => a.audio)).filter(Boolean);
    const session = {
      title: title.value.trim() || talkTitle(this.t),
      kind: this.t.kind, mode: this.t.mode, group: this.t.group, setting: this.t.setting, persona: this.t.persona,
      startedAt: this.t.startedAt, endedAt: new Date().toISOString(), sid: this.t.sid,
      targetSeconds: this.target,
      turns: keep.map((t) => ({ ...t, attempts: t.attempts })),
    };
    this.ended = true;
    clearTimeout(this._st);
    stopAll();
    const row = db.put('session', session);
    db.clearProgress('talk');
    db.removeFiles(dropped);
    void unused; // 이전 답변 녹음은 기록에서 비교할 수 있게 남겨 둔다
    toast('기록을 저장했어요');
    go('/talk/session/' + row.id, { replace: true });
  }
}
