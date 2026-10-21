// 앱 시작: 로그인 → 데이터 불러오기 → 메뉴·라우터
import { h, $, icon, bus, route, go, parseHash, matchRoute, replace, toast, closeAllSheets, field } from './core.js';
import { db, DEMO } from './db.js';
import { unlock, stopAll } from './tts.js';

const TABS = [
  ['/words', '단어장', 'book'],
  ['/test', '테스트', 'layers'],
  ['/grammar', '문법', 'note'],
  ['/talk', '회화·면접', 'chat'],
  ['/writing', '작문', 'pen'],
];

/* ---------------- 화면 등록 (필요할 때 불러오기) ---------------- */

const lazy = (path, name) => async (...a) => (await import(path))[name](...a);
route('/', () => { go('/words', { replace: true }); return null; });
route('/words', lazy('./views/words.js', 'wordsView'));
route('/words/new', lazy('./views/words.js', 'wordFormView'));
route('/words/import', lazy('./views/words.js', 'importView'));
route('/words/edit/:id', lazy('./views/words.js', 'wordFormView'));
route('/kanji/:ch', lazy('./views/words.js', 'kanjiWordsView'));
route('/test', lazy('./views/test.js', 'testHomeView'));
route('/test/run', lazy('./views/test.js', 'testRunView'));
route('/grammar', lazy('./views/grammar.js', 'grammarView'));
route('/grammar/new', lazy('./views/grammar.js', 'grammarFormView'));
route('/grammar/edit/:id', lazy('./views/grammar.js', 'grammarFormView'));
route('/grammar/:id', lazy('./views/grammar.js', 'grammarDetailView'));
route('/talk', lazy('./views/talk.js', 'talkHomeView'));
route('/talk/run', lazy('./views/talk-run.js', 'talkRunView'));
route('/talk/session/:id', lazy('./views/talk-records.js', 'sessionView'));
route('/talk/review', lazy('./views/talk-records.js', 'reviewView'));
route('/writing', lazy('./views/writing.js', 'writingHomeView'));
route('/writing/run', lazy('./views/writing-run.js', 'writingRunView'));
route('/writing/:id', lazy('./views/writing.js', 'writingDetailView'));
route('/search', lazy('./views/search.js', 'searchView'));
route('/settings', lazy('./views/settings.js', 'settingsView'));

/* ---------------- 화면 그리기 ---------------- */

let current = null;   // { cleanup, offs }
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  const m = matchRoute(path);
  closeAllSheets();
  stopAll();
  if (current) { current.offs.forEach((f) => f()); try { current.cleanup?.(); } catch (e) { console.error(e); } current = null; }
  const view = $('#view');
  if (!m) { go('/words', { replace: true }); return; }
  const offs = [];
  const ctx = {
    onDb(fn) { offs.push(bus.on('db', fn)); },
    on(name, fn) { offs.push(bus.on(name, fn)); },
    get alive() { return seq === renderSeq; },
  };
  let out;
  try {
    out = await m.handler(m.params, query, ctx);
  } catch (e) {
    console.error(e);
    out = { el: h('div', { class: 'panel' }, h('p', { class: 'msg err' }, '화면을 여는 중 오류: ' + (e.message || e))) };
  }
  if (seq !== renderSeq) { offs.forEach((f) => f()); out?.cleanup?.(); return; }
  if (!out) return;
  current = { cleanup: out.cleanup, offs };
  replace(view, out.el);
  view.className = out.full ? 'full' : '';
  document.body.classList.toggle('immersive', !!out.immersive);
  setTop(out);
  const active = TABS.find(([p]) => path === p || path.startsWith(p + '/'));
  for (const a of document.querySelectorAll('#tabs a')) a.classList.toggle('on', a.dataset.path === active?.[0]);
  if (!out.keepScroll) window.scrollTo(0, 0);
}

function setTop(out) {
  const left = $('#topLeft');
  replace(left);
  if (out.back) {
    const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '뒤로', title: '뒤로' }, icon('back', 22));
    b.onclick = () => (typeof out.back === 'function' ? out.back() : (history.length > 1 && out.back === true ? history.back() : go(out.back)));
    left.append(b);
  }
  const title = $('#topTitle');
  if (out.title) replace(title, h('span', { class: 'top-text' }, out.title));
  else replace(title, h('span', { class: 'mark' }, '日'), h('span', null, '일본어 공부방'));
  if (out.right) { /* 화면별 오른쪽 버튼 */ }
}

