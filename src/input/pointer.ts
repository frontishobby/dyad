/**
 * Pointer (touch) input source (PLAN §2, §3, §7).
 *
 * Listens for pointer events on the stage element, maps the client position
 * to logical canvas coordinates with `toLogical`, hit-tests the 2×2 touch zones
 * and emits the unified InputEvent with the DOM event's own `timeStamp`.
 *
 * Behaviour:
 * - Each pointerId is bound to the key it landed on, so the matching
 *   pointerup / pointercancel / lostpointercapture releases that same key even
 *   when the finger slid off the zone. Release is idempotent: browsers fire
 *   `lostpointercapture` right after `pointerup`, and only the first one counts.
 * - Pointers that hit no zone are ignored (no capture, no events).
 * - Multi-touch: every pointer is independent; two fingers on one zone emit two
 *   downs and two ups (one per physical contact), which is what drumroll
 *   mashing needs.
 * - Every pointerdown is preventDefault-ed so the page never scrolls, zooms,
 *   selects text or shifts focus while touching the stage; a `contextmenu`
 *   listener stops the long-press menu on Android.
 * - `touch-action: none`, `user-select: none` (prefixed too) and
 *   `-webkit-touch-callout: none` are applied to the element on start() and the
 *   previous inline values restored on stop().
 * - stop() flushes an `up` for every pointer still down (timestamp
 *   performance.now(); never used for judgement) so consumers never see a
 *   stuck key.
 */
import { KEYS, type Key } from '../core/types.ts';
import type { InputHandler, InputSource, PointerSourceOptions, Rect } from './types.ts';

/** First zone (in KEYS order) containing the logical point, or null. Far edges are exclusive. */
export function hitTestZones(zones: Partial<Record<Key, Rect>>, x: number, y: number): Key | null {
  for (const key of KEYS) {
    const r = zones[key];
    if (r !== undefined && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return key;
  }
  return null;
}

interface SavedStyle {
  touchAction: string;
  userSelect: string;
  webkitUserSelect: string;
  /** null when the style object has no setProperty/getPropertyValue (fakes). */
  touchCallout: string | null;
}

const CALLOUT = '-webkit-touch-callout';

function applyStyle(style: CSSStyleDeclaration): SavedStyle {
  const saved: SavedStyle = {
    touchAction: style.touchAction ?? '',
    userSelect: style.userSelect ?? '',
    webkitUserSelect: style.webkitUserSelect ?? '',
    touchCallout: null,
  };
  style.touchAction = 'none';
  style.userSelect = 'none';
  style.webkitUserSelect = 'none';
  if (typeof style.setProperty === 'function' && typeof style.getPropertyValue === 'function') {
    saved.touchCallout = style.getPropertyValue(CALLOUT) ?? '';
    style.setProperty(CALLOUT, 'none');
  }
  return saved;
}

function restoreStyle(style: CSSStyleDeclaration, saved: SavedStyle): void {
  style.touchAction = saved.touchAction;
  style.userSelect = saved.userSelect;
  style.webkitUserSelect = saved.webkitUserSelect;
  if (saved.touchCallout === null) return;
  if (saved.touchCallout === '') {
    if (typeof style.removeProperty === 'function') style.removeProperty(CALLOUT);
  } else if (typeof style.setProperty === 'function') {
    style.setProperty(CALLOUT, saved.touchCallout);
  }
}

export function createPointerSource(opts: PointerSourceOptions): InputSource {
  const element = opts.element;
  /** pointerId → key it pressed. */
  const active = new Map<number, Key>();
  let handler: InputHandler | null = null;
  let saved: SavedStyle | null = null;

  function emit(key: Key, down: boolean, timeStamp: number): void {
    if (handler) handler({ key, down, timeStamp, source: 'touch' });
  }

  function release(pointerId: number, timeStamp: number): void {
    const key = active.get(pointerId);
    if (key === undefined) return;
    active.delete(pointerId);
    emit(key, false, timeStamp);
  }

  function capture(pointerId: number): void {
    if (typeof element.setPointerCapture !== 'function') return;
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone (InvalidStateError / NotFoundError); harmless.
    }
  }

  function onPointerDown(ev: Event): void {
    const e = ev as PointerEvent;
    e.preventDefault();
    // Secondary mouse / pen barrel buttons are not drum hits.
    if (typeof e.button === 'number' && e.button > 0) return;
    const p = opts.toLogical(e.clientX, e.clientY);
    const key = hitTestZones(opts.zones(), p.x, p.y);
    if (key === null) return;
    // A stale entry means we missed this pointer's up; close it out first.
    if (active.has(e.pointerId)) release(e.pointerId, e.timeStamp);
    active.set(e.pointerId, key);
    emit(key, true, e.timeStamp);
    capture(e.pointerId);
  }

  function onPointerUp(ev: Event): void {
    const e = ev as PointerEvent;
    release(e.pointerId, e.timeStamp);
  }

  function onContextMenu(ev: Event): void {
    ev.preventDefault();
  }

  function stop(): void {
    if (!handler) return;
    if (active.size > 0) {
      const now = performance.now();
      const pending = Array.from(active.values());
      active.clear();
      for (const key of pending) emit(key, false, now);
    }
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerUp);
    element.removeEventListener('lostpointercapture', onPointerUp);
    element.removeEventListener('contextmenu', onContextMenu);
    if (saved) restoreStyle(element.style, saved);
    saved = null;
    handler = null;
  }

  function start(h: InputHandler): void {
    if (handler) stop();
    handler = h;
    saved = applyStyle(element.style);
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('lostpointercapture', onPointerUp);
    element.addEventListener('contextmenu', onContextMenu);
  }

  return { start, stop };
}
