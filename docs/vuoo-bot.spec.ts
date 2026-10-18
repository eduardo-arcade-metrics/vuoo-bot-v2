/**
 * VUOO Bot — especificação de forma, estados e comportamentos
 * ------------------------------------------------------------
 * Referência para adaptar o pacote `robot-heads` (React + canvas 2D)
 * ao personagem do VUOO. Fonte visual: playground vuoo-bot.html.
 *
 * Status: rascunho (VUOO-00 §9). Requisitos aplicados:
 *   ACC-MOV-001  movimento desativável, informação sem depender de movimento
 *   ACC-PER-001  preferências por perfil, persistentes
 *   ACC-PER-002  todo artefato declara comportamento em cada perfil
 *
 * Mapa robot-heads → VUOO Bot
 *   shape         → novo valor "vuoo" (cápsula da marca); os outros podem sair
 *   state         → VuooState (abaixo); todos os do repo, com nomes do VUOO
 *   color         → carcaca (carcaça)
 *   trimColor     → atomo (a esfera solta, antes chamada de antena)
 *   screenColor   → tela (cor dos LEDs; o estado de erro a troca por vermelho)
 *   speed/paused  → iguais
 *   interactive   → mantido; obrigatório para "espelhar"
 *   (novo) motion → perfil de movimento: "completo" | "reduzido" | "minimo"
 *   (novo) effects→ brilho e confete (carga sensorial)
 */

/* ============================================================
 * 1. FORMA
 * Todas as medidas são relativas a S = lado da caixa (prop `size`).
 * ============================================================ */

export const GEOMETRY = {
  /** Centro da cabeça na caixa */
  center: { x: 0.5, y: 0.56 },           // × S
  /** Cabeça: cápsula (retângulo de cantos quase semicirculares) */
  head: {
    width: 0.66,                          // × S  → W
    height: 0.42,                         // × S  → H
    radius: 0.47,                         // × H  (quase pílula, como o logo)
    depth: 0.065,                         // × S  extrusão lateral (pseudo-3D)
    yawSquash: 0.16,                      // largura frontal × (1 − |yaw| × 0.16)
  },
  /** Tela escura dentro da carcaça */
  screen: {
    inset: 0.15,                          // × H  margem da carcaça até a tela
    bevel: 0.28,                          // × inset  moldura rebaixada (trim)
    gradient: ["#2C2926", "#141211"],     // topo → base
    ledGrid: { step: 0.05, dotAlpha: 0.055 }, // × H; matriz de LED sutil
    glare: 0.09,                          // alpha do reflexo diagonal
  },
  /** Olhos: os dois "o" da marca, anéis grossos */
  eyes: {
    radius: 0.15,                         // × H  → r
    ovalY: 1.1,                           // altura = r × 1.1
    stroke: 0.62,                         // × r  espessura do anel
    gap: 1.45,                            // × r  distância do centro a cada olho
    offsetY: -0.15,                       // × r
    glow: 1.1,                            // × r  blur (só com effects)
    gazeRange: { x: 0.13, y: 0.10 },      // × H  deslocamento máximo do olhar
  },
  /** Átomo: o ponto do logo, solto no canto superior direito */
  orbit: {
    anchor: { x: 0.5, y: -0.76 },         // x × W, y × H, relativo ao centro
    radius: 0.085,                        // × H
    glowRadius: 4,                        // × radius
    color: "#F6F0E4",
  },
  floorShadow: { y: 0.9, width: 0.5, squashY: 0.16 }, // × S, × W
} as const;

/** Paleta da marca e padrões */
export const COLORS = {
  shell: { creme: "#EFE8DA", laranja: "#FF7A21", carvao: "#3B3835", menta: "#8FD3B6", lavanda: "#B8A9E6", ceu: "#8EC5F2" },
  /** Sombreamento da carcaça: mistura com branco (+) ou preto (−) */
  shading: { top: +0.22, bottom: -0.12, sideNear: -0.28, sideFar: -0.42, bevel: -0.22 },
  defaults: { shell: "#EFE8DA", atomo: "#F6F0E4", tela: "#FF7A21" },
} as const;

/* ============================================================
 * 2. PERFIS DE MOVIMENTO (VUOO-00 §8)
 * amp multiplica toda oscilação. Pose fixa vale em todos os perfis.
 * ============================================================ */

