/* Drawing VUOO Bot on a 2D canvas, the way robot-heads draws its TV head
   (src/tv/render.ts): the shell's sides and rolled edges are lit per quad;
   the flat front and back are plates drawn in their own plane, each
   carrying a baked relief — the lip into the screen hole and the shadow
   it casts on the glass in front, the panel line and the vent slots
   behind. A fine grain sits on the whole shell. The glass sits a little
   behind the face, so it slides against the bezel as the head turns, with
   a reflection that slides over it.

   The LEDs are what differs: rounded cells, almost circles, lit from the
   soft shapes in ./faces. The antenna is gone; the orbit, a loose sphere
   like the dot of the logo, takes its place. */

import { KEY, css, radiance, shadeCss, type Material } from '../../../src/tv/light';
import { COLS, ROWS, makeGrid, type Grid } from './faces';
import { GLASS, HEAD, INSET, PLATE, headBody, rotate, rotation, shape, type V3 } from './shape';
import type { Confetto, OrbitPose, Satellite, VuooPose } from './sim';

type RGB = [number, number, number];

export interface Palette {
  shell: Material;
}

export interface RenderOptions {
  floorShadow: boolean;
  /* glow around the orbit */
  effects: boolean;
  orbit: boolean;
}

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* a stable hash for the grain, so a rebake does not shimmer */
const hash = (x: number, y: number) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const HALF: V3 = (() => {
  const l = Math.hypot(KEY[0], KEY[1], KEY[2] + 1);
  return [KEY[0] / l, KEY[1] / l, (KEY[2] + 1) / l];
})();

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/* ── where the head sits ─────────────────────────────────────────────── */

/* how far things reach from the head's centre, in head units: the atom
   and its glow up top and to the side (it circles wide in a celebration
   and in "órbita"), a hop, the floor's shadow */
const REACH = { up: 1.15, down: 0.9, side: 1.25 };
/* the resting bot, orbit included, spans this much of the box */
const BOX_INSET = 0.05;
const CONTENT = { top: 0.54, bottom: shape.hy, wide: 1.12 };

/**
 * Where a head sits, in CSS px. The element is a `box` × `box` square
 * holding the bot at rest, centred and filling it; the canvas reaches past
 * it by `pad*` on each side, room for hops, the orbit's glow and the
 * floor's shadow, which take no part in layout. `cx`, `cy` place the centre
 * of the resting head in the canvas; `unit` is one head unit.
 */
export interface Frame {
  box: number;
  padTop: number;
  padBottom: number;
  padSide: number;
  unit: number;
  cx: number;
  cy: number;
}

export function frameFor(box: number): Frame {
  const inner = box * (1 - 2 * BOX_INSET);
  const tall = CONTENT.top + CONTENT.bottom;
  const unit = Math.min(inner / tall, inner / CONTENT.wide);
  const centreY = (box - tall * unit) / 2 + CONTENT.top * unit;
  /* whole px, and a pixel spare, so nothing ever touches the canvas edge */
  const padTop = Math.ceil(Math.max(0, REACH.up * unit - centreY) + 1);
  const padBottom = Math.ceil(Math.max(0, centreY + REACH.down * unit - box) + 1);
  const padSide = Math.ceil(Math.max(0, REACH.side * unit - box / 2) + 1);
  return { box, padTop, padBottom, padSide, unit, cx: padSide + box / 2, cy: padTop + centreY };
}

/* ── baked reliefs ───────────────────────────────────────────────────── */

/* how far the screen image reaches past the glass, so the recess never shows a gap */
const SCREEN_OVER = 0.035;
const SCREEN = {
  hx: Math.max(GLASS.hx, (COLS / 2) * shape.pitch) + SCREEN_OVER,
  hy: Math.max(GLASS.hy, (ROWS / 2) * shape.pitch) + SCREEN_OVER,
};

