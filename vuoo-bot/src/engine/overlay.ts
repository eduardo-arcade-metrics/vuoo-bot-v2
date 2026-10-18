/* A layer over the whole page for the atoms and sparks that leave the bot's
   own box: the expanded orbit, and the sparks that fly in from the logo.

   It is one canvas, fixed to the viewport and click-through. Each bot
   gives its atoms a named layer each frame; the canvas is only drawn while
   some layer has something in it, so a page with nothing outside the box
   pays nothing. */

type RGB = [number, number, number];

/** One atom, in page pixels (CSS px from the top left of the viewport). */
export interface Spark {
  x: number;
  y: number;
  r: number;
  base: RGB;
  edge: RGB;
  glow: RGB;
  glowA: number;
  alpha: number;
}

const layers = new Map<string, Spark[]>();
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;

const rgb = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

function size() {
  if (!canvas || !ctx) return;
  const d = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  canvas.width = Math.round(innerWidth * d);
  canvas.height = Math.round(innerHeight * d);
  ctx.setTransform(d, 0, 0, d, 0, 0);
}

function ensure() {
  if (canvas || typeof document === 'undefined') return;
  canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh',
    pointerEvents: 'none', zIndex: '40',
  });
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  size();
  addEventListener('resize', size);
}

function draw(s: Spark) {
  if (!ctx) return;
  ctx.save();
  ctx.globalAlpha = s.alpha;
  if (s.glowA > 0.01) {
    /* the glow lights the air round the atom, behind the sphere */
    const g = ctx.createRadialGradient(s.x, s.y, s.r * 0.6, s.x, s.y, s.r * 4);
    g.addColorStop(0, rgb(s.glow, s.glowA * 0.55));
    g.addColorStop(1, rgb(s.glow, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  const b = ctx.createRadialGradient(s.x - s.r * 0.35, s.y - s.r * 0.35, 0, s.x, s.y, s.r);
  b.addColorStop(0, 'rgb(255,255,255)');
  b.addColorStop(0.5, rgb(s.base));
  b.addColorStop(1, rgb(s.edge));
  ctx.fillStyle = b;
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function frame() {
  raf = 0;
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const list of layers.values()) for (const s of list) draw(s);
  if (layers.size) raf = requestAnimationFrame(frame);
}

/** Set what one bot draws on the page layer this frame; an empty list clears it. */
export function setLayer(id: string, sparks: Spark[]) {
  if (!sparks.length) {
    if (layers.delete(id) && !raf) raf = requestAnimationFrame(frame);
    return;
  }
  layers.set(id, sparks);
  ensure();
  if (!raf) raf = requestAnimationFrame(frame);
}

export function clearLayer(id: string) {
  if (layers.delete(id) && !raf) raf = requestAnimationFrame(frame);
}
