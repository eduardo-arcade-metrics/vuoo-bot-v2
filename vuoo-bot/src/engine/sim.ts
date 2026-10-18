/* VUOO Bot's motion. Each state sets targets for the head's pose, the
   gaze and the atom; every parameter eases toward them (1 − e^(−9·dt)),
   as in the playground the spec comes from. The motion profile scales all
   of it: full, reduced (0.35) or minimal (0, where everything snaps and
   nothing oscillates).

   On top of the eased pose sit the jumps (a crouch, a parabola with an
   optional full turn, a squash on landing), which are robot-heads' hops:
   the squash is a spring, so the landing wobbles back. The states' colours
   ease too: the atom takes on its state's light, the screen changes colour
   in 0.3 s.

   The playground's pseudo-3D numbers carry over unchanged: yaw, pitch and
   roll are the same radians, and lengths given there as a share of the
   box S are turned into head units with S = 1.515 (the head is 0.66 S
   wide and 1 unit wide here). */

import { STATES, TRANSITION, type EyeShape, type VuooState } from '../../../docs/vuoo-bot.spec';
import { parseColor } from '../../../src/color';
import type { EyeKind, FaceParams, FaceSpec } from './faces';

type RGB = [number, number, number];

const S = 1.515;
const W = 1;
const H = 0.636;

const CROUCH = 0.11;
/* the "órbita" ring the atoms go round: half-widths in head units */
const RING = { x: 0.85, y: 0.6 };
/* the tilt of the ring toward the viewer */
const RING_TILT = 0.9;
/* the expanded ring is this many times the ring of "Órbita" */
const EXPANDED = 2.6;
/* the states whose atoms go round the head; their atoms draw on the page layer */
const RINGED: VuooState[] = ['orbita', 'orbitaExpandida', 'chamarFaiscas'];
/* the states that move like the idle, with their atoms on top of it */
const IDLE_LIKE: VuooState[] = ['ocioso', 'orbita', 'orbitaExpandida', 'chamarFaiscas'];

/* one of the atoms in "órbita": its own ring, speed, wobble and timing, so no two cycles look alike */
interface Orbiter {
  rx: number;
  ry: number;
  tilt: number;
  speed: number;
  phase: number;
  wobF: number;
  wobA: number;
  delay: number;
  back: number;
}

interface OrbitRun {
  start: number;
  end: number;
  grow: number;
  hold: number;
  orbiters: Orbiter[];
}
const TAP_SPIN = 1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/* a seeded random, as robot-heads uses, so a head's hops and glances are its own */
function rng(seed: number) {
  let a = Math.floor(seed * 4294967295) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Spring {
  x = 0;
  v = 0;
  step(target: number, dt: number, freq: number, damping: number) {
    const w = freq * Math.PI * 2;
    this.v += (w * w * (target - this.x) - 2 * damping * w * this.v) * dt;
    this.x += this.v * dt;
  }
}

interface Jump {
  age: number;
  height: number;
  spin: number;
  lean: number;
  air: number;
  landed: boolean;
}

export interface VuooPose {
  yaw: number;
  pitch: number;
  roll: number;
  /* sideways and upward, in head widths */
  x: number;
  lift: number;
  /* scale about the bottom of the head */
  sx: number;
  sy: number;
  /* how far the screen is darkened, 0–1 */
  dim: number;
}

/* one of the atom's copies in "órbita": where it is, in head units from the head's centre, and its size against the atom */
export interface Satellite {
  x: number;
  y: number;
  z: number;
  k: number;
}

export interface OrbitPose {
  /* where it floats, in head units from the head's centre, and how much the head's scale shows on it */
  x: number;
  y: number;
  k: number;
  behind: boolean;
  /* the copies of the atom in "órbita" */
  sats: Satellite[];
  /* whether the atoms go on the page layer, which reaches past the bot's box */
  overlay: boolean;
  /* the light it casts, and the sphere's own colours */
  glow: RGB;
  glowA: number;
  base: RGB;
  edge: RGB;
}

export interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  /* the bubble's radius, in head units */
  r: number;
  c: RGB;
}

export interface SimInput {
  /* motion profile amplitude: 1, 0.35 or 0 */
  amp: number;
  /* the atom's colour, and the screen's (the state may change the screen) */
  atomo: RGB;
  tela: RGB;
  effects: boolean;
  /* the pointer, relative to the head and already scaled to −1…1, or null */
  pointer: { dx: number; dy: number } | null;
  /* where the logo is, in head units from the head's centre: where "Chamar faíscas" sends its sparks from */
  origin?: { x: number; y: number } | null;
}

