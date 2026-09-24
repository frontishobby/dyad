import { describe, expect, it, vi } from 'vitest';
import { createGamepadSource } from '../../src/input/gamepad.ts';
import { DEFAULT_GAMEPAD_BINDINGS, type GamepadBindings, type InputEvent } from '../../src/input/types.ts';

type FakeButton = { pressed: boolean; touched: boolean; value: number };
type FakePad = { id: string; index: number; connected: boolean; buttons: FakeButton[] };

function button(pressed = false, value = pressed ? 1 : 0): FakeButton {
  return { pressed, touched: pressed, value };
}

function makePad(index: number, pressed: number[] = [], count = 17): FakePad {
  return {
    id: `pad-${index}`,
    index,
    connected: true,
    buttons: Array.from({ length: count }, (_, i) => button(pressed.includes(i))),
  };
}

function press(pad: FakePad, index: number, down = true): void {
  const b = pad.buttons[index];
  if (!b) throw new Error(`no button ${index}`);
  b.pressed = down;
  b.touched = down;
  b.value = down ? 1 : 0;
}

function setup(bindings: GamepadBindings = DEFAULT_GAMEPAD_BINDINGS) {
  const pads: (FakePad | null)[] = [];
  const target = new EventTarget();
  let t = 1000;
  const now = vi.fn(() => (t += 16));
  const events: InputEvent[] = [];
  const source = createGamepadSource(bindings, {
    getGamepads: () => pads as unknown as (Gamepad | null)[],
    target,
    now,
  });
  source.start((e) => events.push(e));
  return { pads, target, now, events, source, lastNow: () => t };
}

function padEvent(type: 'gamepadconnected' | 'gamepaddisconnected', timeStamp: number): Event {
  const e = new Event(type);
  Object.defineProperty(e, 'timeStamp', { value: timeStamp, configurable: true });
  return e;
}

