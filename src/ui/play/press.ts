/**
 * The press handler — PLAN §7 / §13, the rule that must never break:
 *
 *   an input event is judged synchronously, inside the DOM event, with the
 *   event's own timeStamp converted to the song clock. Nothing about a press
 *   waits for requestAnimationFrame.
 *
 * Kept as a pure factory over an interface so the ordering can be tested with
 * fakes (tests/ui/loop.test.ts checks that a press is judged before the next
 * frame runs).
 */
import { keyKind, type EngineEvent, type Key, type NoteKind } from '../../core/types.ts';
import type { InputEvent, InputHandler } from '../../input/types.ts';

export interface PressCollaborators {
  player: { hitMs(timeStamp: number): number };
  engine: { hit(key: Key, hitMs: number): EngineEvent[] };
  renderer: {
    press(key: Key, down: boolean): void;
    apply(events: readonly EngineEvent[], songMs: number): void;
  };
  hitSounds: { play(kind: NoteKind, big?: boolean): void };
  hud: { noteEvents(events: readonly EngineEvent[]): void };
  /** Read live so a settings change between presses is honoured. */
  inputOffset(): number;
  /** False while loading, paused, counting in or finishing: presses light the gate but are not judged. */
  isPlaying(): boolean;
}

/** A press "landed big" when it judged a big note (not a miss) or completed one with the second hand. */
export function isBigHit(events: readonly EngineEvent[]): boolean {
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e === undefined) continue;
    if (e.type === 'note' && e.big && e.judgement !== 'miss') return true;
  }
  return false;
}

export function createPressHandler(c: PressCollaborators): InputHandler {
  return (e: InputEvent): void => {
    if (!e.down) {
      c.renderer.press(e.key, false);
      return;
    }
    c.renderer.press(e.key, true);
    if (!c.isPlaying()) return;
    const hitMs = c.player.hitMs(e.timeStamp) - c.inputOffset();
    const events = c.engine.hit(e.key, hitMs);
    c.hitSounds.play(keyKind(e.key), isBigHit(events));
    c.renderer.apply(events, hitMs);
    c.hud.noteEvents(events);
  };
}
