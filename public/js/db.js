// 데이터 계층: 모든 학습 데이터·AI 결과·진행 상태·설정을 Supabase items 표에 저장하고
// PC·휴대폰에 실시간으로 반영한다. 브라우저에는 오프라인용 임시 사본과 저장 대기 목록만 둔다.
//
// 행 모양: { id, kind, data, created_at, updated_at }
// kind: word · kanji · grammar · preset · session · writing · log · settings · progress · ai
//
// 로컬 체험 모드(localhost?demo): 서버 없이 이 기기 안에서만 저장하는 시험용 백엔드.
// 탭 두 개를 열면 BroadcastChannel로 '다른 기기' 동기화를 흉내 낸다.

import { bus, store, uid, debounce, deviceLabel, toast } from './core.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.1/+esm';

export const DEMO = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
  && new URLSearchParams(location.search).has('demo');

/* ---------------- IndexedDB (파일 임시 보관) ---------------- */

const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('nihongo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined),
    set: (k, v) => tx('readwrite', (s) => s.put(v, k)).catch(() => undefined),
    del: (k) => tx('readwrite', (s) => s.delete(k)).catch(() => undefined),
    keys: () => tx('readonly', (s) => s.getAllKeys()).catch(() => []),
  };
})();

/* ---------------- 백엔드: Supabase ---------------- */

async function supabaseBackend() {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  let channel = null;
  return {
    sb,
    async session() { return (await sb.auth.getSession()).data.session; },
    onAuth(cb) { sb.auth.onAuthStateChange((_e, s) => setTimeout(() => cb(s), 0)); },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; },
    async signUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
      if (error) throw error;
      return data;
    },
    async signOut() { await sb.auth.signOut(); },
    async token() { return (await sb.auth.getSession()).data.session?.access_token; },
    async selectAll() {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('items').select('id, kind, data, created_at, updated_at')
          .neq('kind', 'ai').neq('kind', 'test').neq('kind', 'test-audio')
          .order('created_at', { ascending: true }).range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    },
    async upsert(row) {
      const { data, error } = await sb.from('items').upsert({ id: row.id, kind: row.kind, data: row.data }, { onConflict: 'id' })
        .select('id, kind, data, created_at, updated_at').single();
      if (error) throw error;
      return data;
    },
    async remove(id) { const { error } = await sb.from('items').delete().eq('id', id); if (error) throw error; },
    async aiGet(key) {
      const { data, error } = await sb.from('items').select('id, data').eq('kind', 'ai').eq('data->>key', key).limit(1);
      if (error) throw error;
      return data[0] || null;
    },
    async aiGetMany(keys) {
      const { data, error } = await sb.from('items').select('id, data').eq('kind', 'ai').in('data->>key', keys);
      if (error) throw error;
      return data;
    },
    subscribe(userId, cb) {
      if (channel) sb.removeChannel(channel);
      channel = sb.channel('items-' + userId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `user_id=eq.${userId}` }, (p) => {
          if (p.eventType === 'DELETE') cb({ type: 'delete', id: p.old.id });
          else cb({ type: 'upsert', row: p.new });
        })
        .subscribe((status) => bus.emit('realtime', status));
    },
    storage: {
      async upload(path, blob, contentType) {
        const { error } = await sb.storage.from('media').upload(path, blob, { contentType, upsert: true });
        if (error) throw error;
      },
      async download(path) {
        const { data, error } = await sb.storage.from('media').download(path);
        if (error) throw error;
        return data;
      },
      async remove(paths) { await sb.storage.from('media').remove(paths); },
      async list(prefix) {
        const { data, error } = await sb.storage.from('media').list(prefix, { limit: 1000 });
        if (error) throw error;
        return data;
      },
    },
  };
}

/* ---------------- 백엔드: 로컬 체험 모드 ---------------- */

