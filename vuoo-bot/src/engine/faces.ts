/* What VUOO Bot's screen shows: an LED matrix, one brightness per cell,
   composed every frame from the state's face and its live parameters.

   robot-heads draws its faces from block sprites. Here every part of the
   face (the ring eyes, the smile, the dots, the z's, the arrows, the talk
   bars, the beam) is a stroke or a disc laid on the matrix with a one-cell
   soft edge, so the shapes round off, the gaze moves by fractions of a cell
   and a blink closes smoothly instead of stepping row by row.

   Faces live on a COLS × ROWS face area, centred on a matrix that covers
   the whole glass, like in robot-heads. */

import type { EyeShape } from '../../../docs/vuoo-bot.spec';

export const COLS = 22;
export const ROWS = 13;

export type EyeKind = Exclude<EyeShape, 'wink'>;

export interface FaceSpec {
  left: EyeKind;
  right: EyeKind;
  scale: number;
  mouth: null | 'smile' | 'big' | 'talk' | 'flat';
  extra: null | 'dots' | 'zzz' | 'arrows' | 'beam' | 'equalizer' | 'progress';
}

export interface FaceParams {
  /* where the eyes look, in cells */
  lookX: number;
  lookY: number;
  /* 1 open … 0 shut, for the blink and the swap between faces */
  open: number;
  /* seconds on the animation clock */
  time: number;
  /* motion amplitude: 1 full, 0.35 reduced, 0 minimal */
  amp: number;
  /* 0–1, dessincroniza as barras de bots lado a lado */
  seed: number;
}

export interface Grid {
  v: Float32Array;
  cols: number;
  rows: number;
  /* where the face area starts in it */
  ox: number;
  oy: number;
}

/** A matrix of `cols` × `rows` (each at least the face area, by even steps) with the face area centred. */
export function makeGrid(cols: number, rows: number): Grid {
  const c = COLS + 2 * Math.max(0, Math.ceil((cols - COLS) / 2));
  const r = ROWS + 2 * Math.max(0, Math.ceil((rows - ROWS) / 2));
  return { v: new Float32Array(c * r), cols: c, rows: r, ox: (c - COLS) / 2, oy: (r - ROWS) / 2 };
}

type Pt = [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* in face-area coordinates; the matrix reaches past them on every side by ox, oy */
const put = (g: Grid, c: number, r: number, v: number) => {
  const x = c + g.ox, y = r + g.oy;
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return;
  const i = y * g.cols + x;
  if (v > g.v[i]) g.v[i] = v;
};

/* a line `w` cells thick along the points, round at its ends */
function stroke(g: Grid, pts: Pt[], w: number, v: number, closed = false) {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  const reach = w / 2 + 1;
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const ex = bx - ax, ey = by - ay;
    const len2 = ex * ex + ey * ey || 1e-9;
    const c0 = Math.floor(Math.min(ax, bx) - reach), c1 = Math.ceil(Math.max(ax, bx) + reach);
    const r0 = Math.floor(Math.min(ay, by) - reach), r1 = Math.ceil(Math.max(ay, by) + reach);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const px = c + 0.5 - ax, py = r + 0.5 - ay;
        const t = clamp((px * ex + py * ey) / len2, 0, 1);
        const d = Math.hypot(px - ex * t, py - ey * t);
        const cover = clamp(w / 2 - d + 0.5, 0, 1);
        if (cover > 0) put(g, c, r, cover * v);
      }
    }
  }
}

function disc(g: Grid, x: number, y: number, rad: number, v: number) {
  const reach = rad + 1;
  for (let r = Math.floor(y - reach); r <= Math.ceil(y + reach); r++) {
    for (let c = Math.floor(x - reach); c <= Math.ceil(x + reach); c++) {
      const cover = clamp(rad - Math.hypot(c + 0.5 - x, r + 0.5 - y) + 0.5, 0, 1);
      if (cover > 0) put(g, c, r, cover * v);
    }
  }
}

/* points along an ellipse from angle a0 to a1 (canvas angles, clockwise on screen) */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 26): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function ring(cx: number, cy: number, rx: number, ry: number, n = 34): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/* the open mouth: flat on top, a parabola underneath */
function bigMouth(g: Grid, cx: number, top: number, half: number, depth: number, v: number) {
  for (let r = Math.floor(top - 1); r <= Math.ceil(top + depth + 1); r++) {
    for (let c = Math.floor(cx - half - 1); c <= Math.ceil(cx + half + 1); c++) {
      const u = (c + 0.5 - cx) / half;
      const bottom = top + depth * (1 - u * u);
      const side = clamp((1 - Math.abs(u)) * half + 0.5, 0, 1);
      const cover = clamp(Math.min(r + 0.5 - top + 0.5, bottom - (r + 0.5) + 0.5), 0, 1) * side;
      if (cover > 0) put(g, c, r, cover * v);
    }
  }
}