/**
 * A relief as light: positive brightens toward white, negative darkens
 * toward black, laid over a plate as white or black with that alpha.
 */
function bakeRelief(unit: number, fn: (u: number, v: number, ix: number, iy: number) => number): HTMLCanvasElement {
  const w = Math.ceil(PLATE.hx * 2 * unit), h = Math.ceil(PLATE.hy * 2 * unit);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  const px = (PLATE.hx * 2) / c.width;
  for (let iy = 0; iy < c.height; iy++) {
    const v = -PLATE.hy + (iy + 0.5) * px;
    for (let ix = 0; ix < c.width; ix++) {
      const u = -PLATE.hx + (ix + 0.5) * px;
      const edge = shape.sd(u, v, INSET.plate);
      const cover = Math.min(1, Math.max(0, 0.5 - edge / px));
      if (cover <= 0) continue;
      const val = fn(u, v, ix, iy);
      const i = (iy * c.width + ix) * 4;
      const a = Math.min(1, Math.abs(val)) * cover;
      const white = val > 0 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = white;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* lighting of a tilted bit of surface, relative to the flat plate */
function tilt(nx: number, ny: number, nz: number, gloss = 0.55, power = 36): number {
  const l = Math.hypot(nx, ny, nz);
  nx /= l; ny /= l; nz /= l;
  const diff = (nx * KEY[0] + ny * KEY[1] + nz * KEY[2] - KEY[2]) * 0.95;
  const spec = gloss * Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), power);
  return diff + spec - gloss * Math.pow(HALF[2], power);
}

/* gradient of a signed distance, by central differences */
function grad(fn: (u: number, v: number) => number, u: number, v: number): [number, number] {
  const e = 0.0015;
  const gx = fn(u + e, v) - fn(u - e, v);
  const gy = fn(u, v + e) - fn(u, v - e);
  const l = Math.hypot(gx, gy) || 1;
  return [gx / l, gy / l];
}

/* the front: the lip the shell rolls down into the screen hole, and on the glass the shadow that lip casts */
function bakeFront(unit: number) {
  const LIP = 0.02;
  const sdHole = (u: number, v: number) => shape.sd(u, v, INSET.hole);
  return bakeRelief(unit, (u, v, ix, iy) => {
    const grain = (hash(ix, iy) - 0.5) * 0.07;
    const dh = sdHole(u, v);
    if (dh >= 0) {
      if (dh < LIP) {
        const [gx, gy] = grad(sdHole, u, v);
        const s = 1 - dh / LIP;
        const th = s * s * 1.25;
        return tilt(-gx * Math.sin(th), -gy * Math.sin(th), Math.cos(th)) + grain;
      }
      return grain;
    }
    /* on the glass: the lip's cast shadow, darker toward the edge */
    const k = 0.05;
    const blocked = smooth(-0.012, 0.012, sdHole(u - KEY[0] * k, v - KEY[1] * k));
    return -(0.5 * blocked + 0.32 * Math.exp(dh / 0.014));
  });
}

/* the back: a panel line and five vent slots */
function bakeBack(unit: number) {
  const vents = [-0.1, -0.05, 0, 0.05, 0.1];
  const panel = (u: number, v: number) => shape.sd(u, v, INSET.plate + 0.04);
  return bakeRelief(unit, (u, v, ix, iy) => {
    const grain = (hash(ix, iy) - 0.5) * 0.07;
    const dp = panel(u, v);
    if (Math.abs(dp) < 0.006) {
      const [gx, gy] = grad(panel, u, v);
      const th = (dp / 0.006) * 1.1;
      return tilt(-gx * Math.sin(th), -gy * Math.sin(th), Math.cos(th)) * 0.9 - 0.18;
    }
    for (const vy of vents) {
      const slot = (a: number, b: number) => Math.hypot(Math.max(0, Math.abs(a) - 0.17), b - vy) - 0.012;
      const d = slot(u, v);
      if (d < 0) {
        /* down in the slot: dark, the top lip's shadow over it */
        return -0.72 - 0.15 * smooth(-0.012, 0, -(v - vy));
      }
      if (d < 0.01) {
        const [gx, gy] = grad(slot, u, v);
        const th = (1 - d / 0.01) ** 2 * 1.2;
        return tilt(-gx * Math.sin(th), -gy * Math.sin(th), Math.cos(th)) + grain;
      }
    }
    return grain;
  });
}

/* a rounded square, as a subpath: with the radius near half the side, a dot */
const CELL = 0.8;
const CORNER = 0.44;
function cellPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + s, y, x + s, y + s, r);
  ctx.arcTo(x + s, y + s, x, y + s, r);
  ctx.arcTo(x, y + s, x, y, r);
  ctx.arcTo(x, y, x + s, y, r);
  ctx.closePath();
}

