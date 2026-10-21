// 판 단위 반복 더미: 한 판을 끝까지 넘긴 뒤 모르는 카드만 다시 섞어 다음 판을 만든다.
// 연속 정답 횟수 xN: 한 번이라도 '모름'으로 넘긴 카드는 연속 N번 '앎'이어야 완료.
// 상태는 그대로 JSON으로 저장해 다른 기기에서 이어서 할 수 있다.

import { shuffle } from './core.js';

export class RoundDeck {
  constructor({ ids = [], streak = 1, state = null } = {}) {
    this.s = state || {
      round: 1,
      queue: shuffle(ids),
      pos: 0,
      next: [],
      done: [],
      total: ids.length,
      need: Math.max(1, streak | 0),
      missed: {},   // id → 모름 횟수
      run: {},      // id → 연속 앎 횟수
      history: [],  // 되돌리기용
      lastId: null,
    };
  }
  get state() { return this.s; }
  get finished() { return this.s.pos >= this.s.queue.length && !this.s.next.length; }
  current() { return this.s.queue[this.s.pos] ?? null; }
  progress() { return { known: this.s.done.length, total: this.s.total, round: this.s.round, left: this.s.queue.length - this.s.pos }; }

  answer(known) {
    const s = this.s;
    const id = this.current();
    if (id == null) return { finished: true };
    s.history.push(JSON.stringify({ round: s.round, queue: s.queue, pos: s.pos, next: s.next, done: s.done, missed: s.missed, run: s.run, lastId: s.lastId }));
    if (s.history.length > 50) s.history.shift();
    if (known) {
      s.run[id] = (s.run[id] || 0) + 1;
      const needed = s.missed[id] ? s.need : 1;
      if (s.run[id] >= needed) s.done.push(id); else s.next.push(id);
    } else {
      s.missed[id] = (s.missed[id] || 0) + 1;
      s.run[id] = 0;
      s.next.push(id);
    }
    s.lastId = id;
    s.pos++;
    let roundEnded = false;
    if (s.pos >= s.queue.length && s.next.length) {
      roundEnded = true;
      let q = shuffle(s.next);
      if (q.length > 1 && q[0] === s.lastId) [q[0], q[1]] = [q[1], q[0]]; // 직전 카드가 바로 다시 나오지 않게
      s.queue = q; s.pos = 0; s.next = []; s.round++;
    }
    return { finished: this.finished, roundEnded, id };
  }

  undo() {
    const last = this.s.history.pop();
    if (!last) return false;
    Object.assign(this.s, JSON.parse(last));
    return true;
  }

  // 여러 번 모른다고 한 카드 (완료 화면용)
  hard(min = 2) {
    return Object.entries(this.s.missed).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n }));
  }
}
