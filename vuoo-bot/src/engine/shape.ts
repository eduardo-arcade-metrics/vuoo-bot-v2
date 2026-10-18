/* VUOO Bot's head: the brand's capsule, built as the same kind of quad mesh
   robot-heads uses (see src/tv/geometry.ts), so it turns, nods and spins
   with a true silhouette. The mesh itself comes from robot-heads'
   `buildBody`; this file supplies the outline.

   Compared with the robot-heads shapes there are no ears, no antenna
   collar, no screws and no rubber gasket: the glass starts right at the
   lip the shell rolls down into. */

import { buildBody, type Mesh, type Shape } from '../../../src/tv/geometry';
import { COLS, ROWS } from './faces';

export { rotate, rotation } from '../../../src/tv/geometry';
export type { Mesh, V3 } from '../../../src/tv/geometry';

export const HEAD = {
  /* radius of the rolled edge round the front and the back; buildBody's own */
  bevel: 0.075,
  /* the shell's rim round the screen */
  lip: 0.045,
  /* how far the glass sits behind the face */
  recess: 0.03,
} as const;

/* how far in from the outline each layer of the face starts */
export const INSET = {
  plate: HEAD.bevel,
  hole: HEAD.bevel + HEAD.lip,
} as const;

/* the capsule: 1 head unit wide, 0.64 tall, corners of almost half its height */
const R = 0.3;
const CX = 0.2;
const CY = 0.02;
const DEPTH = 0.42;

const HALF = Math.PI / 2;

function makeShape(): Shape {
  /* clockwise on screen from the top left; angles are canvas angles */
  const corners = [
    { x: -CX, y: -CY, a0: -Math.PI, a1: -HALF },
    { x: CX, y: -CY, a0: -HALF, a1: 0 },
    { x: CX, y: CY, a0: 0, a1: HALF },
    { x: -CX, y: CY, a0: HALF, a1: Math.PI },
  ];
  const hx = CX + R, hy = CY + R;
  /* exact distance to a rounded box: the outline grown by R - inset */
  const sd = (x: number, y: number, inset: number) => {
    const qx = Math.abs(x) - CX, qy = Math.abs(y) - CY;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - (R - inset);
  };
  const path = (ctx: CanvasRenderingContext2D | Path2D, inset: number) => {
    const rr = Math.max(0.0005, R - inset);
    corners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x + rr * Math.cos(c.a0), c.y + rr * Math.sin(c.a0));
      ctx.arc(c.x, c.y, rr, c.a0, c.a1);
    });
    ctx.closePath();
  };
  /* the LEDs are sized so the face area fills most of the glass */
  const gw = 2 * (hx - INSET.hole), gh = 2 * (hy - INSET.hole);
  const pitch = Math.min((0.88 * gw) / COLS, (0.9 * gh) / ROWS);
  return {
    /* robot-heads' type wants a name and screws; none of them are used here */
    name: 'rectangle',
    r: R,
    depth: DEPTH,
    corners,
    hx,
    hy,
    pitch,
    earX: 0,
    screws: [],
    backScrews: [],
    sd,
    path,
  };
}

export const shape: Shape = makeShape();

let body: Mesh | null = null;
export function headBody(): Mesh {
  if (!body) body = buildBody(shape);
  return body;
}

/* the glass's half extents, and the screen image's: the glass or the LED matrix, whichever is bigger */
export const GLASS = { hx: shape.hx - INSET.hole, hy: shape.hy - INSET.hole };
export const PLATE = { hx: shape.hx - INSET.plate, hy: shape.hy - INSET.plate };