/* the screen's background and the dark LEDs, which never change */
function bakeScreenBase(w: number, h: number, pitch: number, x0: number, y0: number, led: RGB) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
  g.addColorStop(0, '#171412');
  g.addColorStop(1, '#070605');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  /* each LED a dark round lens in a black grid */
  const cell = pitch * CELL;
  const off = (pitch - cell) / 2;
  const lens = `rgba(${Math.round(64 + led[0] * 0.12)},${Math.round(62 + led[1] * 0.12)},${Math.round(60 + led[2] * 0.12)},0.34)`;
  /* the dark lenses fill the whole glass, past the cells the faces use */
  const c0 = -Math.ceil(x0 / pitch), c1 = Math.ceil((w - x0) / pitch);
  const r0 = -Math.ceil(y0 / pitch), r1 = Math.ceil((h - y0) / pitch);
  ctx.fillStyle = lens;
  ctx.beginPath();
  for (let r = r0; r < r1; r++) for (let q = c0; q < c1; q++) cellPath(ctx, x0 + q * pitch + off, y0 + r * pitch + off, cell, cell * CORNER);
  ctx.fill();
  /* a faint highlight on the top of each lens */
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  for (let r = r0; r < r1; r++) {
    for (let q = c0; q < c1; q++) {
      const s = cell * 0.5;
      cellPath(ctx, x0 + q * pitch + off + (cell - s) / 2, y0 + r * pitch + off + cell * 0.1, s, s * 0.5);
    }
  }
  ctx.fill();
  return c;
}

/* the glass over the LEDs: vignette, a curved reflection, a cool sheen */
function bakeGlass(w: number, h: number) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  const top = ctx.createLinearGradient(0, 0, 0, h);
  top.addColorStop(0, 'rgba(190,210,255,0.09)');
  top.addColorStop(0.42, 'rgba(190,210,255,0.015)');
  top.addColorStop(0.43, 'rgba(190,210,255,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w * 0.3, h * 0.2);
  ctx.scale(1, 0.45);
  const spot = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.35);
  spot.addColorStop(0, 'rgba(255,255,255,0.07)');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(-w, -h * 3, w * 2, h * 6);
  ctx.restore();
  return c;
}

function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const r = hash(i, 7);
    const on = r > 0.5 ? 255 : 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = on;
    img.data[i * 4 + 3] = Math.round(hash(i, 13) * 9);
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}

/* bakes depend only on the size, so every head on the page shares them */
const bakes = new Map<number, { front: HTMLCanvasElement; back: HTMLCanvasElement; glass: HTMLCanvasElement }>();
function bakesFor(unit: number) {
  const key = Math.round(unit);
  let b = bakes.get(key);
  if (!b) {
    b = { front: bakeFront(unit), back: bakeBack(unit), glass: bakeGlass(SCREEN.hx * 2 * unit, SCREEN.hy * 2 * unit) };
    bakes.set(key, b);
  }
  return b;
}

/* ── the renderer ────────────────────────────────────────────────────── */

