/**
 * Design tokens — the single source of colour, shape and type (DESIGN.md).
 * Svelte injects these as CSS custom properties via applyTheme(); the Pixi
 * renderer imports the same objects. Never write a hex literal anywhere else.
 */

export interface Theme {
  name: 'dark' | 'light';
  void: string;
  ground: string;
  surface: string;
  raised: string;
  line: string;
  text: string;
  textDim: string;
  textFaint: string;
  don: string;
  donInk: string;
  kat: string;
  katInk: string;
  onDon: string;
  onKat: string;
  flash: string;
  /** Jacket palette blend amount into ground for the play background. */
  tintAmount: number;
}

export const DARK: Theme = {
  name: 'dark',
  void: '#07070C',
  ground: '#12131F',
  surface: '#1A1B2B',
  raised: '#24263A',
  line: '#343651',
  text: '#EEEDF8',
  textDim: '#A2A3BE',
  textFaint: '#6C6E8A',
  don: '#FFB432',
  donInk: '#FFB432',
  kat: '#8FA0FF',
  katInk: '#8FA0FF',
  onDon: '#241600',
  onKat: '#0A0E33',
  flash: '#FFFFFF',
  tintAmount: 0.12,
};

export const LIGHT: Theme = {
  name: 'light',
  void: '#C6C5D3',
  ground: '#F6F5FB',
  surface: '#FFFFFF',
  raised: '#ECEBF4',
  line: '#D5D4E2',
  text: '#15152A',
  textDim: '#55566E',
  textFaint: '#80819A',
  don: '#F0A000',
  donInk: '#A66300',
  kat: '#7085FF',
  katInk: '#3D4ED0',
  onDon: '#241600',
  onKat: '#0A0E33',
  flash: '#FFFFFF',
  tintAmount: 0.06,
};

export const THEMES: Record<Theme['name'], Theme> = { dark: DARK, light: LIGHT };

/** Shape law (DESIGN §2). Ratios of the track width W, the lead distance, or the unit N. */
export const SHAPE = {
  /** Corner radius = shortest side × this (bricks: touch zones, bodies). */
  radius: 1 / 8,
  /** Unit N = W × this: spawn margin, judgement offsets, roll/spinner body thickness. */
  noteThickness: 1 / 16,
  /** Regular note diameter = lead distance (spawn edge → seam, px) × this. */
  circle: 0.07,
  /** Big note diameter = regular diameter × this. */
  bigCircle: 1.55,
  /** Seam ring stroke and burst outline stroke = regular diameter × this. */
  ringStroke: 0.06,
  /** Gate gap in units of N (the seam sits in the middle of the portrait gate rect). */
  gateGap: 1 / 8,
  /** Hit push toward the gate, in units of N. */
  hitPush: 0.5,
  /** Missed note keeps travelling this many N past the gate before vanishing. */
  missTravel: 2,
} as const;

/** Motion (DESIGN §5), ms. */
export const MOTION = {
  hitVanish: 90,
  cellDecay: 120,
  comboPulse: 160,
  /** Combo milestone (every 50): the bigger bump. */
  comboMilestone: 360,
  /** Hit burst: the note's outline grows out of the seam and fades over this. */
  burst: 240,
  /** Judgement word pops in over this, then holds and fades (track.ts JUDGEMENT_TEXT_MS). */
  judgementPop: 90,
  /** Beat pulse on the seam line and the band, decaying over this after each beat. */
  beatPulse: 220,
  /** Screen entrance in the shell (fade + rise). */
  screenIn: 260,
  /** Result screen: score count-up. */
  countUp: 900,
} as const;

/** Type scale (DESIGN §3), logical px. */
export const TYPE = {
  display: "'Unbounded Variable', 'Unbounded', 'Arial Black', sans-serif",
  body: "'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  size: { keyLabel: 12, caption: 14, body: 16, title: 20, combo: 28, judgement: 40, score: 64, hero: 96 },
} as const;

/**
 * Layout (DESIGN §4).
 *
 * Landscape is a FIXED 1280×720 logical stage, letterboxed and never upscaled.
 * Portrait is DYNAMIC: logical width 720, logical height = 720 × viewport
 * aspect (clamped), the canvas fills the viewport with no letterbox.
 */
export const LAYOUT = {
  portrait: {
    /** Logical width; height follows the viewport aspect. */
    width: 720,
    minHeight: 960,
    maxHeight: 1920,
    /** Song info strip, logical px (fixed, not a fraction: tall phones must not grow it). */
    infoPx: 112,
    /** Touch zones: this fraction of the logical height, but never under touchMinPx. */
    touch: 0.3,
    touchMinPx: 360,
    /** Track gutter on each side, logical px. */
    gutterPx: 40,
  },
  landscape: {
    width: 1280,
    height: 720,
    /** Track band height, logical px (W). */
    trackHeightPx: 320,
    /** Track band top, logical px: the band sits low so the jacket, title and score get the room above. */
    trackTopPx: 340,
    /** Judgement seam x as a fraction of the width. */
    gateX: 0.2,
  },
  /** Time from the spawn edge to the gate at hiSpeed 1, ms (hiSpeed divides it). */
  leadMs: { portrait: 1200, landscape: 1600 },
} as const;

// ─── helpers ────────────────────────────────────────────────────────────────

export function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = hexToNumber(hex);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Blend `amount` of `color` into `base` (sRGB, linear mix). */
export function tint(base: string, color: string, amount: number): string {
  const a = hexToRgb(base);
  const b = hexToRgb(color);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]);
}

/** Play background for a song: ground tinted by the jacket's first palette colour. */
export function playGround(theme: Theme, palette: readonly string[]): string {
  const first = palette[0];
  return first ? tint(theme.ground, first, theme.tintAmount) : theme.ground;
}

const CSS_VARS: Record<keyof Omit<Theme, 'name' | 'tintAmount'>, string> = {
  void: '--void',
  ground: '--ground',
  surface: '--surface',
  raised: '--raised',
  line: '--line',
  text: '--text',
  textDim: '--text-dim',
  textFaint: '--text-faint',
  don: '--don',
  donInk: '--don-ink',
  kat: '--kat',
  katInk: '--kat-ink',
  onDon: '--on-don',
  onKat: '--on-kat',
  flash: '--flash',
};

/** Inject a theme as CSS custom properties on <html>. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const key of Object.keys(CSS_VARS) as (keyof typeof CSS_VARS)[]) {
    root.style.setProperty(CSS_VARS[key], theme[key]);
  }
  root.style.setProperty('--font-display', TYPE.display);
  root.style.setProperty('--font-body', TYPE.body);
  root.dataset.theme = theme.name;
  root.style.colorScheme = theme.name;
}
