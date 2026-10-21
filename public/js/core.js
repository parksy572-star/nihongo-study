// 화면 공통 도구: DOM 만들기, 아이콘, 알림, 시트·모달, 라우터, 이벤트, 저장소

/* ---------------- DOM ---------------- */

export function h(tag, props, ...children) {
  const el = tag === 'frag' ? document.createDocumentFragment() : document.createElement(tag);
  if (props && tag !== 'frag') {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }
export function replace(el, ...children) { clear(el); append(el, children); return el; }

/* ---------------- 아이콘 (선 아이콘, currentColor) ---------------- */

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  speaker: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  cards: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  rotate: '<path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  pen: '<path d="M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><circle cx="11" cy="11" r="2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  crop: '<path d="M6.1 1v15a2 2 0 0 0 2 2H23M1 6.1h15a2 2 0 0 1 2 2V23"/>',
  slow: '<circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
};

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

export function iconBtn(name, label, onclick, extra = {}) {
  return h('button', { class: ['icon-btn', extra.class], type: 'button', title: label, 'aria-label': label, onclick, ...extra.attrs }, icon(name, extra.size || 20));
}

/* ---------------- 이벤트 ---------------- */

const listeners = new Map();
export const bus = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name)?.delete(fn);
  },
  emit(name, payload) {
    for (const fn of listeners.get(name) || []) {
      try { fn(payload); } catch (e) { console.error(e); }
    }
  },
};

/* ---------------- 기기 저장소 (기기마다 다른 값, 임시 사본) ---------------- */

export const store = {
  get(k, d = null) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

/* ---------------- 알림 ---------------- */

export function toast(text, kind = '', ms = 2600) {
  let root = $('#toasts');
  if (!root) { root = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(root); }
  const t = h('div', { class: ['toast', kind] }, text);
  root.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------------- 바텀 시트 ---------------- */

let sheetStack = [];
export function openSheet(content, { onClose, className = '' } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const panel = h('div', { class: ['sheet', className], role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'sheet-grip' }), content);
  backdrop.append(panel);
  document.body.append(backdrop);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => backdrop.classList.add('open'));

  const api = {
    el: panel,
    close() {
      if (api.closed) return;
      api.closed = true;
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 250);
      sheetStack = sheetStack.filter((s) => s !== api);
      if (!sheetStack.length && !$('.modal-backdrop')) document.body.classList.remove('no-scroll');
      onClose?.();
    },
    setContent(c) { replace(panel, h('div', { class: 'sheet-grip' }), c); panel.scrollTop = 0; },
  };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) api.close(); });

  // 아래로 끌어서 닫기 (손잡이·맨 위에서 시작할 때만)
  let startY = null, dy = 0;
  panel.addEventListener('pointerdown', (e) => {
    if (panel.scrollTop > 0 || e.target.closest('input,textarea,select,button,a,svg.strokes')) return;
    startY = e.clientY; dy = 0;
  });
  panel.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.clientY - startY);
    if (dy > 4) panel.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (startY == null) return;
    startY = null;
    panel.style.transform = '';
    if (dy > 90) api.close();
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
  sheetStack.push(api);
  return api;
}
export function closeAllSheets() { [...sheetStack].forEach((s) => s.close()); }

/* ---------------- 모달 ---------------- */

export function modal({ title, body, actions = [], wide = false, dismissible = true }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const close = (v) => {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 200);
      if (!sheetStack.length && $$('.modal-backdrop').length <= 1) document.body.classList.remove('no-scroll');
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(null); };
    const box = h('div', { class: ['modal', wide && 'wide'], role: 'dialog', 'aria-modal': 'true' },
      title && h('h2', { class: 'modal-title' }, title),
      h('div', { class: 'modal-body' }, typeof body === 'function' ? body(close) : body),
      actions.length && h('div', { class: 'modal-actions' },
        actions.map((a) => h('button', {
          type: 'button', class: a.class || (a.primary ? '' : 'ghost'),
          onclick: async () => {
            if (a.onClick) { const r = await a.onClick(close); if (r === false) return; }
            close(a.value ?? a.label);
          },
        }, a.label))));
    backdrop.append(box);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop && dismissible) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => backdrop.classList.add('open'));
    const first = box.querySelector('input,textarea,select');
    if (first) setTimeout(() => first.focus(), 50);
  });
}