export class VuooRenderer {
  private unit = 0;
  private ledKey = '';
  private front: HTMLCanvasElement | null = null;
  private back: HTMLCanvasElement | null = null;
  private screen: HTMLCanvasElement | null = null;
  private screenBase: HTMLCanvasElement | null = null;
  private glass: HTMLCanvasElement | null = null;
  private layer: HTMLCanvasElement | null = null;
  private tiny = makeCanvas(COLS, ROWS);
  private tinyHalf = makeCanvas(COLS / 2, ROWS / 2);
  private tinyImg: ImageData | null = null;
  private grain: CanvasPattern | null = null;
  private grid: Grid = makeGrid(COLS, ROWS);
  private proj = new Float32Array(4096 * 3);
  private screenGeo = { pitch: 0, x0: 0, y0: 0 };

  private prepare(unit: number, led: RGB) {
    if (Math.abs(unit - this.unit) > 0.5) {
      this.unit = unit;
      const b = bakesFor(unit);
      this.front = b.front;
      this.back = b.back;
      this.glass = b.glass;
      this.screen = makeCanvas(SCREEN.hx * 2 * unit, SCREEN.hy * 2 * unit);
      this.ledKey = '';
      /* the matrix covers the whole glass, the face area centred in it */
      this.grid = makeGrid(Math.ceil((GLASS.hx * 2) / shape.pitch), Math.ceil((GLASS.hy * 2) / shape.pitch));
      this.tiny = makeCanvas(this.grid.cols, this.grid.rows);
      this.tinyHalf = makeCanvas(Math.ceil(this.grid.cols / 2), Math.ceil(this.grid.rows / 2));
      this.tinyImg = null;
      const pitch = shape.pitch * unit;
      this.screenGeo = {
        pitch,
        x0: (this.screen.width - pitch * this.grid.cols) / 2,
        y0: (this.screen.height - pitch * this.grid.rows) / 2,
      };
    }
    const key = led.join(',');
    if (key !== this.ledKey && this.screen) {
      this.ledKey = key;
      const { pitch, x0, y0 } = this.screenGeo;
      this.screenBase = bakeScreenBase(this.screen.width, this.screen.height, pitch, x0, y0, led);
    }
  }