export type MotionProfile = "completo" | "reduzido" | "minimo";

export const MOTION: Record<MotionProfile, {
  amp: number; hops: boolean; particles: boolean; blink: boolean; tween: boolean;
}> = {
  completo: { amp: 1,    hops: true,  particles: true,  blink: true,  tween: true  },
  reduzido: { amp: 0.35, hops: false, particles: false, blink: true,  tween: true  },
  minimo:   { amp: 0,    hops: false, particles: false, blink: false, tween: false },
};

/** Sem preferência salva no perfil do estudante:
 *  prefers-reduced-motion: reduce → "minimo"; caso contrário → "completo". */
export const MOTION_DEFAULT_FROM_SYSTEM = { reduce: "minimo", noPreference: "completo" } as const;

/** Troca de estado: piscada de 0,24 s (fecha → troca o rosto → abre).
 *  Pose interpola com fator 1 − e^(−dt·9). No perfil mínimo, troca instantânea.
 *  Átomo e tela mudam de cor em 0,3 s. */
export const TRANSITION = { blinkSwap: 0.24, easeRate: 9, colorSeconds: 0.3 } as const;

/* ============================================================
 * 3. ESTADOS
 * ============================================================ */

export type VuooState =
  // estados de base
  | "ocioso" | "atento" | "pensando" | "encorajar" | "descansar"
  | "buscar" | "falar" | "trabalhar" | "erro" | "acerto" | "orbita" | "brincar" | "pergunta" | "orbitaExpandida" | "chamarFaiscas"
  // comportamentos adaptativos (projeto, F3.1)
  | "espelhar" | "provocar" | "celebrar" | "euforia" | "recuar";

export type EyeShape =
  | "ring"    // anel completo (o da marca)
  | "happy"   // arco superior ∩
  | "smile"   // anel aberto embaixo (olhos sorrindo)
  | "lid"     // metade inferior + pálpebra reta (cansado, recolhido)
  | "closed"  // arco inferior fino ‿
  | "flat"    // anel achatado, olhando para baixo (trabalhando)
  | "cross"   // X (erro)
  | "wink";   // um olho em "happy" por 0,45 s

export interface StateSpec {
  label: string;
  group: "base" | "adaptativo";
  /** equivalente no robot-heads, quando houver */
  robotHeads: string | null;
  description: string;
  face: {
    eyes: EyeShape;
    eyeScale: number;
    mouth: null | "smile" | "big" | "talk" | "flat";
    extra: null | "dots" | "zzz" | "arrows" | "beam" | "equalizer" | "progress";
  };
  /** cor da tela no estado, quando diferente da cor escolhida (erro: vermelho) */
  screen?: string;
  /** pose fixa (radianos; frações de S/H). Aplica-se em todos os perfis */
  pose: Partial<{ yaw: number; pitch: number; roll: number; scale: number; y: number; gazeX: number; gazeY: number; dim: number }>;
  /** oscilação; multiplicada por MOTION[perfil].amp */
  motion: string;
  orbit: { glow: string; alpha: number | "pulse"; behavior: string };
  /** comportamento declarado por perfil (ACC-PER-002) */
  profiles: Record<MotionProfile, string>;
}

