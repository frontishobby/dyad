/**
 * Keyboard input source (PLAN §2, §7).
 *
 * Maps KeyboardEvent.code to a pad key through the user's bindings and emits
 * the unified InputEvent with the DOM event's own `timeStamp`. The play shell
 * converts that timestamp with SongPlayer.hitMs() and judges immediately.
 *
 * Behaviour:
 * - `keydown` with `repeat` set is swallowed (still preventDefault-ed so a held
 *   bound key does not scroll or type), so one physical press = one `down`.
 * - Events whose target is editable (input, textarea, select, contenteditable)
 *   are left alone entirely so settings forms keep working while a source is
 *   attached.
 * - Chords with Ctrl / Meta / Alt are left to the browser (reload, devtools…)
 *   unless the bound key *is* that modifier. This also sidesteps the macOS
 *   quirk where keyups are not delivered while Cmd is held.
 * - Only bound keys are preventDefault-ed; unbound keys are untouched.
 * - Held state is tracked per key so every `down` is followed by exactly one
 *   `up`: orphan keyups (pressed before start(), or inside an editable) are
 *   dropped, and losing window focus (`blur`) releases everything still held.
 *   stop() flushes the same way before detaching, with performance.now() as the
 *   timestamp — those synthetic ups never drive judgement.
 * - Listeners run in the capture phase so UI handlers that stop propagation
 *   cannot swallow game input.
 */
import { KEYS, type Key } from '../core/types.ts';
import type { InputHandler, InputSource, KeyBindings } from './types.ts';

/** `<input type=…>` values that do not take text; game keys stay live on them. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'image',
  'hidden',
]);

/**
 * True when keyboard events aimed at `t` belong to a text-editing control
 * (input, textarea, select, contenteditable). Duck-typed so it also works on
 * minimal fakes outside a browser.
 */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (t === null || typeof t !== 'object') return false;
  const el = t as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = typeof el.type === 'string' && el.type !== '' ? el.type.toLowerCase() : 'text';
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

/**
 * Reverse lookup KeyboardEvent.code → Key. When the same code is bound to
 * several keys the first in KEYS order (KL, KR, DL, DR) wins; empty codes are
 * ignored so a blank binding can never match a key that reports `code === ''`.
 */
export function buildCodeMap(bindings: KeyBindings): ReadonlyMap<string, Key> {
  const map = new Map<string, Key>();
  for (const key of KEYS) {
    const code = bindings[key];
    if (typeof code !== 'string' || code === '' || map.has(code)) continue;
    map.set(code, key);
  }
  return map;
}

/** A modifier is "foreign" unless the pressed key is that modifier itself. */
function hasForeignModifier(e: KeyboardEvent): boolean {
  const code = typeof e.code === 'string' ? e.code : '';
  return (
    (e.ctrlKey === true && !code.startsWith('Control')) ||
    (e.metaKey === true && !code.startsWith('Meta')) ||
    (e.altKey === true && !code.startsWith('Alt'))
  );
}

const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true };

export function createKeyboardSource(bindings: KeyBindings, target: EventTarget = window): InputSource {
  const codeToKey = buildCodeMap(bindings);
  const held: Record<Key, boolean> = { KL: false, KR: false, DL: false, DR: false };
  let handler: InputHandler | null = null;

  function emit(key: Key, down: boolean, timeStamp: number): void {
    if (handler) handler({ key, down, timeStamp, source: 'keyboard' });
  }

  function releaseAll(timeStamp: number): void {
    for (const key of KEYS) {
      if (!held[key]) continue;
      held[key] = false;
      emit(key, false, timeStamp);
    }
  }

  function onKeyDown(ev: Event): void {
    const e = ev as KeyboardEvent;
    const key = codeToKey.get(e.code);
    if (key === undefined) return;
    if (hasForeignModifier(e)) return;
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    if (e.repeat) return;
    held[key] = true;
    emit(key, true, e.timeStamp);
  }

  function onKeyUp(ev: Event): void {
    const e = ev as KeyboardEvent;
    const key = codeToKey.get(e.code);
    if (key === undefined || !held[key]) return;
    // A held key is released wherever the keyup lands (focus may have moved
    // into a form while it was down), but typing controls keep their default.
    if (!isEditableTarget(e.target)) e.preventDefault();
    held[key] = false;
    emit(key, false, e.timeStamp);
  }

  function onBlur(ev: Event): void {
    releaseAll(ev.timeStamp);
  }

  function stop(): void {
    if (!handler) return;
    releaseAll(performance.now());
    target.removeEventListener('keydown', onKeyDown, LISTENER_OPTIONS);
    target.removeEventListener('keyup', onKeyUp, LISTENER_OPTIONS);
    target.removeEventListener('blur', onBlur, LISTENER_OPTIONS);
    handler = null;
  }

  function start(h: InputHandler): void {
    if (handler) stop();
    handler = h;
    target.addEventListener('keydown', onKeyDown, LISTENER_OPTIONS);
    target.addEventListener('keyup', onKeyUp, LISTENER_OPTIONS);
    target.addEventListener('blur', onBlur, LISTENER_OPTIONS);
  }

  return { start, stop };
}
