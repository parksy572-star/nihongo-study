// 사진 도구: 불러오기 → 회전·자르기(원고지 칸 맞춤선) → 1~2MB JPEG로 줄이기 → AI용 조각 만들기
import { h, icon, modal } from './core.js';

export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasOf(w, h2) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h2)); return c; }

export function toBlob(canvas, quality = 0.85) {
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
}

// 긴 변 maxSide 이하, 용량 maxBytes 이하로
export async function compress(source, { maxSide = 2400, maxBytes = 1.9 * 1024 * 1024 } = {}) {
  const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
  let side = maxSide;
  for (let i = 0; i < 6; i++) {
    const k = Math.min(1, side / Math.max(sw, sh));
    const c = canvasOf(sw * k, sh * k);
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    for (const q of [0.88, 0.8, 0.7]) {
      const b = await toBlob(c, q);
      if (b && b.size <= maxBytes) return { blob: b, width: c.width, height: c.height };
    }
    side *= 0.8;
  }
  const c = canvasOf(sw * 0.4, sh * 0.4);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return { blob: await toBlob(c, 0.7), width: c.width, height: c.height };
}

function rotated(img, quarter) {
  const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height;
  const swap = quarter % 2 === 1;
  const c = canvasOf(swap ? hh : w, swap ? w : hh);
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((quarter * Math.PI) / 2);
  ctx.drawImage(img, -w / 2, -hh / 2);
  return c;
}

/**
 * 사진 편집 창. 결과: { blob, width, height } 또는 null(취소)
 * grid: { rows, cols, vertical } 원고지면 자르는 상자 안에 칸 맞춤선을 그린다.
 */