function demoBackend() {
  const KEY = 'demo:items';
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('nihongo-demo') : null;
  const read = () => store.get(KEY, []);
  const write = (rows) => store.set(KEY, rows);
  let listener = null;
  bc && (bc.onmessage = (e) => listener?.(e.data));
  const user = { id: '00000000-0000-4000-8000-000000000000', email: 'demo@localhost' };
  return {
    demo: true,
    async session() { return { user, access_token: 'demo' }; },
    onAuth() {},
    async signIn() {}, async signUp() {}, async signOut() { toast('체험 모드에서는 로그아웃이 없어요'); },
    async token() { return 'demo'; },
    async selectAll() { return read().filter((r) => r.kind !== 'ai'); },
    async upsert(row) {
      const rows = read();
      const now = new Date().toISOString();
      const i = rows.findIndex((r) => r.id === row.id);
      const out = i >= 0 ? { ...rows[i], kind: row.kind, data: row.data, updated_at: now }
        : { id: row.id, kind: row.kind, data: row.data, created_at: now, updated_at: now };
      if (i >= 0) rows[i] = out; else rows.push(out);
      write(rows);
      bc?.postMessage({ type: 'upsert', row: out });
      return out;
    },
    async remove(id) { write(read().filter((r) => r.id !== id)); bc?.postMessage({ type: 'delete', id }); },
    async aiGet(key) { return read().find((r) => r.kind === 'ai' && r.data.key === key) || null; },
    async aiGetMany(keys) { return read().filter((r) => r.kind === 'ai' && keys.includes(r.data.key)); },
    subscribe(_uid, cb) { listener = cb; setTimeout(() => bus.emit('realtime', 'SUBSCRIBED'), 50); },
    storage: {
      async upload(path, blob) { await idb.set('file:' + path, blob); },
      async download(path) { const b = await idb.get('file:' + path); if (!b) throw new Error('파일 없음'); return b; },
      async remove(paths) { for (const p of paths) await idb.del('file:' + p); },
      async list(prefix) { return (await idb.keys()).filter((k) => String(k).startsWith('file:' + prefix)).map((k) => ({ name: String(k).slice(5 + prefix.length + 1) })); },
    },
  };
}

/* ---------------- 공개 API ---------------- */

let backend = null;
let session = null;
const rows = new Map();
let queue = [];            // [{op:'upsert', row} | {op:'delete', id}]
let flushing = false;
const fileCache = new Map();

const cacheKey = () => `cache:${DEMO ? 'demo' : session?.user?.id}`;
const queueKey = () => `queue:${DEMO ? 'demo' : session?.user?.id}`;
const saveCache = debounce(() => store.set(cacheKey(), [...rows.values()]), 800);
const saveQueue = () => { store.set(queueKey(), queue); bus.emit('sync-status', status()); };

function status() {
  return { pending: queue.length, online: navigator.onLine, demo: DEMO };
}