/* a z in one stroke */
const zed = (g: Grid, x: number, y: number, w: number, h: number, lw: number, v: number) =>
  stroke(g, [[x, y], [x + w, y], [x, y + h], [x + w, y + h]], lw, v);

/* a smooth 1D value noise from a few incommensurate sines */
const noise = (x: number) => 0.5 + 0.25 * Math.sin(x * 1.7) + 0.15 * Math.sin(x * 3.1 + 1.3) + 0.1 * Math.sin(x * 5.3 + 4.1);

/* the face, in cells */
const MID = COLS / 2;
const EYE_GAP = 4.2;
const EYE_Y = 5;
const EYE_RX = 2.5;
const EYE_RY = 2.85;
const EYE_W = 1.7;
const MOUTH_Y = 9.4;

const PI = Math.PI;

function eye(g: Grid, x: number, y: number, kind: EyeKind, scale: number, open: number, v: number) {
  const rx = EYE_RX * scale, ry = EYE_RY * scale, w = EYE_W * scale;
  switch (kind) {
    case 'ring':
      stroke(g, ring(x, y, rx, Math.max(ry * open, 0.05)), w, v, true);
      break;
    case 'flat':
      /* a slit: the ring squashed, looking down at the job */
      stroke(g, ring(x, y, rx, Math.max(ry * 0.42 * open, 0.05)), w * 0.8, v, true);
      break;
    case 'happy':
      stroke(g, arc(x, y + ry * 0.35, rx, ry * 0.95, PI * 1.08, PI * 1.92), w, v);
      break;
    case 'smile':
      stroke(g, arc(x, y, rx, Math.max(ry * open, 0.05), PI * 0.78, PI * 2.22), w, v);
      break;
    case 'closed':
      stroke(g, arc(x, y, rx * 0.95, ry * 0.55, PI * 0.12, PI * 0.88), w * 0.7, v);
      break;
    case 'lid':
      /* the lower half of the ring under a straight lid */
      stroke(g, arc(x, y, rx, ry, 0, PI), w, v);
      stroke(g, [[x - rx * 1.05, y - ry * 0.05], [x + rx * 1.05, y - ry * 0.05]], w * 0.55, v);
      break;
    case 'cross': {
      /* an X, the error's eyes */
      const dx = rx * 0.85, dy = ry * 0.85;
      stroke(g, [[x - dx, y - dy], [x + dx, y + dy]], w * 0.85, v);
      stroke(g, [[x + dx, y - dy], [x - dx, y + dy]], w * 0.85, v);
      break;
    }
  }
}

