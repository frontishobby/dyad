/**
 * Display formatting shared by the shell screens (DESIGN §3).
 * Pure functions; no DOM.
 */

import { TIER_LABEL, type Tier } from './types.ts';

export const SCORE_MAX = 1_000_000;

/** Digit grouping without locale dependence: 987650 → "987,650". */
export function groupDigits(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const fromEnd = s.length - i;
    out += s[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return n < 0 ? `-${out}` : out;
}

/** Score as grouped digits, clamped to 0..1,000,000. The box it sits in is fixed width; the text is not padded. */
export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '0';
  return groupDigits(Math.round(Math.min(SCORE_MAX, Math.max(0, score))));
}

/** 0..1 → "98.12%". */
export function formatAccuracy(accuracy: number): string {
  const pct = Number.isFinite(accuracy) ? Math.min(1, Math.max(0, accuracy)) * 100 : 0;
  return `${pct.toFixed(2)}%`;
}

/** 1 → "1.0×". */
export function formatHiSpeed(v: number): string {
  return `${v.toFixed(1)}×`;
}

/** 0.8 → "80%". */
export function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** +12 → "+12 ms", -3 → "-3 ms", 0 → "0 ms". */
export function formatOffset(ms: number): string {
  const sign = ms > 0 ? '+' : '';
  return `${sign}${Math.round(ms)} ms`;
}

/** Tier tile text: easy → "EASY". */
export function tierLabel(tier: Tier): string {
  return TIER_LABEL[tier];
}

/**
 * Legacy mapping for charts that only carry an osu! Version string:
 * kantan/easy → easy, futsuu/normal → normal, everything else → hard.
 */
export function tierFromName(name: string): Tier {
  const n = name.trim().toLowerCase();
  if (n.includes('kantan') || n.includes('easy')) return 'easy';
  if (n.includes('futsuu') || n.includes('normal')) return 'normal';
  return 'hard';
}

/** 72800 → "1:13". */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** [150, 150] → "150", [140, 180] → "140–180". Fractional BPM keeps up to two decimals. */
export function formatBpm([min, max]: readonly [number, number]): string {
  const f = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''));
  return min === max ? f(min) : `${f(min)}–${f(max)}`;
}

const CODE_NAMES: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Escape: 'Esc',
  CapsLock: 'Caps lock',
  ShiftLeft: 'Shift (왼쪽)',
  ShiftRight: 'Shift (오른쪽)',
  ControlLeft: 'Ctrl (왼쪽)',
  ControlRight: 'Ctrl (오른쪽)',
  AltLeft: 'Alt (왼쪽)',
  AltRight: 'Alt (오른쪽)',
  MetaLeft: 'Meta (왼쪽)',
  MetaRight: 'Meta (오른쪽)',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  IntlBackslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page up',
  PageDown: 'Page down',
};

/** KeyboardEvent.code → short human label: KeyR → "R", Digit1 → "1", Numpad5 → "Num 5", F3 → "F3". */
export function prettyKeyCode(code: string): string {
  if (!code) return '—';
  const named = CODE_NAMES[code];
  if (named) return named;
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1] ?? code;
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1] ?? code;
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return `Num ${m[1]}`;
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  // Fallback: split camel case into words, sentence case.
  const words = code.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
