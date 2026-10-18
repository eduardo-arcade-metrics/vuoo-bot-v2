import { useEffect, useRef, useState } from 'react';
import { COLORS, STATES, type MotionProfile, type VuooState } from '../../docs/vuoo-bot.spec';
import { VuooBot } from './VuooBot';
import './index.css';

/* ?estado=pensando&movimento=minimo&paused for screenshots and links */
const q = new URLSearchParams(location.search);

const stateOrder: VuooState[] = ['ocioso', 'atento', 'pensando', 'encorajar', 'descansar', 'buscar', 'falar', 'trabalhar', 'erro', 'acerto', 'orbita', 'espelhar', 'provocar', 'celebrar', 'euforia', 'brincar', 'pergunta', 'recuar'];
const profiles: MotionProfile[] = ['completo', 'reduzido', 'minimo'];
const profileLabels: Record<MotionProfile, string> = { completo: 'Completo', reduzido: 'Reduzido', minimo: 'Mínimo' };

interface Colors {
  carcaca: string;
  atomo: string;
  tela: string;
}

const DEFAULTS: Colors = { carcaca: COLORS.defaults.shell, atomo: COLORS.defaults.atomo, tela: COLORS.defaults.tela };

/* the swatches are robot-heads' own; the VUOO brand colour leads each row */
const SCREEN_SWATCHES: Array<[string, string]> = [
  ['Laranja', '#FF7A21'],
  ['Creme', '#F6F0E4'],
  ['White', '#e8f2ff'],
  ['Ice', '#7fe7ff'],
  ['Matrix', '#7dff9a'],
  ['Amber', '#ffc46b'],
  ['Neon', '#ff8fd0'],
];

const SWATCHES: Record<keyof Colors, Array<[string, string]>> = {
  carcaca: [
    ['Creme', '#EFE8DA'],
    ['Cobalt', '#2b49a3'],
    ['Tomato', '#c8372d'],
    ['Tangerine', '#e2762a'],
    ['Mustard', '#e0ad1f'],
    ['Mint', '#2f8f58'],
    ['Teal', '#1f8189'],
    ['Grape', '#6a45b8'],
    ['Bubblegum', '#d9558f'],
    ['Graphite', '#3a3d44'],
  ],
  atomo: SCREEN_SWATCHES,
  tela: SCREEN_SWATCHES,
};

const ROW_LABELS: Record<keyof Colors, string> = { carcaca: 'Carcaça', atomo: 'Átomo', tela: 'Tela' };

const SPEEDS = [0.5, 1, 1.5, 2, 2.5];

const title = (s: string) => s[0].toUpperCase() + s.slice(1);

