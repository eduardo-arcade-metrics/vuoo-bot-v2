import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type CSSProperties, type MouseEvent } from 'react';
import { COLORS, MOTION, STATES, type MotionProfile, type VuooState } from '../../docs/vuoo-bot.spec';
import { parseColor } from '../../src/color';
import { linear } from '../../src/tv/light';
import { pointer, subscribe } from '../../src/ticker';
import { drawFace, switchOn } from './engine/faces';
import { VuooRenderer, frameFor, type Palette } from './engine/render';
import { VuooSim } from './engine/sim';

export interface VuooBotProps {
  /** What it is doing. Default `ocioso`. */
  estado?: VuooState;
  /** Motion profile: `completo` (default), `reduzido` or `minimo`. */
  movimento?: MotionProfile;
  /** Glow and confetti. Default `true`. */
  efeitos?: boolean;
  /** The loose atom beside the head, like the dot of the logo. Default `true`. */
  orbita?: boolean;
  /** Colour of the shell. */
  carcaca?: string;
  /** Colour of the atom, the loose ball. */
  atomo?: string;
  /** Colour of the screen's LEDs. */
  tela?: string;
  /** The box the bot rests in, in px; hops and the glow reach past it. Default `160`. */
  size?: number;
  /** Multiplier on every animation's speed. Default `1`. */
  speed?: number;
  /** Freeze every animation on its current frame. */
  paused?: boolean;
  /** Follow the pointer, and hop and turn on a tap. Default `true`. */
  interactive?: boolean;
  /** Draw the soft shadow on the floor under the head. Default `true`. */
  floorShadow?: boolean;
  /** 0–1, offsets the blinks and glances so a row of bots does not move in unison. */
  seed?: number;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLSpanElement>) => void;
}

export const vuooStates = Object.keys(STATES) as VuooState[];

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function shellPalette(shell: string): Palette {
  const s = parseColor(shell) ?? [239, 232, 218];
  return { shell: { albedo: linear(s), f0: 0.05, metal: 0.15, spec: 0.55, shininess: 70, rim: 0.9 } };
}

/**
 * VUOO Bot: a glossy capsule head with an LED-matrix face and a loose
 * atom, drawn as robot-heads draws its TV head. The element is a `size` ×
 * `size` box with the bot at rest centred in it; its canvas reaches past
 * the box, so hops, the atom's glow and the floor's shadow draw outside
 * it without taking part in layout.
 */
export const VuooBot = forwardRef<HTMLCanvasElement, VuooBotProps>(function VuooBot(
  {
    estado = 'ocioso',
    movimento = 'completo',
    efeitos = true,
    orbita = true,
    carcaca = COLORS.defaults.shell,
    atomo = COLORS.defaults.atomo,
    tela = COLORS.defaults.tela,
    size = 160,
    speed = 1,
    paused = false,
    interactive = true,
    floorShadow = true,
    seed,
    className,
    style,
    onClick,
  },
  ref,
) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement);
  const reactId = useId();
  const state: VuooState = estado in STATES ? estado : 'ocioso';
  const seedValue = clamp(seed ?? hashSeed(reactId), 0, 1);
  const frozen = paused || !(speed > 0);

  const sim = useRef<VuooSim | null>(null);
  const renderer = useRef<VuooRenderer | null>(null);
  if (!sim.current) sim.current = new VuooSim(seedValue, state);
  sim.current.frozen = frozen;
  sim.current.setState(state);

  /* the colours and the live settings are read by the loop, so changing them does not restart it */
  const pal = useRef<Palette>(shellPalette(carcaca));
  pal.current = shellPalette(carcaca);
  const colors = useRef({ atomo: [246, 240, 228] as [number, number, number], tela: [255, 122, 33] as [number, number, number] });
  colors.current = {
    atomo: parseColor(atomo) ?? [246, 240, 228],
    tela: parseColor(tela) ?? [255, 122, 33],
  };
  const frame = frameFor(size);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const live = useRef({ efeitos, orbita, floorShadow, interactive, speed, amp: MOTION[movimento].amp });
  live.current = { efeitos, orbita, floorShadow, interactive, speed, amp: MOTION[movimento]?.amp ?? 1 };

  const paint = (dt: number, pointerAt: { dx: number; dy: number } | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const f = frameRef.current;
    const w = Math.round((f.box + 2 * f.padSide) * dpr);
    const h = Math.round((f.box + f.padTop + f.padBottom) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!renderer.current) renderer.current = new VuooRenderer();
    const s = sim.current!;
    const l = live.current;
    s.update(dt, { amp: l.amp, effects: l.efeitos, atomo: colors.current.atomo, tela: colors.current.tela, pointer: pointerAt });
    const compose = (g: Parameters<typeof drawFace>[0]) => {
      drawFace(g, s.face.spec, s.face.params);
      if (s.sinceChange < 0.55) switchOn(g, s.sinceChange, s.clock);
    };
    renderer.current.draw(ctx, f, dpr, s.pose, compose, s.orbit, s.confetti, s.led, pal.current, {
      floorShadow: l.floorShadow,
      effects: l.efeitos,
      orbit: l.orbita,
    });
  };

  useEffect(() => {
    const s = sim.current!;
    /* a change of profile or size shows at once, not eased */
    s.snapNow();
    if (frozen) {
      paint(0, null);
      return;
    }
    return subscribe((dt) => {
      const el = boxRef.current;
      let at: { dx: number; dy: number } | null = null;
      if (el && live.current.interactive && Number.isFinite(pointer.x)) {
        /* measured from the resting head's centre */
        const box = el.getBoundingClientRect();
        const f = frameRef.current;
        const reach = Math.max(260, f.box * 1.4);
        at = {
          dx: clamp((pointer.x - (box.left + box.width / 2)) / reach, -1, 1),
          dy: clamp((pointer.y - (box.top + f.cy - f.padTop)) / reach, -1, 1),
        };
      }
      paint(dt * live.current.speed, at);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozen, size, state, movimento, carcaca, efeitos, orbita, floorShadow]);

  const click = (e: MouseEvent<HTMLSpanElement>) => {
    if (interactive && !frozen) sim.current?.poke();
    onClick?.(e);
  };

  return (
    <span
      ref={boxRef}
      role="img"
      aria-label={`VUOO Bot, ${STATES[state].label.toLowerCase()}: ${STATES[state].description}`}
      className={className}
      onClick={click}
      style={{ position: 'relative', display: 'block', flex: 'none', width: size, height: size, cursor: interactive ? 'pointer' : undefined, ...style }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: -frame.padSide,
          top: -frame.padTop,
          width: frame.box + 2 * frame.padSide,
          height: frame.box + frame.padTop + frame.padBottom,
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    </span>
  );
});
