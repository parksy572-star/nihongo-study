// 원고지 모델과 표기법 검사
// page.grid[line][cell] — 가로쓰기: line=행(위→아래), cell=칸(왼→오) / 세로쓰기: line=줄(오른쪽→왼쪽), cell=칸(위→아래)
// 칸 내용: '' 빈 칸, 한 글자, 또는 한 칸에 함께 쓰는 두 글자(。」, 숫자 2자)
// 글자에서 확실히 판단할 수 있는 규칙은 여기서 직접 검사하고(AI보다 정확),
// 사진을 봐야 하는 규칙(작은 글자 위치, 세로쓰기 장음 방향)만 AI에 맡긴다.

import { GENKO_RULES } from './prefs.js';

export const RULE_NAME = Object.fromEntries(GENKO_RULES.map(([k, n]) => [k, n]));
export const VISUAL_RULES = ['small', 'choon']; // 사진으로만 판단

export const dims = (paper, rows, cols) => (paper === 'genko-v' ? { lines: cols, cells: rows } : { lines: rows, cells: cols });

// 칸 위치 → 사진 안의 비율 사각형 [x, y, w, h] (원고지 칸 영역만 잘라 둔 사진 기준)
export function cellRect(paper, rows, cols, line, cell) {
  if (paper === 'genko-v') return [(cols - 1 - line) / cols, cell / rows, 1 / cols, 1 / rows];
  return [cell / cols, line / rows, 1 / cols, 1 / rows];
}

const PUNCT = /^[。、，．,.]/;
const CLOSE = /^[」』）)】]/;
const SMALL = /[っゃゅょぁぃぅぇぉッャュョァィゥェォ]/;
const DIGIT = /[0-9０-９]/;
const DASH = /^[…―—]$/;
const blank = (c) => !c || !String(c).trim();
const content = (line) => { let a = 0, b = line.length - 1; while (a < line.length && blank(line[a])) a++; while (b >= 0 && blank(line[b])) b--; return a > b ? null : { a, b }; };

// 이 줄에서 문단이 끝났는지: 문장 끝(。！？」)에서 줄이 남았거나, 3칸 이상 비었을 때.
// 다음 줄이 구두점·닫는 괄호로 시작하면(규칙 위반이지만) 같은 문단이 이어지는 것으로 본다.
function endsParagraph(line, c, N, nextLine) {
  const trailing = N - 1 - c.b;
  if (trailing <= 0) return false;
  const nextFirst = (nextLine || []).find((x) => !blank(x)) || '';
  if (nextLine && (PUNCT.test(nextLine[0] || '') || CLOSE.test(nextLine[0] || ''))) return false;
  if (/[。！？!?」』]$/.test(line[c.b] || '')) return true;
  return trailing >= 3 && !!nextFirst;
}

// 제목·이름 줄이 있는지 추정: 첫 줄이 짧고, 둘째 줄이 오른쪽(아래쪽)에 몰려 있으면 제목+이름
export function structure(grid) {
  const n = grid[0]?.length || 20;
  const c0 = content(grid[0] || []), c1 = content(grid[1] || []);
  const hasTitle = !!c0 && c0.a >= 1 && (c0.b - c0.a + 1) <= n * 0.7 && !!c1 && c1.a >= n / 3;
  return { hasTitle, bodyStart: hasTitle ? 2 : 0 };
}