const kind = (e: EyeShape): EyeKind => (e === 'wink' ? 'happy' : e);

const CONFETTI: RGB[] = [[255, 122, 33], [246, 239, 226], [255, 211, 77], [143, 227, 194], [255, 143, 184]];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => {
  const t = k < 0 ? 0 : 255, a = Math.abs(k);
  return [c[0] + (t - c[0]) * a, c[1] + (t - c[1]) * a, c[2] + (t - c[2]) * a];
};
const hex = (h: string): RGB => parseColor(h) ?? [246, 240, 228];

/* the parameters that ease toward their targets */
type Params = {
  yaw: number; pitch: number; roll: number; x: number; y: number; scale: number; sq: number;
  gx: number; gy: number; ox: number; oy: number; dim: number;
};
const KEYS: Array<keyof Params> = ['yaw', 'pitch', 'roll', 'x', 'y', 'scale', 'sq', 'gx', 'gy', 'ox', 'oy', 'dim'];

export class VuooSim {
  state: VuooState;
  prev: VuooState;
  /* true while the head is paused: a state change then shows at once */
  frozen = false;
  clock = 0;
  pose: VuooPose = { yaw: 0, pitch: 0, roll: 0, x: 0, lift: 0, sx: 1, sy: 1, dim: 0 };
  orbit: OrbitPose;
  face: { spec: FaceSpec; params: FaceParams };
  confetti: Confetto[] = [];
  private orbitRun: OrbitRun | null = null;
  private origin: { x: number; y: number } | null = null;
  private wander: { end: number; fx: number; fx2: number; fy: number; px: number; py: number; ampX: number; ampY: number } | null = null;
  /* where the guest atom is, eased toward its target so a new wander does not jump */
  private guestPos: { x: number; y: number } | null = null;
  /* the screen's colour now, easing to the state's */
  led: RGB = [255, 122, 33];
  /* seconds since the state changed: the screen's switch-on */
  sinceChange = 99;

