/**
 * Key labels for the gate cells (DESIGN §2: "R U / F J" in text-faint).
 * KeyboardEvent.code → something short enough for a 12px label.
 */
import { KEYS, type Key } from '../../core/types.ts';
import type { KeyBindings } from '../../input/types.ts';

const NAMED: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Bksp',
  Escape: 'Esc',
  CapsLock: 'Caps',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  MetaLeft: 'Meta',
  MetaRight: 'Meta',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  IntlBackslash: '\\',
  IntlRo: 'ろ',
  IntlYen: '¥',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadDecimal: '.',
};

export function prettyKeyCode(code: string): string {
  if (code === '') return '';
  const named = NAMED[code];
  if (named !== undefined) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

export function prettyBindings(bindings: KeyBindings): Record<Key, string> {
  const out = {} as Record<Key, string>;
  for (const key of KEYS) out[key] = prettyKeyCode(bindings[key] ?? '');
  return out;
}