export function drawFace(g: Grid, f: FaceSpec, p: FaceParams) {
  /* the arrows need room to the right of the eyes */
  const shift = f.extra === 'arrows' ? -2.2 : 0;
  const lx = MID - EYE_GAP + p.lookX + shift;
  const rx = MID + EYE_GAP + p.lookX + shift;
  const y = EYE_Y + p.lookY;
  /* the X flickers between full and faint, as robot-heads' error does */
  const flicker = p.amp > 0 && Math.sin(p.time * 7) <= -0.6 ? 0.55 : 1;
  eye(g, lx, y, f.left, f.scale, p.open, f.left === 'cross' ? flicker : 1);
  eye(g, rx, y, f.right, f.scale, p.open, f.right === 'cross' ? flicker : 1);

  /* the mouth and the extras travel with the gaze */
  const mx = MID + p.lookX + shift, my = p.lookY;
  if (f.mouth === 'smile') stroke(g, arc(mx, MOUTH_Y + my, 2.7, 1.9, PI * 0.14, PI * 0.86), 1.15, 0.95);
  if (f.mouth === 'big') bigMouth(g, mx, MOUTH_Y - 0.1 + my, 2.8, 2.4, 0.95);
  if (f.mouth === 'flat') {
    /* a zig-zag line, the error's mouth */
    const pts: Pt[] = [];
    for (let i = 0; i < 8; i++) pts.push([mx - 3.5 + i, MOUTH_Y + my + 0.5 + (i % 2) * 0.9]);
    stroke(g, pts, 0.9, 0.85);
  }
  if (f.mouth === 'talk') {
    /* eight bars that rise and fall with the words, bottom-anchored */
    const bottom = Math.round(MOUTH_Y + 1.8 + my);
    const env = p.amp > 0 ? Math.max(0, Math.sin(p.time * 2.1) * 0.5 + Math.sin(p.time * 3.7 + 1) * 0.5) : 0.4;
    for (let i = 0; i < 8; i++) {
      const centre = 1 - Math.abs(i - 3.5) / 5;
      const a = p.amp > 0 ? noise(p.time * 11 + i * 0.9) * centre * (0.35 + env) : 0.5 * centre;
      const h = a > 0.55 ? 3 : a > 0.28 ? 2 : 1;
      for (let k = 0; k < h; k++) put(g, Math.round(mx) - 4 + i, bottom - k, 1 - k * 0.1);
    }
  }

  if (f.extra === 'dots') {
    for (let i = 0; i < 3; i++) {
      const v = p.amp > 0 ? 0.45 + 0.55 * Math.max(0, Math.sin(p.time * 4 - i * 0.8)) : 0.9;
      disc(g, mx + (i - 1) * 3, 11.4 + my, 0.95, v);
    }
  }
  if (f.extra === 'arrows') {
    for (let i = 0; i < 2; i++) {
      const v = p.amp === 1 ? 0.35 + 0.65 * Math.max(0, Math.sin(p.time * 5 - i * 1.1)) : i ? 0.55 : 1;
      const ax = rx + EYE_RX * f.scale + EYE_W * f.scale * 0.5 + 1.2 + i * 3.2;
      stroke(g, [[ax, y - 2.4], [ax + 2.2, y], [ax, y + 2.4]], 1.1, v);
    }
  }
  if (f.extra === 'zzz') {
    /* a small z and a big one above it, rising and fading in turn; a letter needs four or five cells to read, and the glass's rounded corner clips the top right */
    if (p.amp > 0) {
      const rate = p.time * 0.4 * (p.amp === 1 ? 1 : 0.6);
      const small = rate % 1, big = (rate + 0.5) % 1;
      zed(g, 11.4 + small * 1.2, 1.6 - small * 1.4, 2.4, 2.4, 0.95, Math.sin(small * PI) * 0.95);
      zed(g, 14.8 + big * 1.6, 2.2 - big * 2.4, 4, 4, 1.05, Math.sin(big * PI) * 0.95);
    } else {
      zed(g, 11.6, 1, 2.4, 2.4, 0.95, 0.9);
      zed(g, 15.4, 0, 4, 4, 1, 0.9);
    }
  }
  if (f.extra === 'beam') {
    /* a beam sweeping across the whole screen, with a trail; still in the middle when minimal */
    const first = -g.ox, last = COLS - 1 + g.ox;
    const ph = p.time * 1.6 + 0.4;
    const sweep = p.amp > 0 ? first + (Math.sin(ph) * 0.5 + 0.5) * (last - first) : (first + last) / 2;
    const dir = Math.cos(ph) > 0 ? -1 : 1;
    for (let k = 0; k < 5; k++) {
      const c = Math.round(sweep + dir * k);
      const v = 0.32 * (1 - k / 5);
      for (let r = -g.oy; r < ROWS + g.oy; r++) put(g, c, r, v);
    }
  }
  if (f.extra === 'equalizer') {
    /* an equaliser, bottom-anchored, louder in the middle */
    for (let i = 0; i < 12; i++) {
      const centre = 1 - Math.abs(i - 5.5) / 7;
      const level = p.amp > 0 ? noise(p.time * 7 + i * 1.9 + p.seed * 10) * centre : 0.5 * centre;
      const h = Math.max(1, Math.round(level * 4));
      for (let k = 0; k < h; k++) put(g, 5 + i, 12 - k, 0.75 - k * 0.12);
    }
  }
  if (f.extra === 'progress') {
    /* a progress bar filling along the bottom of the eyes; half-full when minimal */
    const fill = Math.round((p.amp > 0 ? (p.time / 2.6) % 1 : 0.5) * 12);
    for (let i = 0; i < 12; i++) put(g, 5 + i, 11, i < fill ? 0.95 : 0.16);
    put(g, 4, 11, 0.4);
    put(g, 17, 11, 0.4);
  }
}

/**
 * The change of face on the screen (robot-heads' switch-on): a bright
 * line opens from the middle to the whole screen, and for the first
 * 0.13 s the rows jitter. `age` is seconds since the state changed.
 */
export function switchOn(g: Grid, age: number, t: number) {
  if (age < 0.13) {
    const seed = Math.floor(t * 30);
    for (let r = 0; r < g.rows; r++) {
      const shift = Math.floor((Math.sin(seed * 12.9 + r * 78.2) * 0.5 + 0.5) * 3) - 1;
      if (!shift) continue;
      const row = g.v.slice(r * g.cols, (r + 1) * g.cols);
      for (let c = 0; c < g.cols; c++) g.v[r * g.cols + c] = row[(c - shift + g.cols) % g.cols];
    }
    for (let i = 0; i < g.v.length; i++) if (Math.sin(i * 91.7 + seed * 3.1) > 0.93) g.v[i] = Math.max(g.v[i], 0.3);
  }
  if (age < 0.55) {
    const open = smooth(0.08, 0.5, age) * (g.rows / 2 + 0.5);
    for (let r = 0; r < g.rows; r++) {
      const d = Math.abs(r - (g.rows - 1) / 2);
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        if (d > open) g.v[i] = 0;
        else if (d > open - 1.2) g.v[i] = Math.max(g.v[i], 0.85 * (1 - age / 0.55));
      }
    }
  }
}