export const db = {
  get demo() { return DEMO; },
  get user() { return session?.user || null; },
  get raw() { return backend; },
  status,

  async init() {
    backend = DEMO ? demoBackend() : await supabaseBackend();
    session = await backend.session();
    backend.onAuth((s) => {
      const changed = (s?.user?.id || null) !== (session?.user?.id || null);
      session = s;
      if (changed) bus.emit('auth', s);
    });
    return session;
  },
  signIn: (e, p) => backend.signIn(e, p),
  signUp: (e, p) => backend.signUp(e, p),
  signOut: () => backend.signOut(),
  token: () => backend.token(),

  // 로그인 후 한 번: 임시 사본으로 먼저 그리고, 서버에서 최신을 받아 바꾼다.
  async load() {
    rows.clear();
    for (const r of store.get(cacheKey(), [])) rows.set(r.id, r);
    queue = store.get(queueKey(), []);
    for (const q of queue) {
      if (q.op === 'upsert') rows.set(q.row.id, { ...rows.get(q.row.id), ...q.row });
      if (q.op === 'delete') rows.delete(q.id);
    }
    bus.emit('db', { type: 'reset' });
    try {
      const server = await backend.selectAll();
      rows.clear();
      for (const r of server) rows.set(r.id, r);
      for (const q of queue) {
        if (q.op === 'upsert') rows.set(q.row.id, { ...rows.get(q.row.id), ...q.row });
        if (q.op === 'delete') rows.delete(q.id);
      }
      saveCache();
      bus.emit('db', { type: 'reset' });
    } catch (e) {
      console.warn('서버에서 불러오기 실패, 임시 사본 사용', e);
      toast('서버에 연결하지 못해 이 기기에 남은 사본을 보여줘요', 'err', 4000);
    }
    backend.subscribe(session.user.id, onRemote);
    flush();
    window.addEventListener('online', () => { flush(); bus.emit('sync-status', status()); });
    window.addEventListener('offline', () => bus.emit('sync-status', status()));
    setInterval(flush, 20000);
    flushPendingFiles();
  },

  all(kind) { return [...rows.values()].filter((r) => r.kind === kind); },
  get(id) { return rows.get(id) || null; },
  one(kind, pred = () => true) { return [...rows.values()].find((r) => r.kind === kind && pred(r.data)) || null; },

  // 저장(추가·수정). data 전체를 바꾼다. 즉시 화면에 반영하고 서버에 보낸다.
  put(kind, data, id = null) {
    const prev = id ? rows.get(id) : null;
    const now = new Date().toISOString();
    const row = {
      id: id || uid(), kind,
      data: { ...data, _dev: deviceLabel(), _at: now },
      created_at: prev?.created_at || now, updated_at: now,
    };
    rows.set(row.id, row);
    enqueue({ op: 'upsert', row: { id: row.id, kind, data: row.data } });
    saveCache();
    bus.emit('db', { type: 'upsert', kind, id: row.id, row });
    return row;
  },
  patch(id, partial) {
    const r = rows.get(id);
    if (!r) return null;
    return db.put(r.kind, { ...r.data, ...partial }, id);
  },
  remove(id) {
    const r = rows.get(id);
    rows.delete(id);
    queue = queue.filter((q) => !(q.op === 'upsert' && q.row.id === id));
    enqueue({ op: 'delete', id });
    saveCache();
    bus.emit('db', { type: 'delete', kind: r?.kind, id });
  },

  /* 설정: settings 행 하나 */
  settings() { return db.one('settings')?.data || {}; },
  setSettings(patch) {
    const r = db.one('settings');
    return db.put('settings', { ...(r?.data || {}), ...patch }, r?.id);
  },

  /* 진행 중인 작업: progress 행 (type별 하나) */
  progress(type) { return db.one('progress', (d) => d.type === type); },
  saveProgress(type, state) {
    const r = db.progress(type);
    return db.put('progress', { ...state, type }, r?.id);
  },
  clearProgress(type) { const r = db.progress(type); if (r) db.remove(r.id); },

  /* AI 결과 캐시: 같은 입력이면 어느 기기에서든 저장된 결과를 쓴다 */
  async aiGet(key) {
    const local = db.one('ai', (d) => d.key === key);
    if (local) return local.data.result;
    try { const r = await backend.aiGet(key); if (r) { rows.set(r.id, { ...r, kind: 'ai' }); return r.data.result; } } catch { /* 오프라인 */ }
    return null;
  },
  // 여러 키를 한 번에 (후리가나처럼 작은 결과가 많을 때)
  async aiGetMany(keys) {
    const out = {};
    const missing = [];
    for (const k of keys) { const l = db.one('ai', (d) => d.key === k); if (l) out[k] = l.data.result; else missing.push(k); }
    for (let i = 0; i < missing.length; i += 80) {
      try {
        for (const r of await backend.aiGetMany(missing.slice(i, i + 80))) { rows.set(r.id, { ...r, kind: 'ai' }); out[r.data.key] = r.data.result; }
      } catch { break; }
    }
    return out;
  },
  aiSet(key, task, result, model) {
    const r = db.one('ai', (d) => d.key === key);
    return db.put('ai', { key, task, model, result }, r?.id);
  },

  /* 파일 보관함 (media/<uid>/...) */
  filePath(sub) { return `${session.user.id}/${sub}`; },
  async upload(sub, blob, contentType) {
    const path = db.filePath(sub);
    fileCache.set(path, blob);
    try {
      await backend.storage.upload(path, blob, contentType || blob.type);
    } catch (e) {
      // 연결이 끊겼으면 기기에 두었다가 다시 연결되면 올린다
      await idb.set('pending:' + path, { blob, contentType: contentType || blob.type });
      bus.emit('sync-status', { ...status(), files: true });
      console.warn('파일 업로드 대기', e);
    }
    return path;
  },
  async download(path) {
    if (fileCache.has(path)) return fileCache.get(path);
    const pending = await idb.get('pending:' + path);
    if (pending) return pending.blob;
    const blob = await backend.storage.download(path);
    fileCache.set(path, blob);
    return blob;
  },
  async fileUrl(path) { return URL.createObjectURL(await db.download(path)); },
  async removeFiles(paths) {
    const list = paths.filter(Boolean);
    if (!list.length) return;
    list.forEach((p) => fileCache.delete(p));
    try { await backend.storage.remove(list); } catch { /* 무시 */ }
  },
  async listFiles(prefix) { return backend.storage.list(db.filePath(prefix)); },
};