/* ---------------- 설정 적용 ---------------- */

export function applySettings() {
  const s = db.settings();
  const root = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') root.dataset.theme = s.theme; else delete root.dataset.theme;
  root.dataset.font = s.fontSize || 'normal';
}

function syncBadge(st = db.status()) {
  const b = $('#syncBadge');
  if (st.demo) { b.hidden = false; b.textContent = '체험 모드'; b.className = 'sync demo'; return; }
  if (!st.online) { b.hidden = false; b.textContent = st.pending ? `오프라인 · 저장 대기 ${st.pending}` : '오프라인'; b.className = 'sync warn'; return; }
  if (st.pending) { b.hidden = false; b.textContent = `저장 대기 중 ${st.pending}`; b.className = 'sync warn'; return; }
  b.hidden = true;
}

/* ---------------- 로그인 ---------------- */

function loginView() {
  const email = h('input', { type: 'email', required: true, autocomplete: 'email' });
  const pw = h('input', { type: 'password', required: true, minlength: 8, autocomplete: 'current-password' });
  const msg = h('p', { class: 'msg', role: 'status' });
  const errors = {
    'Invalid login credentials': '이메일 또는 비밀번호가 맞지 않아요.',
    'Email not confirmed': '메일함에서 가입 확인 링크를 먼저 눌러 주세요.',
    'Signups not allowed for this instance': '새 가입이 막혀 있어요. 기존 계정으로 로그인해 주세요.',
  };
  const say = (t, k = '') => { msg.textContent = t; msg.className = 'msg ' + k; };
  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      say('로그인 중…');
      try { await db.signIn(email.value.trim(), pw.value); say(''); } catch (err) { say(errors[err.message] || err.message, 'err'); }
    },
  },
  field('이메일', email), field('비밀번호', pw),
  h('button', { type: 'submit' }, '로그인'), msg);
  return h('section', { class: 'panel narrow' },
    h('h1', null, '로그인'),
    h('p', { class: 'muted' }, 'PC와 휴대폰에서 같은 계정으로 로그인하면 모든 데이터가 동기화돼요.'),
    form);
}

/* ---------------- 시작 ---------------- */

async function start() {
  const tabs = $('#tabs');
  replace(tabs, TABS.map(([path, label, ic]) => h('a', { href: '#' + path, dataset: { path } }, icon(ic, 22), h('span', null, label))));
  $('#topSearch').append(icon('search', 22));
  $('#topSettings').append(icon('settings', 22));
  // 아이폰: 첫 터치 때 오디오 잠금 풀기
  document.addEventListener('pointerdown', () => unlock(), { once: true, capture: true });

  if (DEMO) (await import('./mock.js')).installFakeMic();
  let session;
  try { session = await db.init(); } catch (e) {
    replace($('#view'), h('div', { class: 'panel narrow' }, h('p', { class: 'msg err' }, '시작하지 못했어요: ' + e.message)));
    return;
  }
  bus.on('auth', (s) => { if (!s) location.reload(); else if (!loaded) enter(); });
  if (!session) {
    replace($('#view'), loginView());
    return;
  }
  enter();
}

let loaded = false;
async function enter() {
  loaded = true;
  bus.on('sync-status', syncBadge);
  bus.on('db', (e) => { if (e.kind === 'settings' || e.type === 'reset') applySettings(); });
  await db.load();
  applySettings();
  syncBadge();
  $('#tabs').hidden = false;
  window.addEventListener('popstate', render);
  window.addEventListener('hashchange', render);
  window.addEventListener('routechange', render);
  render();
}

window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) console.error(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => {
  const m = e.reason?.message || String(e.reason || '');
  if (/play\(\)|NotAllowedError|interrupted|AbortError/i.test(m)) return;
  console.error(e.reason);
  toast(m.slice(0, 120), 'err', 4000);
});

start();