export async function editPhoto(file, { grid = null } = {}) {
  const img = await loadImage(file);
  let quarter = 0;
  let base = rotated(img, 0);
  let crop = { x: 0.03, y: 0.03, w: 0.94, h: 0.94 };
  const stage = h('div', { class: 'editor-stage' });
  const view = document.createElement('canvas');
  const box = h('div', { class: 'crop-box' }, ['tl', 'tr', 'bl', 'br'].map((k) => h('div', { class: 'h ' + k, dataset: { h: k } })));
  const gridSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gridSvg.setAttribute('class', 'crop-grid');
  gridSvg.setAttribute('preserveAspectRatio', 'none');
  gridSvg.setAttribute('viewBox', '0 0 100 100');
  if (grid) box.append(gridSvg);
  stage.append(view, box);

  const draw = () => {
    const maxW = Math.min(window.innerWidth - 64, 680), maxH = Math.min(window.innerHeight * 0.58, 680);
    const k = Math.min(maxW / base.width, maxH / base.height, 1);
    view.width = Math.round(base.width * k); view.height = Math.round(base.height * k);
    view.getContext('2d').drawImage(base, 0, 0, view.width, view.height);
    place();
  };
  const place = () => {
    Object.assign(box.style, { left: crop.x * view.width + 'px', top: crop.y * view.height + 'px', width: crop.w * view.width + 'px', height: crop.h * view.height + 'px' });
    stage.style.width = view.width + 'px';
    if (grid) {
      let lines = '';
      for (let i = 1; i < grid.cols; i++) lines += `<line x1="${(i / grid.cols) * 100}" y1="0" x2="${(i / grid.cols) * 100}" y2="100" />`;
      for (let i = 1; i < grid.rows; i++) lines += `<line x1="0" y1="${(i / grid.rows) * 100}" x2="100" y2="${(i / grid.rows) * 100}" />`;
      gridSvg.innerHTML = `<g stroke="rgba(255,220,0,.75)" stroke-width="0.25" vector-effect="non-scaling-stroke">${lines}</g>`;
    }
  };

  // 끌기: 모서리 손잡이는 크기, 상자 안은 위치
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    const r = view.getBoundingClientRect();
    const handle = e.target.dataset?.h;
    if (!handle && !box.contains(e.target)) return;
    drag = { handle, sx: e.clientX, sy: e.clientY, start: { ...crop }, w: r.width, h: r.height };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.w, dy = (e.clientY - drag.sy) / drag.h;
    const s = drag.start;
    let { x, y, w, h: hh } = s;
    const min = 0.08;
    if (!drag.handle) { x = Math.min(1 - w, Math.max(0, s.x + dx)); y = Math.min(1 - hh, Math.max(0, s.y + dy)); }
    else {
      if (drag.handle.includes('l')) { x = Math.min(s.x + s.w - min, Math.max(0, s.x + dx)); w = s.x + s.w - x; }
      if (drag.handle.includes('r')) { w = Math.min(1 - s.x, Math.max(min, s.w + dx)); }
      if (drag.handle.includes('t')) { y = Math.min(s.y + s.h - min, Math.max(0, s.y + dy)); hh = s.y + s.h - y; }
      if (drag.handle.includes('b')) { hh = Math.min(1 - s.y, Math.max(min, s.h + dy)); }
    }
    crop = { x, y, w, h: hh };
    place();
  });
  const end = () => { drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  const body = h('div', { class: 'stack' },
    h('p', { class: 'hint' }, grid
      ? `노란 선이 원고지 칸(${grid.rows}×${grid.cols})과 맞도록 모서리를 끌어 칸 영역만 남겨 주세요. 칸이 맞아야 틀린 위치를 사진에 정확히 표시할 수 있어요.`
      : '글이 있는 부분만 남도록 모서리를 끌어 주세요.'),
    stage,
    h('div', { class: 'row wrap' },
      h('button', { type: 'button', class: 'plain small', onclick: () => { quarter = (quarter + 1) % 4; base = rotated(img, quarter); crop = { x: 0.03, y: 0.03, w: 0.94, h: 0.94 }; draw(); } }, icon('rotate', 16), '90° 회전'),
      h('button', { type: 'button', class: 'plain small', onclick: () => { crop = { x: 0, y: 0, w: 1, h: 1 }; place(); } }, icon('crop', 16), '전체')));
  setTimeout(draw, 30);
  const ok = await modal({ title: '사진 자르기·회전', body, wide: true, actions: [{ label: '취소', value: false }, { label: '완료', value: true, primary: true }] });
  if (!ok) return null;
  const sx = crop.x * base.width, sy = crop.y * base.height, sw = crop.w * base.width, sh = crop.h * base.height;
  const out = canvasOf(sw, sh);
  out.getContext('2d').drawImage(base, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return compress(out);
}

// AI에 보낼 이미지들: 전체 1장 + 확대 조각(2~4개)과 그 설명
export async function aiImages(blob, { paper, rows, cols }) {
  const img = await loadImage(blob);
  const W = img.naturalWidth, H = img.naturalHeight;
  const full = await compress(img, { maxSide: 2000, maxBytes: 1.5 * 1024 * 1024 });
  const tiles = [];
  const desc = [];
  const cut = async (x, y, w, hh) => {
    const c = canvasOf(w, hh);
    c.getContext('2d').drawImage(img, x, y, w, hh, 0, 0, c.width, c.height);
    return (await compress(c, { maxSide: 1600, maxBytes: 0.9 * 1024 * 1024 })).blob;
  };
  if (paper === 'plain') {
    const ov = H * 0.06;
    tiles.push(await cut(0, 0, W, H / 2 + ov));
    tiles.push(await cut(0, H / 2 - ov, W, H / 2 + ov));
    desc.push('조각1=위쪽 절반', '조각2=아래쪽 절반');
  } else {
    // 칸 경계에 맞춰 4등분 (행 절반 × 칸 절반)
    const r2 = Math.ceil(rows / 2), c2 = Math.ceil(cols / 2);
    const parts = [[0, 0, r2, c2], [0, c2, r2, cols], [r2, 0, rows, c2], [r2, c2, rows, cols]];
    for (const [r0, c0, r1, c1] of parts) {
      tiles.push(await cut((c0 / cols) * W, (r0 / rows) * H, ((c1 - c0) / cols) * W, ((r1 - r0) / rows) * H));
      const vertical = paper === 'genko-v';
      desc.push(vertical
        ? `조각${tiles.length}=위에서 ${r0 + 1}~${r1}칸, ${cols - c1 + 1}~${cols - c0}줄(오른쪽부터)`
        : `조각${tiles.length}=${r0 + 1}~${r1}행, ${c0 + 1}~${c1}칸`);
    }
  }
  return { full: full.blob, tiles, desc: desc.join(', ') };
}

export async function pickFiles({ camera = false, multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: multiple && !camera, style: { display: 'none' } });
    if (camera) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
    setTimeout(() => { if (!input.files?.length) { /* 취소는 알 수 없음 */ } }, 0);
  });
}

// 사진 일부 확대 (오류 표시를 눌렀을 때)
export async function zoomRegion(blob, rect, title, detail) {
  const img = await loadImage(blob);
  const W = img.naturalWidth, H = img.naturalHeight;
  const [x, y, w, hh] = rect;
  const pad = Math.max(w, hh) * 1.6;
  const sx = Math.max(0, (x - pad) * W), sy = Math.max(0, (y - pad) * H);
  const ex = Math.min(W, (x + w + pad) * W), ey = Math.min(H, (y + hh + pad) * H);
  const c = canvasOf(ex - sx, ey - sy);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, ex - sx, ey - sy, 0, 0, c.width, c.height);
  ctx.strokeStyle = '#c2483f'; ctx.lineWidth = Math.max(2, c.width / 120);
  ctx.strokeRect(x * W - sx, y * H - sy, w * W, hh * H);
  const url = URL.createObjectURL(await toBlob(c, 0.9));
  await modal({ title, body: h('div', { class: 'stack' }, h('img', { class: 'zoom-img', src: url, alt: '확대' }), detail), actions: [{ label: '닫기', primary: true }] });
  URL.revokeObjectURL(url);
}