function enqueue(op) {
  // 같은 행의 이전 저장 대기는 마지막 것만 남긴다
  if (op.op === 'upsert') queue = queue.filter((q) => !(q.op === 'upsert' && q.row.id === op.row.id));
  queue.push(op);
  saveQueue();
  flushSoon();
}
const flushSoon = debounce(() => flush(), 300);

async function flush() {
  if (flushing || !queue.length || !backend || !session) return;
  flushing = true;
  try {
    while (queue.length) {
      const q = queue[0];
      try {
        if (q.op === 'upsert') {
          const saved = await backend.upsert(q.row);
          const cur = rows.get(saved.id);
          // 보내는 동안 다시 바뀌지 않았으면 서버 시각으로 맞춘다
          if (cur && cur.data._at === saved.data._at) rows.set(saved.id, { ...cur, created_at: saved.created_at, updated_at: saved.updated_at });
        } else {
          await backend.remove(q.id);
        }
        queue.shift();
        saveQueue();
      } catch (e) {
        const msg = String(e?.message || e);
        if (!navigator.onLine || /fetch|network|Failed|timeout/i.test(msg)) break; // 나중에 다시
        console.error('저장 실패', e);
        toast('저장 실패: ' + msg, 'err', 5000);
        queue.shift();
        saveQueue();
      }
    }
  } finally {
    flushing = false;
    saveCache();
  }
}

async function flushPendingFiles() {
  const keys = (await idb.keys()).filter((k) => String(k).startsWith('pending:'));
  for (const k of keys) {
    const path = String(k).slice(8);
    const v = await idb.get(k);
    try {
      await backend.storage.upload(path, v.blob, v.contentType);
      await idb.del(k);
    } catch { return; }
  }
  bus.emit('sync-status', status());
}
window.addEventListener('online', () => backend && flushPendingFiles());

function onRemote(ev) {
  if (ev.type === 'delete') {
    if (!rows.has(ev.id)) return;
    const kind = rows.get(ev.id)?.kind;
    rows.delete(ev.id);
    saveCache();
    bus.emit('db', { type: 'delete', kind, id: ev.id, remote: true });
    return;
  }
  const row = ev.row;
  if (['test', 'test-audio'].includes(row.kind)) return;
  // 이 기기에 아직 보내지 못한 변경이 있으면 내 것을 우선한다
  if (queue.some((q) => q.op === 'upsert' && q.row.id === row.id)) return;
  const prev = rows.get(row.id);
  if (prev && prev.data?._at === row.data?._at) { rows.set(row.id, { ...prev, updated_at: row.updated_at }); return; }
  rows.set(row.id, row);
  saveCache();
  bus.emit('db', { type: 'upsert', kind: row.kind, id: row.id, row, prev, remote: true });
}
