/**
 * Gamepad input source (PLAN §2, §7).
 *
 * The Gamepad API has no button events, so the play shell calls poll() once
 * per animation frame. poll() reads navigator.getGamepads() and edge-detects
 * each pad key: a key is down while ANY of its bound buttons on ANY connected
 * pad is pressed; `down` is emitted on the 0→1 edge and `up` on the 1→0 edge.
 * The timeStamp is performance.now() at poll time (one frame of latency,
 * accepted in PLAN §2).
 *
 * Robustness:
 * - null pad slots, pads reporting `connected === false`, short `buttons`
 *   arrays and a missing or throwing navigator.getGamepads() are all
 *   tolerated. A throwing getGamepads (permissions policy) disables polling
 *   for good and releases anything held.
 * - gamepadconnected / gamepaddisconnected trigger an immediate re-scan with
 *   the event's timeStamp, so a key held only through a pad that just vanished
 *   is released right away (even when the frame loop is paused), while keys
 *   still pressed on a remaining pad stay down without spurious re-triggers.
 * - stop() flushes an `up` for anything still held (timestamp performance.now();
 *   never used for judgement).
 * - A key is pressed when `GamepadButton.pressed` is true or, for analog
 *   triggers whose `pressed` threshold differs across browsers, `value > 0.5`.
 */
import { KEYS, type Key } from '../core/types.ts';
import { DEFAULT_GAMEPAD_BINDINGS, type GamepadBindings, type GamepadSource, type InputHandler } from './types.ts';

export interface GamepadSourceOptions {
  /**
   * Source of pads. Defaults to navigator.getGamepads when present; when
   * absent (or explicitly null) poll() is a no-op.
   */
  getGamepads?: (() => ArrayLike<Gamepad | null> | null | undefined) | null;
  /** Where gamepadconnected/gamepaddisconnected are observed. Defaults to window when it exists. */
  target?: EventTarget | null;
  /** Clock used for poll timestamps. Defaults to performance.now(). */
  now?: () => number;
}

const ANALOG_PRESS_THRESHOLD = 0.5;

function isPressed(b: GamepadButton): boolean {
  return b.pressed === true || (typeof b.value === 'number' && b.value > ANALOG_PRESS_THRESHOLD);
}

function defaultGetGamepads(): (() => ArrayLike<Gamepad | null> | null | undefined) | null {
  const nav: Navigator | undefined = globalThis.navigator;
  if (nav && typeof nav.getGamepads === 'function') return () => nav.getGamepads();
  return null;
}

function defaultTarget(): EventTarget | null {
  return typeof window !== 'undefined' ? window : null;
}

export function createGamepadSource(
  bindings: GamepadBindings = DEFAULT_GAMEPAD_BINDINGS,
  options: GamepadSourceOptions = {},
): GamepadSource {
  const getGamepads = options.getGamepads === undefined ? defaultGetGamepads() : options.getGamepads;
  const target = options.target === undefined ? defaultTarget() : options.target;
  const now = options.now ?? (() => performance.now());
  // Defensive copies: later mutation of the caller's arrays must not change behaviour mid-play.
  const buttons: Record<Key, readonly number[]> = {
    KL: [...bindings.KL],
    KR: [...bindings.KR],
    DL: [...bindings.DL],
    DR: [...bindings.DR],
  };
  const held: Record<Key, boolean> = { KL: false, KR: false, DL: false, DR: false };
  let handler: InputHandler | null = null;
  let unavailable = getGamepads === null;

  function emit(key: Key, down: boolean, timeStamp: number): void {
    if (handler) handler({ key, down, timeStamp, source: 'gamepad' });
  }

  function readPads(): ArrayLike<Gamepad | null> | null {
    if (unavailable || getGamepads === null) return null;
    try {
      return getGamepads() ?? null;
    } catch {
      unavailable = true;
      return null;
    }
  }

  function anyPressed(pads: ArrayLike<Gamepad | null>, indices: readonly number[]): boolean {
    for (let p = 0; p < pads.length; p++) {
      const pad = pads[p];
      if (!pad || pad.connected === false) continue;
      const list = pad.buttons;
      if (!list) continue;
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (idx === undefined) continue;
        const b = list[idx];
        if (b !== undefined && b !== null && isPressed(b)) return true;
      }
    }
    return false;
  }

  /** Recompute every key against the current pads and emit edges. */
  function scan(timeStamp: number): void {
    const pads = readPads();
    for (const key of KEYS) {
      const pressed = pads !== null && anyPressed(pads, buttons[key]);
      if (pressed === held[key]) continue;
      held[key] = pressed;
      emit(key, pressed, timeStamp);
    }
  }

  function releaseAll(timeStamp: number): void {
    for (const key of KEYS) {
      if (!held[key]) continue;
      held[key] = false;
      emit(key, false, timeStamp);
    }
  }

  function onPadsChanged(ev: Event): void {
    const ts = typeof ev.timeStamp === 'number' && Number.isFinite(ev.timeStamp) ? ev.timeStamp : now();
    scan(ts);
  }

  function poll(): void {
    if (!handler) return;
    scan(now());
  }

  function stop(): void {
    if (!handler) return;
    releaseAll(now());
    if (target) {
      target.removeEventListener('gamepadconnected', onPadsChanged);
      target.removeEventListener('gamepaddisconnected', onPadsChanged);
    }
    handler = null;
  }

  function start(h: InputHandler): void {
    if (handler) stop();
    handler = h;
    if (target) {
      target.addEventListener('gamepadconnected', onPadsChanged);
      target.addEventListener('gamepaddisconnected', onPadsChanged);
    }
  }

  return { start, stop, poll };
}