export const STATES: Record<VuooState, StateSpec> = {
  ocioso: {
    label: "Ocioso", group: "base", robotHeads: "idle",
    description: "Pisca, olha em volta e espera com calma.",
    face: { eyes: "ring", eyeScale: 1, mouth: null, extra: null },
    pose: {},
    motion: "olha em volta a cada 1,4–4 s; flutua 0,012S·sin(1,7t); pulinho, às vezes com giro, a cada 7–14 s (só completo). Segue o ponteiro de leve.",
    orbit: { glow: "#F6F0E4", alpha: 0.35, behavior: "flutua 0,05H" },
    profiles: {
      completo: "Flutua, olha em volta e dá pulinhos de vez em quando.",
      reduzido: "Flutua devagar e pisca, sem pulos.",
      minimo:   "Parado, de olhos abertos.",
    },
  },
  atento: {
    label: "Atento", group: "base", robotHeads: "listening",
    description: "Inclina a cabeça e acompanha a criança.",
    face: { eyes: "ring", eyeScale: 1.12, mouth: null, extra: "equalizer" },
    pose: { roll: 0.09, scale: 1.03, pitch: 0.04, gazeY: 0.05 },
    motion: "aceno: pitch + 0,05·max(0, sin(2,2t)); barras de equalizador acompanham a voz.",
    orbit: { glow: "#FF7A21", alpha: 0.75, behavior: "luz estável" },
    profiles: {
      completo: "Cabeça inclinada, acenos leves e olhos maiores.",
      reduzido: "Cabeça inclinada, acenos curtos.",
      minimo:   "Cabeça inclinada e olhos maiores, parado.",
    },
  },
  pensando: {
    label: "Pensando", group: "base", robotHeads: "thinking",
    description: "Olha para cima enquanto prepara a próxima atividade.",
    face: { eyes: "ring", eyeScale: 0.9, mouth: null, extra: "dots" },
    pose: { yaw: 0.24, pitch: 0.17, roll: -0.13 },
    motion: "vira e inclina para um lado, alternando a cada 3,5 s; três pontos pulsam em sequência.",
    orbit: { glow: "#FFC24A", alpha: "pulse", behavior: "pulsa âmbar (fixo no mínimo)" },
    profiles: {
      completo: "Olha para cima, alterna os lados, três pontos pulsando.",
      reduzido: "Olha para cima, pontos pulsando devagar.",
      minimo:   "Olhar para cima e três pontos fixos na tela.",
    },
  },
  encorajar: {
    label: "Encorajar", group: "base", robotHeads: null,
    description: "Depois de um erro, inclina a cabeça e sorri: vamos de novo.",
    face: { eyes: "smile", eyeScale: 1, mouth: "smile", extra: null },
    pose: { roll: -0.1, pitch: 0.02, gazeY: 0.1 },
    motion: "aceno lento: pitch 0,05·sin(1,4t). Sem cor de alerta, sem tremer a cabeça.",
    orbit: { glow: "#FF9F5A", alpha: "pulse", behavior: "brilho quente lento" },
    profiles: {
      completo: "Inclina a cabeça, sorri e acena devagar.",
      reduzido: "Inclina a cabeça e sorri, aceno curto.",
      minimo:   "Cabeça inclinada e sorriso fixos.",
    },
  },
  descansar: {
    label: "Descansar", group: "base", robotHeads: "sleeping",
    description: "Fecha os olhos durante uma pausa.",
    face: { eyes: "closed", eyeScale: 1, mouth: null, extra: "zzz" },
    pose: { pitch: -0.14, y: 0.03, gazeY: 0.25 },
    motion: "respiração: escala 1 + 0,012·sin(0,8t); letras z sobem e somem.",
    orbit: { glow: "#6E6862", alpha: 0, behavior: "apagada, mais perto da cabeça (0,42W, −0,62H)" },
    profiles: {
      completo: "Cabeça baixa, respiração lenta e letras “z” subindo.",
      reduzido: "Cabeça baixa e respiração lenta, “z” parado.",
      minimo:   "Olhos fechados e “z” fixo.",
    },
  },
  buscar: {
    label: "Buscando", group: "base", robotHeads: "searching",
    description: "Procura algo: o olhar e a cabeça varrem de um lado a outro, com um feixe na tela.",
    face: { eyes: "ring", eyeScale: 1, mouth: null, extra: "beam" },
    pose: {},
    motion: "cabeça balança ±0,55 rad com sin(1,6t); olhos vão na frente; feixe varre a tela de um lado a outro.",
    orbit: { glow: "#5ADCFF", alpha: 0.75, behavior: "pulsa ciano no ritmo do feixe" },
    profiles: {
      completo: "Vira a cabeça de um lado a outro e varre a tela com um feixe.",
      reduzido: "Só o feixe varre a tela, com a cabeça quase parada.",
      minimo:   "Feixe fixo no meio da tela.",
    },
  },
  falar: {
    label: "Falando", group: "base", robotHeads: "speaking",
    description: "Fala com a criança: a boca se mexe acompanhando as palavras.",
    face: { eyes: "ring", eyeScale: 1, mouth: "talk", extra: null },
    pose: { gazeY: -0.25 },
    motion: "cabeça balança devagar; a inclinação pulsa com a fala; barras da boca sobem e descem.",
    orbit: { glow: "#FFFAF0", alpha: "pulse", behavior: "pulsa com a fala" },
    profiles: {
      completo: "Cabeça balança e a boca se mexe com as palavras.",
      reduzido: "A boca se mexe, a cabeça quase parada.",
      minimo:   "Boca meio aberta, parada.",
    },
  },
  trabalhar: {
    label: "Trabalhando", group: "base", robotHeads: "working",
    description: "Concentrado numa tarefa: cabeça baixa e uma barra de progresso enchendo.",
    face: { eyes: "flat", eyeScale: 1, mouth: null, extra: "progress" },
    pose: { pitch: -0.16, gazeY: 0.5 },
    motion: "cabeça baixa com balanço leve; barra enche em 2,6 s; pulinho com giro a cada 5–8 s (só completo).",
    orbit: { glow: "#6E9BFF", alpha: "pulse", behavior: "pulsa azul no ritmo da barra" },
    profiles: {
      completo: "Cabeça baixa, pulinho de vez em quando e a barra enchendo.",
      reduzido: "Cabeça baixa e a barra enchendo devagar.",
      minimo:   "Cabeça baixa e a barra parada na metade.",
    },
  },
  erro: {
    label: "Erro", group: "base", robotHeads: "error",
    description: "Algo não deu certo: sacode a cabeça e mostra um X vermelho na tela.",
    face: { eyes: "cross", eyeScale: 1, mouth: "flat", extra: null },
    screen: "#FF4640",
    pose: { pitch: -0.06, roll: -0.05 },
    motion: "sacode a cabeça a cada 2,4 s; a luz do átomo e da tela piscam em vermelho.",
    orbit: { glow: "#FF3B30", alpha: "pulse", behavior: "pisca vermelho" },
    profiles: {
      completo: "Sacode a cabeça de vez em quando, com o X vermelho nos olhos.",
      reduzido: "Sacode a cabeça devagar, com o X vermelho.",
      minimo:   "Parado, com o X vermelho na tela.",
    },
  },
  acerto: {
    label: "Acerto", group: "base", robotHeads: null,
    description: "Deu certo: a cabeça pula de leve e a tela fica verde.",
    face: { eyes: "happy", eyeScale: 1, mouth: "smile", extra: null },
    screen: "#4DFF8A",
    pose: { pitch: 0.04 },
    motion: "pulinho leve a cada 1,6 s e balanço da cabeça; tela e átomo em verde.",
    orbit: { glow: "#4DFF8A", alpha: "pulse", behavior: "pulsa verde" },
    profiles: {
      completo: "Pula de leve e balança a cabeça, com a tela verde.",
      reduzido: "Balança a cabeça devagar, com a tela verde.",
      minimo:   "Olhos felizes e tela verde, parado.",
    },
  },
  orbita: {
    label: "Órbita", group: "adaptativo", robotHeads: null,
    description: "O átomo se multiplica e gira em volta da cabeça como elétrons; depois se recolhe nele.",
    face: { eyes: "ring", eyeScale: 1, mouth: null, extra: null },
    pose: { pitch: -0.1, gazeY: -0.5 },
    motion: "o átomo se multiplica em 8 cópias (6 nos outros perfis) que saem dele, giram em volta da cabeça e voltam a se esconder nele; ciclo de 5,5 s.",
    orbit: { glow: "#FFB24A", alpha: 0.6, behavior: "multiplica-se em órbita e se recolhe" },
    profiles: {
      completo: "O átomo se multiplica em oito e gira em volta da cabeça como elétrons; depois se recolhe nele.",
      reduzido: "Seis cópias do átomo giram devagar em volta da cabeça.",
      minimo:   "Seis cópias do átomo paradas em volta da cabeça.",
    },
  },
  espelhar: {
    label: "Espelhar", group: "adaptativo", robotHeads: null,
    description: "Acompanha o movimento da criança com o olhar e a cabeça.",
    face: { eyes: "ring", eyeScale: 1, mouth: null, extra: null },
    pose: {},
    motion: "olhar = ponteiro (x 0,8, y 0,6); cabeça yaw 0,38·dx, pitch −0,15·dy (só completo). Sem ponteiro: balanço 0,3·sin(0,9t).",
    orbit: { glow: "#8FE3C2", alpha: 0.75, behavior: "desloca 0,12W para o lado do ponteiro" },
    profiles: {
      completo: "Cabeça e olhos seguem o ponteiro ou o toque.",
      reduzido: "Só os olhos seguem, com amplitude menor.",
      minimo:   "Os olhos apontam para o lado do toque (esquerda, centro, direita), sem transição.",
    },
  },
  provocar: {
    label: "Provocar", group: "adaptativo", robotHeads: null,
    description: "Olha para a atividade e convida a criança a agir.",
    face: { eyes: "ring", eyeScale: 0.86, mouth: null, extra: "arrows" },
    pose: { yaw: 0.22, roll: -0.03, gazeX: 0.1 },
    motion: "impulso para o lado da atividade a cada 1,8 s (0,035S); piscadela a cada 2,6 s; setas › › acendem em sequência.",
    orbit: { glow: "#FF7A21", alpha: 0.75, behavior: "dispara para o lado e volta junto com o impulso" },
    profiles: {
      completo: "Vira para a atividade, dá um impulso e pisca um olho.",
      reduzido: "Vira para a atividade e se inclina de leve; setas fixas.",
      minimo:   "Virado para a atividade, com setas fixas na tela.",
    },
  },
  celebrar: {
    label: "Celebrar", group: "adaptativo", robotHeads: "happy",
    description: "Comemora a conquista com saltos e confete.",
    face: { eyes: "happy", eyeScale: 1, mouth: "big", extra: null },
    pose: {},
    motion: "saltos 0,085S·|sin(3,4t)| com achatamento ao pousar; roll 0,09·sin(3,4t); confete (completo + effects).",
    orbit: { glow: "#FFD34D", alpha: 0.75, behavior: "gira em volta da cabeça (raio 0,66W × 0,36H), passa por trás" },
    profiles: {
      completo: "Salta, a órbita gira em volta e solta confete.",
      reduzido: "Rosto feliz e balanço leve, sem confete.",
      minimo:   "Rosto feliz e sorriso fixos.",
    },
  },
  brincar: {
    label: "Brincar", group: "adaptativo", robotHeads: null,
    description: "Solta o átomo, que quica na frente do rosto; o bot segue a bolinha com os olhos.",
    face: { eyes: "ring", eyeScale: 1, mouth: "smile", extra: null },
    pose: {},
    motion: "o átomo sai e quica em trajetória irregular na frente do rosto; olhos e cabeça seguem a posição dele.",
    orbit: { glow: "#8FE3C2", alpha: 0.75, behavior: "quica na frente do rosto" },
    profiles: {
      completo: "Quica o átomo na frente do rosto e segue a bolinha com os olhos.",
      reduzido: "Quica devagar, com amplitude menor; os olhos seguem.",
      minimo:   "Átomo parado na frente do rosto, com os olhos voltados para ele.",
    },
  },
  pergunta: {
    label: "Pergunta", group: "adaptativo", robotHeads: null,
    description: "O átomo fica parado perto do rosto, e o bot olha alternadamente para ele e para você.",
    face: { eyes: "ring", eyeScale: 1, mouth: null, extra: null },
    pose: { roll: -0.05 },
    motion: "átomo parado perto do canto do rosto, pulsando devagar; a cada 2,2 s os olhos trocam entre o átomo e o usuário (ponteiro, ou à frente).",
    orbit: { glow: "#9FD8FF", alpha: "pulse", behavior: "pulsa devagar perto do rosto" },
    profiles: {
      completo: "O átomo pulsa perto do rosto, e os olhos alternam entre ele e você.",
      reduzido: "Olhos alternam entre o átomo e você, sem pulsar.",
      minimo:   "Átomo parado perto do rosto, olhos voltados para ele.",
    },
  },
  euforia: {
    label: "Euforia", group: "adaptativo", robotHeads: null,
    description: "Explode de alegria: bolinhas de confete voam para todos os lados.",
    face: { eyes: "happy", eyeScale: 1, mouth: "big", extra: null },
    pose: {},
    motion: "explosões de confete a cada 1,1 s, em bolinhas para todos os lados, com um pulinho a cada explosão (confete só com effects e no perfil completo).",
    orbit: { glow: "#FFD34D", alpha: 0.75, behavior: "gira em volta da cabeça" },
    profiles: {
      completo: "Explode de alegria: bolinhas de confete voam para todos os lados, com pulinhos.",
      reduzido: "Rosto feliz e balanço leve, sem confete.",
      minimo:   "Rosto feliz e sorriso fixos.",
    },
  },
  orbitaExpandida: {
    label: "Órbita expandida", group: "adaptativo", robotHeads: null,
    description: "O átomo e as faíscas giram num anel bem maior, que passa além da caixa do bot.",
    face: { eyes: "ring", eyeScale: 1, mouth: null, extra: null },
    pose: { pitch: -0.1, gazeY: -0.5 },
    motion: "anel 1,75× maior que o da Órbita; o átomo e as faíscas giram por toda a tela, desenhados na camada da página.",
    orbit: { glow: "#FFB24A", alpha: 0.6, behavior: "gira num anel amplo, além da caixa" },
    profiles: {
      completo: "O átomo e as faíscas giram num anel bem maior, além do bot.",
      reduzido: "Anel maior, com giro devagar.",
      minimo:   "Átomo e faíscas paradas num anel maior.",
    },
  },
  chamarFaiscas: {
    label: "Chamar faíscas", group: "adaptativo", robotHeads: null,
    description: "As faíscas saem do logo, no canto, voam até o bot e giram em volta dele.",
    face: { eyes: "ring", eyeScale: 1, mouth: "smile", extra: null },
    pose: { roll: -0.04, gazeY: -0.3 },
    motion: "as faíscas saem do logo, voam até o anel, giram e voltam ao logo; ciclo de 5,5 s, na camada da página.",
    orbit: { glow: "#FFD34D", alpha: 0.75, behavior: "faíscas voam do logo" },
    profiles: {
      completo: "Chama as faíscas do logo: elas voam, giram em volta do bot e voltam.",
      reduzido: "As faíscas vêm do logo e giram devagar.",
      minimo:   "Faíscas paradas em volta do bot.",
    },
  },
  recuar: {
    label: "Recuar", group: "adaptativo", robotHeads: null,
    description: "Diminui, escurece a tela e dá espaço quando há sobrecarga.",
    face: { eyes: "lid", eyeScale: 0.9, mouth: null, extra: null },
    pose: { scale: 0.82, y: -0.035, pitch: -0.04, gazeY: 0.15, dim: 0.55 },
    motion: "respiração mínima: escala ± 0,008·sin(0,8t). Nenhum outro movimento.",
    orbit: { glow: "#8C857C", alpha: 0.2, behavior: "esmaecida, perto da cabeça (0,38W, −0,62H)" },
    profiles: {
      completo: "Encolhe, se afasta e escurece a tela; respiração lenta.",
      reduzido: "Encolhe e escurece a tela; respiração mínima.",
      minimo:   "Menor e com a tela escura, parado.",
    },
  },
};