describe('createGamepadSource', () => {
  it('emits down on the 0→1 edge and up on the 1→0 edge with the poll-time clock', () => {
    const { pads, events, source, lastNow } = setup();
    const pad = makePad(0);
    pads.push(pad);
    source.poll();
    expect(events).toEqual([]);

    press(pad, 0); // A → DR
    source.poll();
    expect(events).toEqual([{ key: 'DR', down: true, timeStamp: lastNow(), source: 'gamepad' }]);

    source.poll();
    source.poll();
    expect(events).toHaveLength(1);

    press(pad, 0, false);
    source.poll();
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ key: 'DR', down: false, timeStamp: lastNow(), source: 'gamepad' });
  });

  it('maps every default binding index to its key', () => {
    const { pads, events, source } = setup();
    const pad = makePad(0);
    pads.push(pad);
    for (const key of ['KL', 'KR', 'DL', 'DR'] as const) {
      for (const idx of DEFAULT_GAMEPAD_BINDINGS[key]) {
        events.length = 0;
        press(pad, idx);
        source.poll();
        press(pad, idx, false);
        source.poll();
        expect(events.map((e) => [e.key, e.down]), `button ${idx}`).toEqual([
          [key, true],
          [key, false],
        ]);
      }
    }
  });

  it('a key stays down while any of its buttons on any pad is pressed', () => {
    const { pads, events, source } = setup();
    const a = makePad(0);
    const b = makePad(1);
    pads.push(a, b);

    press(a, 0); // DR via A on pad 0
    press(b, 3); // DR via Y on pad 1
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([['DR', true]]);

    press(a, 0, false);
    source.poll();
    expect(events).toHaveLength(1);

    press(a, 3); // another DR button on pad 0 while pad 1 still holds
    source.poll();
    press(b, 3, false);
    source.poll();
    expect(events).toHaveLength(1);

    press(a, 3, false);
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([
      ['DR', true],
      ['DR', false],
    ]);
  });

  it('emits several edges from one poll in KL, KR, DL, DR order', () => {
    const { pads, events, source, lastNow } = setup();
    const pad = makePad(0);
    pads.push(pad);
    press(pad, 0); // DR
    press(pad, 4); // KL
    press(pad, 2); // DL
    press(pad, 5); // KR
    source.poll();
    expect(events.map((e) => e.key)).toEqual(['KL', 'KR', 'DL', 'DR']);
    expect(events.every((e) => e.down && e.timeStamp === lastNow())).toBe(true);
    for (const i of [0, 4, 2, 5]) press(pad, i, false);
    source.poll();
    expect(events.slice(4).map((e) => [e.key, e.down])).toEqual([
      ['KL', false],
      ['KR', false],
      ['DL', false],
      ['DR', false],
    ]);
  });

  it('tolerates null slots, disconnected pads, short button arrays and an empty result', () => {
    const { pads, events, source } = setup();
    const short = makePad(2, [0], 2); // only buttons 0..1 exist: A → DR
    const gone = makePad(3, [4]);
    gone.connected = false;
    pads.push(null, null, short, gone);
    expect(() => source.poll()).not.toThrow();
    expect(events.map((e) => [e.key, e.down])).toEqual([['DR', true]]);

    pads.length = 0;
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([
      ['DR', true],
      ['DR', false],
    ]);
  });

  it('treats an undefined getGamepads() result as no pads', () => {
    const events: InputEvent[] = [];
    let result: unknown = undefined;
    const source = createGamepadSource(DEFAULT_GAMEPAD_BINDINGS, {
      getGamepads: () => result as (Gamepad | null)[] | undefined,
      target: null,
    });
    source.start((e) => events.push(e));
    expect(() => source.poll()).not.toThrow();
    result = [makePad(0, [1])]; // B → KR
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([['KR', true]]);
    result = null;
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([
      ['KR', true],
      ['KR', false],
    ]);
    source.stop();
  });

  it('counts an analog trigger past 0.5 as pressed even when pressed is false', () => {
    const { pads, events, source } = setup();
    const pad = makePad(0);
    pads.push(pad);
    const lt = pad.buttons[6]; // LT → KL
    if (!lt) throw new Error('no LT');
    lt.value = 0.3;
    source.poll();
    expect(events).toEqual([]);
    lt.value = 0.8;
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([['KL', true]]);
    lt.value = 0;
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([
      ['KL', true],
      ['KL', false],
    ]);
  });

  it('works with no window and no navigator.getGamepads (Node defaults): start/poll/stop are no-ops', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof navigator.getGamepads).toBe('undefined');
    const handler = vi.fn();
    const source = createGamepadSource();
    expect(() => {
      source.start(handler);
      source.poll();
      source.poll();
      source.stop();
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('releases keys held only through a pad that disconnects, at the event time, without a poll', () => {
    const { pads, target, events, source } = setup();
    const a = makePad(0, [0]); // DR
    const b = makePad(1, [4]); // KL
    pads.push(a, b);
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([
      ['KL', true],
      ['DR', true],
    ]);

    pads[0] = null;
    target.dispatchEvent(padEvent('gamepaddisconnected', 4321));
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({ key: 'DR', down: false, timeStamp: 4321, source: 'gamepad' });

    // Nothing more on the next poll; KL is still held through pad 1.
    source.poll();
    expect(events).toHaveLength(3);

    // Re-plugged with the button still down: a fresh edge on the next poll.
    pads[0] = makePad(0, [0]);
    source.poll();
    expect(events[3]).toMatchObject({ key: 'DR', down: true });
  });

  it('re-scans on gamepadconnected so a button held on the new pad registers immediately', () => {
    const { pads, target, events, source } = setup();
    source.poll();
    pads.push(makePad(0, [12])); // dpad-up → DL
    target.dispatchEvent(padEvent('gamepadconnected', 77));
    expect(events).toEqual([{ key: 'DL', down: true, timeStamp: 77, source: 'gamepad' }]);
    // Already accounted for: no duplicate on the following poll.
    source.poll();
    expect(events).toHaveLength(1);
  });

  it('falls back to the clock when a pad event carries no usable timeStamp', () => {
    const { pads, target, events, source, lastNow } = setup();
    pads.push(makePad(0, [0]));
    const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'timeStamp', { value: Number.NaN, configurable: true });
    target.dispatchEvent(e);
    expect(events).toEqual([{ key: 'DR', down: true, timeStamp: lastNow(), source: 'gamepad' }]);
    source.stop();
  });

  it('a throwing getGamepads releases what is held and disables further polling', () => {
    const events: InputEvent[] = [];
    let mode: 'ok' | 'throw' = 'ok';
    const pads = [makePad(0, [0])];
    const getGamepads = vi.fn(() => {
      if (mode === 'throw') throw new Error('SecurityError');
      return pads as unknown as (Gamepad | null)[];
    });
    const source = createGamepadSource(DEFAULT_GAMEPAD_BINDINGS, { getGamepads, target: null });
    source.start((e) => events.push(e));
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([['DR', true]]);

    mode = 'throw';
    expect(() => source.poll()).not.toThrow();
    expect(events.map((e) => [e.key, e.down])).toEqual([
      ['DR', true],
      ['DR', false],
    ]);

    mode = 'ok';
    const calls = getGamepads.mock.calls.length;
    source.poll();
    source.poll();
    expect(getGamepads.mock.calls.length).toBe(calls);
    expect(events).toHaveLength(2);
    source.stop();
  });

  it('poll() before start() and after stop() does nothing', () => {
    const pads = [makePad(0, [0])];
    const handler = vi.fn();
    const source = createGamepadSource(DEFAULT_GAMEPAD_BINDINGS, {
      getGamepads: () => pads as unknown as (Gamepad | null)[],
      target: null,
    });
    source.poll();
    expect(handler).not.toHaveBeenCalled();
    source.start(handler);
    source.poll();
    expect(handler).toHaveBeenCalledTimes(1);
    source.stop();
    expect(handler).toHaveBeenCalledTimes(2); // flushed up
    source.poll();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('stop() flushes ups for held keys and removes the pad listeners', () => {
    const { pads, target, events, source } = setup();
    pads.push(makePad(0, [0, 4]));
    source.poll();
    source.stop();
    expect(events.map((e) => [e.key, e.down])).toEqual([
      ['KL', true],
      ['DR', true],
      ['KL', false],
      ['DR', false],
    ]);
    pads[0] = null;
    target.dispatchEvent(padEvent('gamepaddisconnected', 1));
    expect(events).toHaveLength(4);
    expect(() => source.stop()).not.toThrow();
  });

  it('start() twice swaps the handler without duplicate listeners', () => {
    const pads: (FakePad | null)[] = [makePad(0)];
    const target = new EventTarget();
    const source = createGamepadSource(DEFAULT_GAMEPAD_BINDINGS, {
      getGamepads: () => pads as unknown as (Gamepad | null)[],
      target,
    });
    const first = vi.fn();
    const second = vi.fn();
    source.start(first);
    source.start(second);
    press(pads[0] as FakePad, 0);
    target.dispatchEvent(padEvent('gamepadconnected', 1));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    source.stop();
  });

  it('honours custom bindings and ignores later mutation of the bindings object', () => {
    const bindings: GamepadBindings = { KL: [9], KR: [8], DL: [], DR: [15] };
    const { pads, events, source } = setup(bindings);
    bindings.DL.push(0); // must not take effect
    bindings.KL.length = 0; // must not take effect
    const pad = makePad(0, [9, 0]);
    pads.push(pad);
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([['KL', true]]);
    press(pad, 15);
    source.poll();
    expect(events.map((e) => [e.key, e.down])).toEqual([
      ['KL', true],
      ['DR', true],
    ]);
  });

  it('a button index beyond the pad is simply not pressed', () => {
    const { pads, events, source } = setup({ KL: [40], KR: [], DL: [], DR: [0] });
    pads.push(makePad(0, [0]));
    expect(() => source.poll()).not.toThrow();
    expect(events.map((e) => [e.key, e.down])).toEqual([['DR', true]]);
  });
});