export function confirmDialog(text, { ok = '확인', cancel = '취소', danger = false } = {}) {
  return modal({
    body: h('p', { class: 'pre' }, text),
    actions: [{ label: cancel, value: false }, { label: ok, value: true, primary: true, class: danger ? 'danger' : '' }],
  }).then((v) => v === true);
}

export function choiceDialog(title, options) {
  return modal({
    title,
    body: (close) => h('div', { class: 'choice-list' },
      options.map((o) => h('button', { type: 'button', class: ['choice', o.danger && 'danger-text'], onclick: () => close(o.value) },
        o.icon && icon(o.icon), h('span', null, o.label)))),
  });
}

/* ---------------- 라우터 (#/경로?쿼리) ---------------- */

const routes = [];
export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, handler });
}
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function go(path, { replace: rep = false } = {}) {
  const target = '#' + path;
  if (rep) history.replaceState(null, '', target);
  else if (location.hash !== target) history.pushState(null, '', target);
  window.dispatchEvent(new Event('routechange'));
}
export function matchRoute(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
  }
  return null;
}

/* ---------------- 그 밖의 도구 ---------------- */

export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

export async function sha256(input) {
  const buf = input instanceof Blob ? await input.arrayBuffer()
    : new TextEncoder().encode(typeof input === 'string' ? input : JSON.stringify(input));
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtDate = (iso, withTime = false) => {
  const d = new Date(iso);
  const s = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return withTime ? `${s} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : s;
};

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function longPress(el, fn, ms = 550) {
  let t = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('pointerdown', (e) => {
    fired = false; sx = e.clientX; sy = e.clientY;
    t = setTimeout(() => { fired = true; fn(e); }, ms);
  });
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!fired) { cancel(); fn(e); } });
  // 길게 누른 뒤의 클릭은 무시
  el.addEventListener('click', (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('복사했어요'); }
  catch { toast('복사하지 못했어요', 'err'); }
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone/iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return '기기';
}

// 일본어 글자 판별
export const hasKanji = (s) => /[㐀-鿿豈-﫿々〆]/.test(s);
export const isKanjiChar = (c) => /[㐀-鿿豈-﫿々]/.test(c);
export const hasKana = (s) => /[぀-ヿ]/.test(s);
export const hasHangul = (s) => /[가-힣ㄱ-ㆎ]/.test(s);
export const isJapanese = (s) => /[぀-ヿ㐀-鿿]/.test(s);

// 텍스트 두 개가 얼마나 비슷한지 (글자 2개 묶음 기준, 0~1)
export function similarity(a, b) {
  const clean = (s) => String(s || '').replace(/[\s、。，．,.!?！？「」『』（）()・…ー〜~]/g, '');
  const A = clean(a), B = clean(b);
  if (!A.length || !B.length) return 0;
  if (A === B) return 1;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } if (s.length === 1) m.set(s, 1); return m; };
  const ga = grams(A), gb = grams(B);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) || 0);
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / total;
}

// 편집 거리 기반 일치율 (발음 평가에서 목표 문장과의 일치율)
export function matchRate(heard, target) {
  const clean = (s) => [...String(s || '').replace(/[\s、。，．,.!?！？「」『』（）()・…〜~？]/g, '')];
  const a = clean(heard), b = clean(target);
  if (!b.length) return a.length ? 0 : 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return Math.max(0, 1 - dp[a.length][b.length] / Math.max(a.length, b.length));
}

export function segmented(options, value, onChange, { small = false } = {}) {
  const wrap = h('div', { class: ['seg', small && 'small'], role: 'radiogroup' });
  const render = (v) => {
    replace(wrap, options.map(([val, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(val === v), class: val === v ? 'on' : '',
      onclick: () => { render(val); onChange(val); },
    }, label)));
  };
  render(value);
  wrap.set = render;
  return wrap;
}

export function chipToggle(label, on, onChange) {
  const b = h('button', { type: 'button', class: ['chip', on && 'on'], 'aria-pressed': String(!!on) }, label);
  b.addEventListener('click', () => {
    on = !on; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); onChange(on);
  });
  return b;
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', null, text), action);
}

export function spinner(text = '') {
  return h('div', { class: 'loading' }, h('span', { class: 'spin' }), text && h('span', null, text));
}

export function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