export function checkGenko(pages, { paper, rows, cols, enabled }) {
  const issues = [];
  if (paper === 'plain') return issues;
  const vertical = paper === 'genko-v';
  const { cells: N } = dims(paper, rows, cols);
  const on = (k) => enabled(k);
  const add = (rule, page, line, cell, detail, sure = true) => issues.push({ rule, name: RULE_NAME[rule], page, line, cell, detail, sure, source: 'local' });

  pages.forEach((pg, pi) => {
    const grid = pg.grid || [];
    const page = pi + 1;
    const st = pi === 0 ? structure(grid) : { hasTitle: false, bodyStart: 0 };
    if (st.hasTitle) {
      const c0 = content(grid[0]);
      if (on('title') && (c0.a < 2 || c0.a > 3)) add('title', page, 1, c0.a + 1, `제목은 위에서 2~3칸 띄우고 써요 (지금 ${c0.a}칸).`);
      const c1 = content(grid[1]);
      if (on('name')) {
        const trailing = N - 1 - c1.b;
        if (trailing !== 1) add('name', page, 2, c1.b + 1, `이름 뒤(끝)는 1칸만 비워요 (지금 ${trailing}칸).`);
        const inner = grid[1].slice(c1.a, c1.b + 1);
        if (!inner.some(blank)) add('name', page, 2, c1.a + 1, '성과 이름 사이를 1칸 비워요.');
      }
    }
    // 본문
    let prevEndedEarly = true; // 본문 첫 줄은 문단 시작
    for (let l = st.bodyStart; l < grid.length; l++) {
      const line = grid[l];
      const c = content(line);
      if (!c) { prevEndedEarly = true; continue; }
      const first = line[c.a];
      const isDialog = /^[「『]/.test(first || '');
      if (on('indent') && prevEndedEarly && !isDialog) {
        if (c.a === 0) add('indent', page, l + 1, 1, '문단의 첫 칸은 1칸 비워요.');
        else if (c.a > 1) add('indent', page, l + 1, 1, `문단 시작은 1칸만 비워요 (지금 ${c.a}칸).`);
      }
      if (on('dialog') && isDialog && c.a !== 0 && prevEndedEarly) add('dialog', page, l + 1, c.a + 1, '대화문 「」은 새 행 첫 칸부터 써요.');
      // 행 첫 칸의 구두점·닫는 괄호
      if (on('punct') && PUNCT.test(line[0] || '')) add('punct', page, l + 1, 1, '구두점(。、)은 행 첫 칸에 오면 안 돼요. 앞 행 마지막 칸에 글자와 함께 넣어요.');
      if (on('close') && CLOSE.test(line[0] || '')) add('close', page, l + 1, 1, '닫는 괄호는 행 첫 칸에 오면 안 돼요. 앞 행 마지막 칸에 함께 넣어요.');
      for (let k = 0; k < line.length; k++) {
        const cell = line[k] || '';
        const next = line[k + 1] || '';
        if (on('close') && cell === '。' && /^[」』]/.test(next)) add('close', page, l + 1, k + 1, '「。」와 「」」가 이어지면 한 칸에 함께 써요.');
        if (on('dialog') && /^[「『]/.test(cell) && k > 0 && (line[k - 1] === '。' || /。$/.test(line[k - 1] || ''))) add('dialog', page, l + 1, k + 1, '문장 뒤에 이어지는 대화문은 새 행 첫 칸부터 써요.', false);
        if (on('small') && cell.length > 1 && SMALL.test(cell) && !/[。、」]/.test(cell)) add('small', page, l + 1, k + 1, '작은 글자(っゃゅょ)도 한 칸을 차지해요.');
        if (on('number')) {
          if (vertical && DIGIT.test(cell)) add('number', page, l + 1, k + 1, '세로쓰기에서는 한자 숫자(二〇二六)로 써요.');
          if (!vertical) {
            const digits = [...cell].filter((x) => DIGIT.test(x)).length;
            if (digits > 2) add('number', page, l + 1, k + 1, '아라비아 숫자는 한 칸에 2자까지 써요.');
            const single = (x) => !!x && [...x].length === 1 && DIGIT.test(x);
            if (single(cell) && single(next) && !single(line[k - 1])) add('number', page, l + 1, k + 1, '가로쓰기는 아라비아 숫자 2자를 한 칸에 써요 (예: 2027 → [20][27]).');
          }
        }
        if (on('dash') && DASH.test(cell) && !DASH.test(line[k - 1] || '') && !DASH.test(next)) add('dash', page, l + 1, k + 1, '「……」「――」는 2칸에 걸쳐 써요.');
      }
      prevEndedEarly = endsParagraph(line, c, N, grid[l + 1]);
    }
  });
  return issues;
}

// 원고지 → 읽은 글(문단 단위)
export function gridToText(pages, paper, rows, cols) {
  if (paper === 'plain') return pages.map((p) => (p.lines || []).map((l) => l.text).join('\n')).join('\n');
  const { cells: N } = dims(paper, rows, cols);
  const out = [];
  let para = '';
  pages.forEach((pg, pi) => {
    const grid = pg.grid || [];
    const st = pi === 0 ? structure(grid) : { hasTitle: false, bodyStart: 0 };
    if (st.hasTitle) {
      out.push(grid[0].filter((c) => !blank(c)).join(''));
      out.push(grid[1].map((c) => (blank(c) ? ' ' : c)).join('').trim().replace(/\s+/g, ' '));
    }
    for (let l = st.bodyStart; l < grid.length; l++) {
      const c = content(grid[l]);
      if (!c) { if (para) { out.push(para); para = ''; } continue; }
      const text = grid[l].slice(c.a, c.b + 1).map((x) => (blank(x) ? '　' : x)).join('');
      if (c.a >= 1 && para) { out.push(para); para = ''; }
      para += text;
      if (endsParagraph(grid[l], c, N, grid[l + 1])) { out.push(para); para = ''; }
    }
  });
  if (para) out.push(para);
  return out.join('\n');
}

// AI에게 칸 위치를 알려 주는 표: 'p1 r3: 　私の夢は…' (빈 칸은 전각 공백)
export function gridText(pages, paper) {
  const unit = paper === 'genko-v' ? '줄' : '행';
  return pages.map((pg, pi) => (pg.grid || []).map((line, l) => {
    if (!line.some((c) => !blank(c))) return null;
    return `p${pi + 1} ${l + 1}${unit}: ` + line.map((c) => (blank(c) ? '　' : c.length > 1 ? `[${c}]` : c)).join('');
  }).filter(Boolean).join('\n')).join('\n');
}

export const charCount = (pages) => pages.reduce((n, p) => n + (p.grid ? p.grid.flat().filter((c) => !blank(c)).length : (p.lines || []).reduce((m, l) => m + l.text.replace(/\s/g, '').length, 0)), 0);
