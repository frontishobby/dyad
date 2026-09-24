/**
 * Input contracts (PLAN §2, §7).
 *
 * Every source emits the same event. `timeStamp` is the DOM event's own
 * timeStamp (performance clock) — never performance.now() read later, and never
 * anything read inside requestAnimationFrame. The play shell converts it with
 * SongPlayer.hitMs() and calls Engine.hit() immediately in the handler.
 * Gamepad is polled per frame, so its timeStamp is performance.now() at poll
 * time (one frame of latency, accepted in PLAN).
 */
import type { Key } from '../core/types.ts';

export type InputSourceKind = 'keyboard' | 'touch' | 'gamepad';

export interface InputEvent {
  key: Key;
  down: boolean;
  /** performance-clock ms. */
  timeStamp: number;
  source: InputSourceKind;
}

export type InputHandler = (e: InputEvent) => void;

export interface InputSource {
  start(handler: InputHandler): void;
  stop(): void;
}

/** KeyboardEvent.code per key. Default Z X M , : left hand Z (kat) X (don), right hand M (don) , (kat). */
export type KeyBindings = Record<Key, string>;

export const DEFAULT_BINDINGS: KeyBindings = { KL: 'KeyZ', KR: 'Comma', DL: 'KeyX', DR: 'KeyM' };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pointer (touch) source. Zones are rectangles in logical canvas coordinates;
 * `toLogical` maps client coordinates onto them (letterboxed stage).
 * Multi-touch: each pointerId maps to at most one key; pointerdown → down,
 * pointerup/cancel → up. Must set touch-action: none on the element.
 */
export interface PointerSourceOptions {
  element: HTMLElement;
  toLogical(clientX: number, clientY: number): { x: number; y: number };
  zones(): Partial<Record<Key, Rect>>;
}

/** Gamepad: buttons per key by index; polled from requestAnimationFrame via poll(). */
export interface GamepadBindings {
  KL: number[];
  KR: number[];
  DL: number[];
  DR: number[];
}

export const DEFAULT_GAMEPAD_BINDINGS: GamepadBindings = {
  KL: [4, 6, 14], // LB, LT, dpad-left
  KR: [5, 7, 1], // RB, RT, B
  DL: [2, 12], // X, dpad-up
  DR: [0, 3], // A, Y
};

export interface GamepadSource extends InputSource {
  /** Call once per animation frame while active. */
  poll(): void;
}