  private drawScreen(grid: Grid, led: RGB, gain: number) {
    const s = this.screen!;
    const ctx = s.getContext('2d')!;
    const { cols, rows, v: g } = grid;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.screenBase!, 0, 0);
    const { pitch, x0, y0 } = this.screenGeo;
    const coreCss = rgb(mix(led, [255, 255, 255], 0.3));
    const bleedCss = rgb(led);
    const cell = pitch * CELL, off = (pitch - cell) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = g[r * cols + c] * gain;
        if (v < 0.01) continue;
        /* the glow round the LED, then its lit lens */
        ctx.globalAlpha = Math.min(1, v * 0.22);
        ctx.fillStyle = bleedCss;
        const bs = pitch - off * 0.8;
        ctx.beginPath();
        cellPath(ctx, x0 + c * pitch + off * 0.4, y0 + r * pitch + off * 0.4, bs, bs * CORNER);
        ctx.fill();
        ctx.globalAlpha = Math.min(1, v);
        ctx.fillStyle = coreCss;
        ctx.beginPath();
        cellPath(ctx, x0 + c * pitch + off, y0 + r * pitch + off, cell, cell * CORNER);
        ctx.fill();
      }
    }
    /* bloom: the matrix at one pixel per LED, scaled up smooth */
    const t = this.tiny.getContext('2d')!;
    if (!this.tinyImg) this.tinyImg = t.createImageData(cols, rows);
    const d = this.tinyImg.data;
    for (let i = 0; i < cols * rows; i++) {
      d[i * 4] = led[0];
      d[i * 4 + 1] = led[1];
      d[i * 4 + 2] = led[2];
      d[i * 4 + 3] = Math.round(Math.min(1, g[i] * gain) * 255);
    }
    t.putImageData(this.tinyImg, 0, 0);
    const h = this.tinyHalf.getContext('2d')!;
    h.clearRect(0, 0, this.tinyHalf.width, this.tinyHalf.height);
    h.imageSmoothingEnabled = true;
    h.drawImage(this.tiny, 0, 0, this.tinyHalf.width, this.tinyHalf.height);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22;
    ctx.drawImage(this.tiny, x0, y0, cols * pitch, rows * pitch);
    ctx.globalAlpha = 0.16;
    ctx.drawImage(this.tinyHalf, x0 - pitch, y0 - pitch, (cols + 2) * pitch, (rows + 2) * pitch);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.glass!, 0, 0);
  }

  /**
   * Draw a frame; `frame` is in CSS px, the canvas in device px (`dpr` per
   * CSS px). `compose` lights the matrix for this frame.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    dpr: number,
    pose: VuooPose,
    compose: (grid: Grid) => void,
    orbit: OrbitPose,
    confetti: Confetto[],
    led: RGB,
    palette: Palette,
    opts: RenderOptions,
  ) {
    const U = frame.unit * dpr;
    this.prepare(U, led);
    if (!this.layer || this.layer.width !== ctx.canvas.width || this.layer.height !== ctx.canvas.height) {
      this.layer = makeCanvas(ctx.canvas.width, ctx.canvas.height);
      this.grain = grainPattern(ctx);
    }
    const layer = this.layer.getContext('2d')!;

    const R = rotation(pose.yaw, pose.pitch, pose.roll);
    const cx = frame.cx * dpr + pose.x * U;
    /* the head's centre at rest */
    const rest = frame.cy * dpr;
    const cy = rest - pose.lift * U;
    const by = cy + shape.hy * U;
    const P = (x: number, y: number, z: number): V3 => {
      const r = rotate(R, x, y, z);
      return [cx + r[0] * U * pose.sx, by + (cy + r[1] * U - by) * pose.sy, r[2]];
    };
    const plane = (c: CanvasRenderingContext2D, z: number, flip: boolean) => {
      const o = P(0, 0, z), ex = P(flip ? -1 : 1, 0, z), ey = P(0, 1, z);
      c.setTransform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    /* the floor's shadow, smaller and fainter the higher the head is */
    if (opts.floorShadow) {
      const up = Math.max(0, pose.lift);
      const fy = rest + (shape.hy + 0.11) * U;
      const rx = U * shape.hx * (1 - up * 0.9) * pose.sx;
      ctx.save();
      ctx.translate(frame.cx * dpr + pose.x * U, fy);
      ctx.scale(1, 0.16);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      const a = 0.55 * Math.max(0, 1 - up * 1.6);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.55, `rgba(0,0,0,${a * 0.45})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* the orbit floats free of the head's turn: it keeps to the screen, scaled with the head */
    const orbitAt = (): [number, number] => [cx + orbit.x * U * pose.sx, by + (cy + orbit.y * U - by) * pose.sy];
    /* the copies of the atom, in "órbita": those behind the head are drawn first, those in front after it */
    const satAt = (q: Satellite): [number, number] => [cx + q.x * U * pose.sx, by + (cy + q.y * U - by) * pose.sy];
    const drawSats = (front: boolean) => {
      for (const q of orbit.sats) {
        if ((q.z >= 0) !== front) continue;
        this.drawOrbit(ctx, satAt(q), U, { ...orbit, k: orbit.k * q.k }, opts.effects, 1);
      }
    };
    if (opts.orbit && orbit.behind) this.drawOrbit(ctx, orbitAt(), U, orbit, opts.effects, 0.85);
    if (opts.orbit) drawSats(false);

    const body = headBody();
    const drawMesh = (c: CanvasRenderingContext2D) => {
      const n = body.pos.length / 3;
      const pr = this.proj;
      for (let i = 0; i < n; i++) {
        const p = P(body.pos[i * 3], body.pos[i * 3 + 1], body.pos[i * 3 + 2]);
        pr[i * 3] = p[0]; pr[i * 3 + 1] = p[1]; pr[i * 3 + 2] = p[2];
      }
      const order: Array<[number, number]> = [];
      const q = body.quads, nn = body.normals;
      for (let k = 0; k < q.length / 4; k++) {
        const nz = R[6] * nn[k * 3] + R[7] * nn[k * 3 + 1] + R[8] * nn[k * 3 + 2];
        if (nz < -0.03) continue;
        const z = pr[q[k * 4] * 3 + 2] + pr[q[k * 4 + 1] * 3 + 2] + pr[q[k * 4 + 2] * 3 + 2] + pr[q[k * 4 + 3] * 3 + 2];
        order.push([z, k]);
      }
      order.sort((a, b) => a[0] - b[0]);
      c.lineWidth = Math.max(0.6, U / 260);
      c.lineJoin = 'round';
      for (const [, k] of order) {
        const w = rotate(R, nn[k * 3], nn[k * 3 + 1], nn[k * 3 + 2]);
        const col = shadeCss(palette.shell, w[0], w[1], w[2]);
        c.beginPath();
        for (let j = 0; j < 4; j++) {
          const vi = q[k * 4 + j] * 3;
          if (j) c.lineTo(pr[vi], pr[vi + 1]);
          else c.moveTo(pr[vi], pr[vi + 1]);
        }
        c.closePath();
        c.fillStyle = col;
        c.strokeStyle = col;
        c.fill();
        c.stroke();
      }
    };

    /* the shell, on its own layer so the grain stays on it */
    layer.setTransform(1, 0, 0, 1, 0, 0);
    layer.globalCompositeOperation = 'source-over';
    layer.clearRect(0, 0, this.layer.width, this.layer.height);
    drawMesh(layer);
    const frontZ = R[8];
    const zf = shape.depth / 2;
    const facing = Math.abs(frontZ) > 0.005 ? (frontZ > 0 ? 1 : -1) : 0;
    if (facing) {
      const dome = 0.17;
      plane(layer, facing * zf, facing < 0);
      const at = (dx: number, dy: number) => {
        const w = rotate(R, dx * (facing < 0 ? -1 : 1), dy, facing);
        const l = Math.hypot(w[0], w[1], w[2]);
        return css(radiance(palette.shell, w[0] / l, w[1] / l, w[2] / l));
      };
      layer.beginPath();
      shape.path(layer, INSET.plate - 0.002);
      const vg = layer.createLinearGradient(0, -PLATE.hy, 0, PLATE.hy);
      vg.addColorStop(0, at(0, -dome));
      vg.addColorStop(0.5, at(0, 0));
      vg.addColorStop(1, at(0, dome));
      layer.fillStyle = vg;
      layer.fill();
      const hg = layer.createLinearGradient(-PLATE.hx, 0, PLATE.hx, 0);
      hg.addColorStop(0, at(-dome, 0));
      hg.addColorStop(0.5, at(0, 0));
      hg.addColorStop(1, at(dome, 0));
      layer.globalAlpha = 0.5;
      layer.fillStyle = hg;
      layer.fill();
      layer.globalAlpha = 1;
    }
    if (this.grain) {
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.globalCompositeOperation = 'source-atop';
      const m = typeof DOMMatrix === 'function' ? new DOMMatrix().translate(cx, cy) : null;
      if (m && 'setTransform' in this.grain) this.grain.setTransform(m);
      layer.fillStyle = this.grain;
      layer.fillRect(0, 0, this.layer.width, this.layer.height);
      layer.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(this.layer, 0, 0);

    /* the plate's details: the screen in front, the vents behind */
    if (facing > 0) {
      const grid = this.grid;
      grid.v.fill(0);
      compose(grid);
      ctx.save();
      plane(ctx, zf, false);
      ctx.beginPath();
      shape.path(ctx, INSET.hole);
      ctx.fillStyle = '#060709';
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      shape.path(ctx, INSET.hole);
      ctx.clip();
      this.drawScreen(grid, led, 1 - pose.dim * 0.6);
      plane(ctx, zf - HEAD.recess, false);
      ctx.drawImage(this.screen!, -SCREEN.hx, -SCREEN.hy, SCREEN.hx * 2, SCREEN.hy * 2);
      /* a reflection sliding over the glass as the head turns */
      plane(ctx, zf, false);
      const s = -0.05 - pose.yaw * 0.9 + pose.pitch * 0.5;
      const sg = ctx.createLinearGradient(-0.55 + s, -0.35, 0.15 + s, 0.35);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.36, 'rgba(255,255,255,0)');
      sg.addColorStop(0.43, 'rgba(220,232,255,0.075)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0)');
      sg.addColorStop(0.58, 'rgba(255,255,255,0)');
      sg.addColorStop(0.61, 'rgba(220,232,255,0.04)');
      sg.addColorStop(0.65, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(-GLASS.hx, -GLASS.hy, GLASS.hx * 2, GLASS.hy * 2);
      ctx.restore();
      ctx.drawImage(this.front!, -PLATE.hx, -PLATE.hy, PLATE.hx * 2, PLATE.hy * 2);
      ctx.restore();
    } else if (facing < 0) {
      ctx.save();
      plane(ctx, -zf, true);
      ctx.drawImage(this.back!, -PLATE.hx, -PLATE.hy, PLATE.hx * 2, PLATE.hy * 2);
      ctx.restore();
    }

    if (opts.orbit && !orbit.behind) this.drawOrbit(ctx, orbitAt(), U, orbit, opts.effects, 1);
    if (opts.orbit) drawSats(true);

    /* confetti: small bubbles, in head units from the resting head's centre */
    for (const q of confetti) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, q.life * 1.5);
      ctx.fillStyle = rgb(q.c);
      ctx.beginPath();
      ctx.arc(frame.cx * dpr + q.x * U, rest + q.y * U, Math.max(1.5 * dpr, q.r * U), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* the orbit: a loose sphere with a soft glow, the dot of the logo */
  private drawOrbit(ctx: CanvasRenderingContext2D, at: [number, number], U: number, o: OrbitPose, effects: boolean, scaleK: number) {
    const [bx, by] = at;
    const r = 0.054 * U * o.k * scaleK;
    /* the glow lights the air round it, behind the sphere so it never washes out its colour */
    if (effects && o.glowA > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(bx, by, r * 0.6, bx, by, r * 4);
      glow.addColorStop(0, rgba(o.glow, o.glowA * 0.55));
      glow.addColorStop(0.35, rgba(o.glow, o.glowA * 0.16));
      glow.addColorStop(1, rgba(o.glow, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(bx, by, r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    /* lit from the upper left like the shell: white at the highlight, the base colour, then the edge */
    const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.35, 0, bx, by, r);
    g.addColorStop(0, 'rgb(255,255,255)');
    g.addColorStop(0.5, rgb(o.base));
    g.addColorStop(1, rgb(o.edge));
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    /* a hairline at the silhouette, so it reads on a pale page too */
    ctx.lineWidth = Math.max(0.75, r * 0.07);
    ctx.strokeStyle = 'rgba(28,32,42,0.22)';
    ctx.stroke();
    /* the window's reflection */
    const sp = ctx.createRadialGradient(bx - r * 0.38, by - r * 0.42, 0, bx - r * 0.38, by - r * 0.42, r * 0.38);
    sp.addColorStop(0, 'rgba(255,255,255,0.9)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sp;
    ctx.fill();
  }
}