  private p: Params = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, scale: 1, sq: 0, gx: 0, gy: 0, ox: W * 0.5, oy: -H * 0.76, dim: 0 };
  private trans = -9;
  private snap = true;
  private nextBlink: number;
  private blinkAt = -9;
  private boostAt = -9;
  private wantTap = false;
  /* a change of state hops once, with a turn: a standard reaction */
  private wantStateHop = false;
  /* the euphoria's bursts of confetti */
  private nextBurst = 0;
  /* thinking turns to one side, then the other, every 3.5 s */
  private side = 1;
  private nextSide = 0;
  /* the idle's glances: a random turn of the head and the eyes, every 1.4–4 s */
  private glance = { yaw: 0, pitch: 0, gx: 0, gy: 0 };
  private nextGlance = 0.6;
  /* hops: the idle's and the working's, and the squash and jump that go with them */
  private rand: () => number;
  private nextHop: number;
  private jump: Jump | null = null;
  private squash = new Spring();
  private jumpOut = { lift: 0, spin: 0, lean: 0, squash: 0 };
  /* the atom's colours, easing to the state's */
  private atomCol: RGB | null = null;
  private glowCol: RGB = [246, 240, 228];
  private ledFrom: RGB = [255, 122, 33];
  private ledTo: RGB | null = null;
  private ledT = 0;

  constructor(private seed: number, state: VuooState) {
    this.state = this.prev = state;
    this.rand = rng(seed);
    this.nextBlink = 1 + seed * 3;
    this.nextHop = 6 + this.rand() * 6;
    this.orbit = { x: 0, y: 0, k: 1, behind: false, sats: [], overlay: false, glow: [246, 240, 228], glowA: 0, base: [246, 240, 228], edge: [217, 207, 190] };
    this.face = { spec: this.baseFace(state), params: { lookX: 0, lookY: 0, open: 1, time: 0, amp: 1, seed } };
  }

  setState(s: VuooState) {
    if (s === this.state) return;
    this.prev = this.state;
    this.state = s;
    this.trans = this.frozen ? -9 : this.clock;
    this.sinceChange = 0;
    this.nextHop = this.clock + 1 + this.rand() * 3;
    this.wantStateHop = true;
    this.nextBurst = 0;
    if (this.frozen) this.snap = true;
  }

  /** A tap on the head: a hop with a turn, and a happy face. */
  poke() {
    this.boostAt = this.clock;
    this.wantTap = true;
  }

  /** Jump to the targets on the next update, as after a change of profile or size. */
  snapNow() {
    this.snap = true;
  }

  private baseFace(state: VuooState): FaceSpec {
    const f = STATES[state].face;
    return { left: kind(f.eyes), right: kind(f.eyes), scale: f.eyeScale, mouth: f.mouth, extra: f.extra };
  }

  /* where each parameter wants to be, by state */
  private targets(t: number, a: number, input: SimInput): Params {
    const sd = this.seed * 10, st = this.state;
    const T: Params = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, scale: 1, sq: 0, gx: 0, gy: 0, ox: W * 0.5, oy: -H * 0.76, dim: 0 };
    const bob = Math.sin(t * 1.7 + sd);
    const ptr = input.pointer;
    const dx = ptr ? ptr.dx : 0, dy = ptr ? ptr.dy : 0;
    switch (IDLE_LIKE.includes(st) ? 'ocioso' : st) {
      case 'ocioso': {
        const gl = this.glance;
        T.yaw = (0.08 * Math.sin(t * 0.5 + sd) + gl.yaw) * a;
        T.roll = -gl.yaw * 0.16 * a;
        T.pitch = (0.05 * Math.sin(t * 0.7) + gl.pitch) * a;
        T.gx = gl.gx * a;
        T.gy = gl.gy * a;
        T.y = S * 0.012 * bob * a;
        if (ptr && a > 0) {
          T.yaw += dx * 0.22 * a;
          T.gx += dx * 0.5 * a;
          T.gy = dy * 0.4 * a;
        }
        T.oy += H * 0.05 * Math.sin(t * 2 + sd) * a;
        break;
      }
      case 'atento':
        T.roll = 0.09;
        T.scale = 1.03;
        T.pitch = 0.04 + 0.05 * Math.max(0, Math.sin(t * 2.2)) * a;
        T.y = S * 0.006 * bob * a;
        T.gy = 0.05;
        T.oy += H * 0.03 * Math.sin(t * 2) * a;
        break;
      case 'pensando': {
        /* the head as robot-heads' thinking: turned and tilted to one side, the eyes up toward it */
        const s = this.side;
        T.yaw = 0.24 * s + Math.sin(t * 0.9) * 0.05 * a;
        T.pitch = 0.17 + Math.sin(t * 1.3) * 0.03 * a;
        T.roll = -0.13 * s;
        T.gx = 0.44 * s;
        T.gy = -0.6;
        T.y = S * 0.008 * bob * a;
        T.oy += H * 0.04 * Math.sin(t * 2.6) * a;
        break;
      }
      case 'encorajar':
        T.roll = -0.1;
        T.pitch = 0.02 + 0.05 * Math.sin(t * 1.4) * a;
        T.gy = 0.1;
        T.y = S * 0.008 * bob * a;
        break;
      case 'descansar':
        T.pitch = -0.14;
        T.y = S * 0.03 + S * 0.006 * Math.sin(t * 0.8) * a;
        T.scale = 1 + 0.012 * Math.sin(t * 0.8) * a;
        T.gy = 0.25;
        T.ox = W * 0.42;
        T.oy = -H * 0.62;
        break;
      case 'buscar': {
        /* the head swings and the eyes lead it, as robot-heads' searching */
        const ph = t * 1.6;
        T.yaw = Math.sin(ph) * 0.55 * a;
        T.pitch = (-0.04 + Math.sin(ph * 2) * 0.04) * a;
        T.roll = -Math.sin(ph) * 0.06 * a;
        T.gx = (clamp(Math.sin(ph + 0.4) * 3, -3, 3) / 3.2) * a;
        break;
      }
      case 'falar':
        /* the head nods a little with the words */
        T.yaw = 0.12 * Math.sin(t * 0.7) * a;
        T.pitch = (0.03 + 0.025 * Math.sin(t * 6.3) * (0.5 + 0.5 * Math.sin(t * 2.1))) * (a > 0 ? 1 : 0.5);
        T.roll = 0.05 * Math.sin(t * 0.9) * a;
        T.gy = -0.5;
        T.y = -S * 0.01 * Math.abs(Math.sin(t * 6.3)) * a;
        break;
      case 'trabalhar':
        /* head down over the job, the eyes on the bar */
        T.yaw = 0.08 * Math.sin(t * 0.8) * a;
        T.pitch = -0.16;
        T.roll = 0.04 * Math.sin(t * 0.5) * a;
        T.gy = 0.5;
        T.y = -S * 0.012 * Math.abs(Math.sin(t * 7)) * a;
        break;
      case 'acerto':
        /* a small bounce and a nod, the happy beat */
        T.roll = 0.05 * Math.sin(t * 3) * a;
        T.y = -S * 0.02 * Math.abs(Math.sin(t * 4)) * a;
        T.pitch = 0.04 + 0.03 * Math.sin(t * 4) * a;
        break;
      case 'brincar':
      case 'pergunta': {
        /* the eyes, and a little of the head, go to the atom; in "pergunta" they go to you every other beat */
        const atom = this.guestAtom(a);
        let gx = 0, gy = 0;
        if (atom) {
          gx = clamp(atom.x * 9, -4, 4) / 3.2;
          gy = clamp(atom.y * 6, -3, 3) / 2;
        }
        if (st === 'pergunta' && a > 0 && Math.floor(t / 2.2) % 2 === 1) {
          gx = ptr ? dx * 0.8 : 0;
          gy = ptr ? dy * 0.6 : 0;
        }
        T.gx = gx;
        T.gy = gy;
        T.yaw = st === 'brincar' ? (atom ? atom.x * 0.25 : 0) * a : 0;
        break;
      }
      case 'chamarFaiscas':
        /* the head and eyes turn toward the logo, up and to the left */
        T.yaw = -0.12 * a;
        T.pitch = -0.06;
        T.gx = -0.5;
        T.gy = -0.4;
        break;
      case 'orbitaExpandida':
      case 'orbita':
        /* the head tips up toward the copies, the eyes with it */
        T.yaw = 0.1 * Math.sin(t * 0.6) * a;
        T.pitch = -0.1;
        T.gy = -0.5;
        break;
      case 'erro':
        /* the shake is added on top in update, so it is not eased away */
        T.pitch = -0.06;
        T.roll = -0.05;
        break;
      case 'espelhar':
        if (a === 0) {
          T.gx = dx < -0.33 ? -0.8 : dx > 0.33 ? 0.8 : 0;
          T.gy = dy < -0.33 ? -0.6 : dy > 0.33 ? 0.6 : 0;
        } else if (ptr) {
          T.gx = dx * 0.8;
          T.gy = dy * 0.6;
          T.yaw = a === 1 ? dx * 0.38 : 0;
          T.pitch = a === 1 ? -dy * 0.15 : 0;
        } else {
          const s = Math.sin(t * 0.9 + sd);
          T.gx = s * 0.7 * a;
          T.yaw = a === 1 ? s * 0.3 : 0;
        }
        T.y = S * 0.008 * bob * a;
        T.ox += a === 1 ? dx * W * 0.12 : 0;
        break;
      case 'provocar': {
        const ph = (t + sd * 0.3) % 1.8;
        const push = ph < 0.35 ? Math.sin((ph / 0.35) * Math.PI) : 0;
        T.yaw = 0.22;
        T.gx = 0.1;
        T.roll = -0.03;
        T.x = S * 0.035 * push * a;
        T.y = S * 0.006 * bob * a;
        T.ox = W * 0.5 + W * 0.16 * push * (a === 1 ? 1 : 0);
        T.oy = -H * 0.76 + H * 0.1 * push * (a === 1 ? 1 : 0);
        break;
      }
      case 'celebrar':
        if (a === 1) {
          const h = Math.abs(Math.sin(t * 3.4));
          T.y = -h * S * 0.085;
          T.roll = 0.09 * Math.sin(t * 3.4);
          /* landing: squashed flat and wide */
          T.sq = h < 0.15 ? (0.15 - h) * 0.5 : 0;
          const th = t * 3;
          T.ox = Math.cos(th) * W * 0.66;
          T.oy = -H * 0.1 + Math.sin(th) * H * 0.36;
        } else {
          T.roll = (0.06 * Math.sin(t * 2.4) * a) / 0.35 * 0.6;
          T.y = -S * 0.01 * Math.abs(Math.sin(t * 2.4)) * a;
        }
        break;
      case 'recuar':
        T.scale = 0.82 + 0.008 * Math.sin(t * 0.8) * a;
        T.y = -S * 0.035;
        T.dim = 0.55;
        T.pitch = -0.04;
        T.gy = 0.15;
        T.ox = W * 0.38;
        T.oy = -H * 0.62;
        break;
    }
    return T;
  }

  /* the state's face, with the swap between faces, the blink, the wink and the tap folded in */
  private composeFace(t: number, a: number) {
    let st = this.state;
    let open = 1;
    const tr = (t - this.trans) / 0.24;
    if (a > 0 && tr >= 0 && tr < 1) {
      st = tr < 0.5 ? this.prev : this.state;
      open = Math.abs(1 - 2 * tr);
    }
    const spec = this.baseFace(st);
    if (st === 'provocar' && a === 1 && (t + this.seed) % 2.6 < 0.45) spec.right = 'happy';
    const bt = t - this.boostAt;
    if (bt >= 0 && bt < 0.9 && a > 0 && st !== 'descansar') {
      spec.left = spec.right = 'happy';
      spec.mouth = 'big';
    }
    const canBlink = a > 0 && ['ocioso', 'atento', 'espelhar', 'provocar', 'encorajar', 'pensando', 'buscar', 'falar', 'trabalhar', 'orbita', 'orbitaExpandida', 'chamarFaiscas'].includes(st);
    if (canBlink && t > this.nextBlink) {
      this.blinkAt = t;
      this.nextBlink = t + 2.4 + ((((Math.sin(t * 12.9898 + this.seed * 78.2) * 43758.5) % 1) + 1) % 1) * 3.2;
    }
    const d = t - this.blinkAt;
    if (canBlink && d >= 0 && d < 0.18) open *= Math.abs(1 - d / 0.09);
    /* a face that is closing is always the ring */
    if (open < 0.999 && spec.left !== 'ring') spec.left = spec.right = 'ring';
    const p = this.p;
    this.face = { spec, params: { lookX: p.gx * 3.2, lookY: p.gy * 2, open, time: t, amp: a, seed: this.seed } };
  }

  /* the atom: its light by state, eased, and its body tinted by it */
  private composeOrbit(t: number, a: number, dt: number, atomo: RGB) {
    const p = this.p, st = this.state;
    const spec = STATES[st];
    const off = st === 'descansar';
    let glowA = off ? 0 : st === 'recuar' ? 0.2 : 0.75;
    if (a > 0 && st === 'pensando') glowA = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4));
    if (a > 0 && st === 'encorajar') glowA = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.6));
    if (a > 0 && st === 'falar') glowA = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 11));
    if (a > 0 && st === 'trabalhar') glowA = (t * 1.7) % 1 < 0.5 ? 0.75 : 0.3;
    if (a > 0 && st === 'erro') glowA = (t * 3) % 1 < 0.5 ? 0.9 : 0.25;
    if (a > 0 && st === 'buscar') glowA = (t * 2.4) % 1 < 0.18 ? 0.9 : 0.3;
    if (st === 'ocioso') glowA = 0.35;
    if (a > 0 && st === 'orbita') glowA = 0.6 + 0.2 * Math.sin(t * 2);
    if (a > 0 && st === 'pergunta') glowA = 0.5 + 0.3 * Math.sin(t * 1.5);

    const glowTarget = hex(spec.orbit.glow);
    const baseTarget = off ? hex('#6E6862') : st === 'recuar' ? mix(atomo, [140, 133, 124], 0.5) : mix(atomo, glowTarget, 0.22);
    if (!this.atomCol) {
      this.atomCol = baseTarget;
      this.glowCol = glowTarget;
    }
    const k = this.frozen || this.snap || a === 0 ? 1 : 1 - Math.exp(-dt * TRANSITION.easeRate);
    this.atomCol = mix(this.atomCol, baseTarget, k);
    this.glowCol = mix(this.glowCol, glowTarget, k);

    this.orbit = {
      x: p.ox,
      y: p.oy,
      k: p.scale,
      behind: st === 'celebrar' && a === 1 && Math.sin(t * 3) < 0,
      sats: this.orbit.sats,
      overlay: RINGED.includes(st),
      glow: this.glowCol,
      glowA,
      base: this.atomCol,
      edge: off ? hex('#4C4743') : shade(this.atomCol, -0.14),
    };
  }

  /* the screen's colour: the state's (the error's red) or the chosen one, changing in 0.3 s */
  private composeLed(dt: number, tela: RGB) {
    const sc = STATES[this.state].screen;
    const target = sc ? hex(sc) : tela;
    if (!this.ledTo) {
      this.led = target;
      this.ledTo = target;
    }
    if (target.join() !== this.ledTo.join()) {
      this.ledFrom = this.led;
      this.ledTo = target;
      this.ledT = 0;
    }
    this.ledT += dt;
    const k = this.frozen ? 1 : clamp(this.ledT / TRANSITION.colorSeconds, 0, 1);
    this.led = mix(this.ledFrom, this.ledTo, k).map(Math.round) as RGB;
  }

  /* a new, random cycle: the atoms (the original is the first) with their own rings and timings */
  private newOrbitRun(a: number, now: number, scale: number): OrbitRun {
    const r = this.rand;
    const n = a === 1 ? 8 : 6;
    const grow = 0.3 + r() * 0.35;
    const hold = 2.5 + r() * 3;
    const orbiters: Orbiter[] = [];
    for (let i = 0; i < n; i++) {
      orbiters.push({
        rx: scale * RING.x * (0.7 + r() * 0.5),
        ry: scale * RING.y * (0.55 + r() * 0.7),
        tilt: 0.3 + r() * 1.1,
        speed: (0.6 + r() * 1.3) * a,
        phase: r() * Math.PI * 2,
        wobF: 1.5 + r() * 3.5,
        wobA: 0.05 + r() * 0.15,
        delay: i === 0 ? 0 : r() * 0.12,
        back: i === 0 ? 0 : r() * 0.4,
      });
    }
    const end = Math.max(...orbiters.map((o) => o.delay + 2 * grow + hold + o.back)) + 0.3;
    return { start: now, end, grow, hold, orbiters };
  }

  /* where the atom is in "brincar" and "pergunta", in head units, and how far in front of the head (z > 0) */
  private guestAtom(a: number): { x: number; y: number; z: number } | null {
    const lc = this.sinceChange;
    if (this.state === 'brincar') {
      if (a === 0) return { x: 0, y: -0.2, z: 0.35 };
      /* a new wander every 5–8 s: its own speeds, phases and reach, so it never repeats */
      if (!this.wander || lc > this.wander.end) {
        const r = this.rand;
        this.wander = {
          end: lc + 5 + r() * 3,
          fx: 0.8 + r() * 1.6,
          fx2: 2 + r() * 3,
          fy: 1.5 + r() * 2,
          px: r() * 6,
          py: r() * 6,
          ampX: 0.22 + r() * 0.2,
          ampY: 0.22 + r() * 0.22,
        };
      }
      const w = this.wander;
      const amp = a === 1 ? 1 : 0.5;
      return {
        x: clamp(amp * (w.ampX * Math.sin(lc * w.fx + w.px) + 0.12 * Math.sin(lc * w.fx2 + w.py)), -0.42, 0.42),
        y: -0.05 - amp * w.ampY * Math.abs(Math.sin(lc * w.fy + w.py)),
        z: 0.35,
      };
    }
    if (this.state === 'pergunta') return { x: 0.42, y: -0.1 + (a === 0 ? 0 : 0.02 * Math.sin(lc * 1.6)), z: 0.5 };
    return null;
  }

  /* where each atom of the "órbita" is: the original (the first) leaves its place, the others come out of it */
  private placeOrbit(a: number, dt: number) {
    const g = this.guestAtom(a);
    if (g) {
      /* the atom leaves its place and goes to where the state keeps it */
      const f = a === 0 ? 1 : easeInOut(clamp(this.sinceChange / 0.6, 0, 1));
      const tx = this.p.ox + (g.x - this.p.ox) * f;
      const ty = this.p.oy + (g.y - this.p.oy) * f;
      if (!this.guestPos || a === 0) this.guestPos = { x: tx, y: ty };
      else {
        const k = 1 - Math.exp(-dt * 8);
        this.guestPos = { x: this.guestPos.x + (tx - this.guestPos.x) * k, y: this.guestPos.y + (ty - this.guestPos.y) * k };
      }
      this.orbit.x = this.guestPos.x;
      this.orbit.y = this.guestPos.y;
      this.orbit.behind = g.z < 0;
      this.orbit.sats = [];
      this.orbitRun = null;
      return;
    }
    this.guestPos = null;
    if (this.state === 'euforia' && a === 1) {
      /* the atom races round the head, fast, at a tilt */
      const th = this.sinceChange * 4.2;
      const ry = Math.sin(th) * 0.6;
      this.orbit.x = Math.cos(th) * 0.95;
      this.orbit.y = ry * Math.cos(RING_TILT);
      this.orbit.behind = ry * Math.sin(RING_TILT) < 0;
      this.orbit.sats = [];
      this.orbitRun = null;
      return;
    }
    if (!RINGED.includes(this.state)) {
      this.orbitRun = null;
      this.orbit.sats = [];
      return;
    }
    if (!this.orbitRun || this.sinceChange - this.orbitRun.start >= this.orbitRun.end || a === 0 && !this.orbitRun.orbiters.length) {
      this.orbitRun = this.newOrbitRun(a, this.sinceChange, this.state === 'orbitaExpandida' ? EXPANDED : 1);
    }
    const run = this.orbitRun;
    const lc = this.sinceChange - run.start;
    const t = this.clock;
    /* "Chamar as faíscas": the sparks leave the logo; the atom leaves its place too, and orbits with them */
    const chamar = this.state === 'chamarFaiscas' && this.origin !== null;
    const sats: Satellite[] = [];
    let mainX = this.p.ox, mainY = this.p.oy, mainZ = 0;
    run.orbiters.forEach((o, i) => {
      const ox = chamar && i > 0 ? this.origin!.x : this.p.ox;
      const oy = chamar && i > 0 ? this.origin!.y : this.p.oy;
      /* growth, a hold on the ring, then back in: each atom eases on its own */
      const tau = lc - o.delay;
      const grow = easeInOut(clamp(tau / run.grow, 0, 1));
      const hide = 1 - easeInOut(clamp((tau - run.grow - run.hold - o.back) / run.grow, 0, 1));
      const f = a === 0 ? 1 : Math.min(grow, hide);
      const th = o.phase + lc * o.speed + Math.sin(lc * o.wobF) * o.wobA;
      const rr = 1 + 0.07 * Math.sin(lc * o.wobF * 1.7 + o.phase);
      const rx = Math.cos(th) * o.rx * rr;
      const ry = Math.sin(th) * o.ry * rr;
      const jx = a === 0 ? 0 : Math.sin(t * 13 + o.phase) * 0.012 * f;
      const jy = a === 0 ? 0 : Math.cos(t * 11 + o.phase) * 0.012 * f;
      const x = ox + (rx + jx - ox) * f;
      const y = oy + (ry * Math.cos(o.tilt) + jy - oy) * f;
      const z = ry * Math.sin(o.tilt) * f;
      if (i === 0) {
        mainX = x; mainY = y; mainZ = z;
      } else {
        /* identical atoms: the same size as the original, growing out of it */
        if (f > 0.01) sats.push({ x, y, z, k: f });
      }
    });
    this.orbit.x = mainX;
    this.orbit.y = mainY;
    this.orbit.behind = mainZ < 0;
    this.orbit.sats = sats;
  }

  /* one burst of confetti bubbles, from the atom in every direction */
  private burst(ox: number, oy: number) {
    for (let i = 0; i < 36; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 1.1;
      this.confetti.push({
        x: ox,
        y: oy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.6,
        life: 1.2 + Math.random() * 0.4,
        r: 0.016 + Math.random() * 0.02,
        c: CONFETTI[(Math.random() * 5) | 0],
      });
    }
  }

  private spawn(dt: number, a: number, input: SimInput) {
    if (a < 1 || !input.effects) this.confetti.length = 0;
    const g = 1.0;
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const q = this.confetti[i];
      q.vy += g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
      if (q.life <= 0 || q.y > 0.6) this.confetti.splice(i, 1);
    }
  }

  /* one small step of the hop: the crouch, the parabola, the landing's squash */
  private stepJump(dt: number) {
    const j = this.jump;
    let squashT = 0, lift = 0, spin = 0, lean = 0;
    if (j) {
      j.age += dt;
      if (j.age < CROUCH) {
        squashT = 0.14;
      } else {
        const ap = (j.age - CROUCH) / j.air;
        if (ap < 1) {
          /* leaving the ground: spring up into a stretch */
          if (ap < 0.06 && this.squash.x > 0.05) this.squash.v = -2.6;
          lift = 4 * j.height * ap * (1 - ap);
          spin = j.spin * Math.PI * 2 * easeInOut(clamp(ap * 1.08, 0, 1));
          lean = j.lean * Math.sin(ap * Math.PI);
          squashT = ap < 0.5 ? -0.05 : 0;
        } else if (!j.landed) {
          j.landed = true;
          this.squash.v += 3.2;
        } else if (j.age - CROUCH - j.air > 0.35) {
          this.jump = null;
        }
      }
    }
    this.squash.step(squashT, dt, 3.2, 0.32);
    this.jumpOut = { lift, spin, lean, squash: this.squash.x };
  }

  private hop(height: number, spin: number) {
    if (this.jump) return;
    this.jump = { age: 0, height, spin, lean: (this.rand() - 0.5) * 0.3, air: 0.42 + height * 0.45, landed: false };
  }

  /** Advance by `dt` seconds of animation clock (0 while paused). */
  update(dt: number, input: SimInput) {
    const a = input.amp;
    this.origin = input.origin ?? null;
    const st = this.state;
    this.clock += dt;
    this.sinceChange += dt;
    const t = this.clock;
    const rand = this.rand;

    /* the states' own timers: the thinking's side, the idle's glances, the hops */
    if (st === 'pensando' && t > this.nextSide) {
      this.side = -this.side;
      this.nextSide = t + 3.5;
    }
    if (IDLE_LIKE.includes(st) && a > 0 && t > this.nextGlance) {
      const yaw = (rand() - 0.5) * 0.75;
      const cells = clamp(Math.round(yaw * 5), -2, 2);
      this.glance = { yaw, pitch: (rand() - 0.5) * 0.24, gx: cells / 3.2, gy: (rand() < 0.3 ? -1 : rand() < 0.2 ? 1 : 0) / 2 };
      this.nextGlance = t + 1.4 + rand() * 2.6;
    }
    if (a === 1 && !this.jump && t > this.nextHop) {
      if (IDLE_LIKE.includes(st)) {
        this.hop(0.15 + rand() * 0.07, rand() < 0.35 ? (rand() < 0.5 ? 1 : -1) : 0);
        this.nextHop = t + 7 + rand() * 7;
      } else if (st === 'trabalhar') {
        this.hop(0.2, rand() < 0.5 ? 1 : -1);
        this.nextHop = t + 5 + rand() * 3;
      }
    }
    if (this.wantStateHop) {
      this.wantStateHop = false;
      if (a === 1) this.hop(0.2, rand() < 0.5 ? 1 : -1);
    }
    /* a tap: a hop with a turn, with full motion only */
    if (this.wantTap) {
      this.wantTap = false;
      if (a === 1) this.hop(0.24, rand() < 0.5 ? TAP_SPIN : -TAP_SPIN);
    }

    const T = this.targets(t, a, input);
    const k = a === 0 || this.snap ? 1 : 1 - Math.exp(-dt * TRANSITION.easeRate);
    for (const key of KEYS) this.p[key] += (T[key] - this.p[key]) * k;
    this.snap = false;
    const p = this.p;

    /* the jump and the squash, in steps short enough for the spring */
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < steps; i++) this.stepJump(dt / steps);
    const j = this.jumpOut;

    /* the error's shake: a head shake every 2.4 s */
    let shake = 0;
    if (st === 'erro' && a > 0) {
      const c = (t % 2.4) / 0.7;
      shake = c < 1 ? Math.sin(c * Math.PI * 7) * 0.22 * (1 - c) : 0;
    }

    /* the head turns with the atom in euforia */
    const spinE = st === 'euforia' && a === 1 ? 0.3 * Math.sin(this.sinceChange * 4.2) : 0;
    this.pose = {
      yaw: p.yaw + j.spin + shake + spinE,
      pitch: p.pitch,
      roll: p.roll + j.lean,
      x: p.x,
      lift: -p.y + j.lift,
      sx: p.scale * (1 + 0.55 * (p.sq + j.squash)),
      sy: p.scale * (1 - (p.sq + j.squash)),
      dim: p.dim,
    };
    this.composeFace(t, a);
    this.composeOrbit(t, a, dt, input.atomo);
    this.placeOrbit(a, dt);
    if (st === 'euforia' && a === 1 && input.effects && this.sinceChange > this.nextBurst) {
      this.nextBurst = this.sinceChange + 1.1;
      this.burst(this.orbit.x, this.orbit.y);
      this.hop(0.3, rand() < 0.5 ? 1 : -1);
    }
    this.composeLed(dt, input.tela);
    this.spawn(dt, a, input);
  }
}