/** Piscar: estados que piscam (perfis completo e reduzido), a cada 2,4–5,6 s, 0,18 s de duração. */
export const BLINK_STATES: VuooState[] = ["ocioso", "atento", "pensando", "encorajar", "espelhar", "provocar", "buscar", "falar", "trabalhar"];

/** Toque na cabeça (interactive): pulinho com giro de 0,9 s e rosto "happy". Desligado no perfil mínimo. */
export const TAP_REACTION = { duration: 0.9, hop: 0.24, face: "happy" } as const;

/* ============================================================
 * 4. PROPS SUGERIDAS (adaptação da API do robot-heads)
 * ============================================================ */

export interface VuooBotProps {
  estado?: VuooState;          // default "ocioso"
  movimento?: MotionProfile;   // default: perfil do estudante, senão o do sistema
  efeitos?: boolean;           // default true
  orbita?: boolean;            // default true
  carcaca?: string;            // default COLORS.defaults.shell
  atomo?: string;              // default COLORS.defaults.atomo
  tela?: string;               // default COLORS.defaults.tela
  size?: number;               // px
  speed?: number;              // multiplicador
  paused?: boolean;
  interactive?: boolean;       // default true
  seed?: number;               // 0–1, dessincroniza bots lado a lado
  /** aria-label gerado: "VUOO Bot, {label}: {description}" (role="img"),
   *  e anúncio em região aria-live ao trocar de estado. */
}