/* the stage head fills the room it is given, within reason */
function useStageSize() {
  const measure = () => {
    const w = window.innerWidth, h = window.innerHeight;
    if (w < 900) return Math.max(160, Math.min(w - 96, 260));
    const room = Math.min(w - 2 * (300 + 40 + 40), h - 300);
    return Math.round(Math.max(170, Math.min(room * 0.62, 330)));
  };
  const [size, setSize] = useState(measure);
  useEffect(() => {
    const on = () => setSize(measure());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

function Swatches({ name, value, onChange }: { name: keyof Colors; value: string; onChange: (v: string) => void }) {
  const known = SWATCHES[name].find(([, hex]) => hex === value);
  return (
    <div className="control">
      <div className="control-head">
        <span className="control-label">{ROW_LABELS[name]}</span>
        <span className="control-value">{known ? known[0] : value}</span>
      </div>
      <div className="swatches">
        {SWATCHES[name].map(([label, hex]) => (
          <button
            key={hex}
            className="swatch"
            style={{ background: hex }}
            title={label}
            aria-label={`${ROW_LABELS[name]}: ${label}`}
            aria-pressed={hex === value}
            onClick={() => onChange(hex)}
          />
        ))}
        <label className="swatch swatch-custom" title="Custom" aria-pressed={!known} style={known ? undefined : { background: value }}>
          <input type="color" value={value} aria-label={`${ROW_LABELS[name]}: cor personalizada`} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
    </div>
  );
}

type Theme = 'dark' | 'light';

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('vuoo-bot-theme', next);
    } catch {
      /* private mode: the choice lasts the visit */
    }
  };
  return [theme, toggle] as const;
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const light = theme === 'light';
  return (
    <button className="theme" onClick={onToggle} aria-label={light ? 'Modo escuro' : 'Modo claro'} title={light ? 'Modo escuro' : 'Modo claro'}>
      {light ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

interface PropLine {
  key: string;
  /* the prop's name and value; strings are quoted, anything else goes in braces */
  name: string;
  value: string | number | boolean;
  on: boolean;
}

const propText = (l: PropLine) => (typeof l.value === 'string' ? `${l.name}="${l.value}"` : `${l.name}={${l.value}}`);

function PropTokens({ line }: { line: PropLine }) {
  return (
    <>
      <span className="tok-attr">{line.name}</span>
      <span className="tok-punct">=</span>
      {typeof line.value === 'string' ? (
        <span className="tok-string">"{line.value}"</span>
      ) : (
        <>
          <span className="tok-punct">{'{'}</span>
          <span className="tok-number">{String(line.value)}</span>
          <span className="tok-punct">{'}'}</span>
        </>
      )}
    </>
  );
}

/* the snippet, one line per prop; a prop line opens and closes on its own,
   so the block grows a line at a time instead of jumping */
function Snippet({ lines }: { lines: PropLine[] }) {
  const [last, setLast] = useState<Record<string, PropLine>>({});
  const stale = lines.filter((l) => l.on && last[l.key]?.value !== l.value);
  if (stale.length) setLast({ ...last, ...Object.fromEntries(stale.map((l) => [l.key, l])) });
  return (
    <pre className="code">
      <code>
        <span className="code-line">
          <span className="tok-punct">{'<'}</span>
          <span className="tok-tag">VuooBot</span>
        </span>
        {lines.map((l) => (
          <span key={l.key} className="code-prop" data-open={l.on}>
            <span className="code-prop-inner">
              {'  '}
              <PropTokens line={l.on ? l : last[l.key] ?? l} />
            </span>
          </span>
        ))}
        <span className="code-line tok-punct">{'/>'}</span>
      </code>
    </pre>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1400);
    }, () => {});
  return [copied, copy] as const;
}

/* the mark beside the name: at idle it does one of a few small things at random, with short pauses between */
function BrandMark() {
  const root = useRef<SVGGElement>(null);
  const eyeL = useRef<SVGEllipseElement>(null);
  const eyeR = useRef<SVGEllipseElement>(null);
  const atom = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    type Kind = 'orbit' | 'blink' | 'jump' | 'look';
    interface Act { kind: Kind; start: number; dur: number; dir: number; speed: number }
    /* the atom's home, and the ring it goes round in "orbit", in the mark's units */
    const home = { x: 111, y: 9 };
    const c = { x: 58, y: 40 };
    const rx = 56, ry = 32;
    const theta0 = Math.atan2((home.y - c.y) / ry, (home.x - c.x) / rx);
    let act: Act | null = null;
    let nextAt = performance.now() + 1200;
    let raf = 0;
    const pick = (now: number): Act => {
      const r = Math.random();
      const dir = Math.random() < 0.5 ? -1 : 1;
      if (r < 0.3) return { kind: 'orbit', start: now, dur: 2400 + Math.random() * 1200, dir, speed: 1.2 + Math.random() * 0.8 };
      if (r < 0.5) return { kind: 'blink', start: now, dur: 220, dir, speed: 0 };
      if (r < 0.75) return { kind: 'jump', start: now, dur: 620, dir, speed: 0 };
      return { kind: 'look', start: now, dur: 1400, dir, speed: 0 };
    };
    const frame = (now: number) => {
      if (!act && now >= nextAt) act = pick(now);
      let jy = 0, lx = 0, ek = 1, ax = home.x, ay = home.y;
      if (act) {
        const p = (now - act.start) / act.dur;
        if (p >= 1) {
          act = null;
          nextAt = now + 900 + Math.random() * 1700;
        } else {
          const env = Math.sin(Math.max(0, p) * Math.PI);
          const el = (now - act.start) / 1000;
          if (act.kind === 'orbit') {
            const th = theta0 + act.dir * act.speed * el * 1.5;
            const wob = 1 + 0.07 * Math.sin(el * 5);
            const px = c.x + rx * Math.cos(th) * wob;
            const py = c.y + ry * Math.sin(th) * wob;
            ax = home.x + (px - home.x) * env;
            ay = home.y + (py - home.y) * env;
          } else if (act.kind === 'blink') ek = 1 - env * 0.9;
          else if (act.kind === 'jump') jy = -7 * env;
          else lx = act.dir * 3.2 * env;
        }
      }
      if (atom.current) { atom.current.setAttribute('cx', String(ax)); atom.current.setAttribute('cy', String(ay)); }
      if (eyeL.current) { eyeL.current.setAttribute('cx', String(42 + lx)); eyeL.current.setAttribute('ry', String(11 * ek)); }
      if (eyeR.current) { eyeR.current.setAttribute('cx', String(66 + lx)); eyeR.current.setAttribute('ry', String(11 * ek)); }
      if (root.current) root.current.setAttribute('transform', 'translate(0 ' + jy.toFixed(2) + ')');
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg className="logo" viewBox="0 0 120 80" aria-hidden>
      <g ref={root}>
        <rect x="6" y="16" width="96" height="58" rx="27" fill="none" stroke="currentColor" strokeWidth="7" />
        <circle ref={atom} cx="111" cy="9" r="6" fill="currentColor" />
        <ellipse ref={eyeL} cx="42" cy="45" rx="10" ry="11" fill="none" stroke="#FF7A21" strokeWidth="7" />
        <ellipse ref={eyeR} cx="66" cy="45" rx="10" ry="11" fill="none" stroke="#FF7A21" strokeWidth="7" />
      </g>
    </svg>
  );
}

export default function App() {
  const [state, setState] = useState<VuooState>(() => {
    const s = q.get('estado') as VuooState | null;
    return s && s in STATES ? s : 'ocioso';
  });
  const [motion, setMotion] = useState<MotionProfile>(() => {
    const m = q.get('movimento') as MotionProfile | null;
    return m && profiles.includes(m) ? m : window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'minimo' : 'completo';
  });
  const [colors, setColors] = useState<Colors>(DEFAULTS);
  const [effects, setEffects] = useState(true);
  const [orbit, setOrbit] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(q.has('paused'));
  const [copied, copy] = useCopy();
  const [theme, toggleTheme] = useTheme();
  const size = useStageSize();

  const s = STATES[state];
  const changed = colors.carcaca !== DEFAULTS.carcaca || colors.atomo !== DEFAULTS.atomo || colors.tela !== DEFAULTS.tela || speed !== 1 || paused || !orbit || !effects || motion !== 'completo';
  const lines: PropLine[] = [
    { key: 'estado', name: 'estado', value: state, on: true },
    { key: 'movimento', name: 'movimento', value: motion, on: motion !== 'completo' },
    { key: 'carcaca', name: 'carcaca', value: colors.carcaca, on: colors.carcaca !== DEFAULTS.carcaca },
    { key: 'atomo', name: 'atomo', value: colors.atomo, on: colors.atomo !== DEFAULTS.atomo },
    { key: 'tela', name: 'tela', value: colors.tela, on: colors.tela !== DEFAULTS.tela },
    { key: 'efeitos', name: 'efeitos', value: effects, on: !effects },
    { key: 'orbita', name: 'orbita', value: orbit, on: !orbit },
    { key: 'speed', name: 'speed', value: speed, on: speed !== 1 },
  ];
  const snippet = `<VuooBot\n${lines.filter((l) => l.on).map((l) => `  ${propText(l)}\n`).join('')}/>`;

  const reset = () => {
    setColors(DEFAULTS);
    setSpeed(1);
    setOrbit(true);
    setEffects(true);
    setMotion('completo');
    setPaused(false);
  };

  const bot = (size: number, st: VuooState, interactive: boolean, seed?: number) => (
    <VuooBot
      size={size}
      estado={st}
      movimento={motion}
      efeitos={effects}
      orbita={orbit}
      carcaca={colors.carcaca}
      atomo={colors.atomo}
      tela={colors.tela}
      speed={speed}
      paused={paused}
      interactive={interactive}
      seed={seed}
    />
  );

  return (
    <div className="app">
      <header className="masthead">
        <div className="byline">
          <BrandMark />
          <span className="name">VUOO Bot</span>
          <span className="by">Companheiro digital do VUOO</span>
        </div>
        <div className="masthead-end">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <main className="stage" aria-label="Pré-visualização">
        {bot(size, state, true)}
        <div className="caption">
          <h1 className="font-bold">{s.label}</h1>
          <p>{s.description}</p>
          <p className="profile-line">{profileLabels[motion]}: {s.profiles[motion]}</p>
        </div>
      </main>

      <aside className="controls" aria-label="Controles">
        {(Object.keys(SWATCHES) as Array<keyof Colors>).map((key) => (
          <Swatches key={key} name={key} value={colors[key]} onChange={(v) => setColors((c) => ({ ...c, [key]: v }))} />
        ))}

        <div className="control">
          <div className="control-head">
            <span className="control-label">Órbita</span>
          </div>
          <div className="segments" role="group" aria-label="Órbita">
            {[true, false].map((v) => (
              <button key={String(v)} className="segment" aria-pressed={v === orbit} onClick={() => setOrbit(v)}>
                {v ? 'Sim' : 'Não'}
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <div className="control-head">
            <span className="control-label">Efeitos</span>
          </div>
          <div className="segments" role="group" aria-label="Efeitos">
            {[true, false].map((v) => (
              <button key={String(v)} className="segment" aria-pressed={v === effects} onClick={() => setEffects(v)}>
                {v ? 'Sim' : 'Não'}
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <div className="control-head">
            <span className="control-label">Movimento</span>
          </div>
          <div className="segments" role="group" aria-label="Perfil de movimento">
            {profiles.map((p) => (
              <button key={p} className="segment" aria-pressed={p === motion} onClick={() => setMotion(p)}>
                {profileLabels[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <div className="control-head">
            <span className="control-label">Velocidade</span>
            <button className="text-button" onClick={() => setPaused(!paused)}>{paused ? "Tocar" : "Pausar"}</button>
          </div>
          <div className="segments" role="group" aria-label="Velocidade">
            {SPEEDS.map((v) => (
              <button key={v} className="segment" aria-pressed={v === speed} onClick={() => setSpeed(v)}>
                {v}×
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <div className="control-head">
            <span className="control-label">Uso</span>
            <span className="control-actions">
              <button
                className="text-button reset"
                aria-hidden={!changed}
                tabIndex={changed ? 0 : -1}
                onClick={reset}
              >
                Redefinir
              </button>
              <button className="text-button" onClick={() => copy('snippet', snippet)}>{copied === "snippet" ? "Copiado" : "Copiar"}</button>
            </span>
          </div>
          <Snippet lines={lines} />
        </div>
      </aside>

      <nav className="states" aria-label="Estado">
        {stateOrder.map((st) => (
          <button key={st} className="state" aria-pressed={st === state} onClick={() => setState(st)}>
            <span className="state-head">{bot(52, st, false)}</span>
            <span className="state-name">{title(STATES[st].label)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
