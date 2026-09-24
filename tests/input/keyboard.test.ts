import { describe, expect, it, vi } from 'vitest';
import { buildCodeMap, createKeyboardSource, isEditableTarget } from '../../src/input/keyboard.ts';
import { DEFAULT_BINDINGS, type InputEvent, type KeyBindings } from '../../src/input/types.ts';

/** Node has Event/EventTarget but no KeyboardEvent; fake the fields we read. */
function keyEvent(type: 'keydown' | 'keyup', props: Record<string, unknown>, timeStamp?: number): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, props);
  if (timeStamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: timeStamp, configurable: true });
  return e;
}

class FakeElement extends EventTarget {
  constructor(
    public tagName = 'DIV',
    public type?: string,
    public isContentEditable = false,
  ) {
    super();
  }
}

/** The bindings most tests below are written against (R U / F J). */
const RUFJ: KeyBindings = { KL: 'KeyR', KR: 'KeyU', DL: 'KeyF', DR: 'KeyJ' };

function setup(bindings: KeyBindings = RUFJ, target: EventTarget = new EventTarget()) {
  const events: InputEvent[] = [];
  const source = createKeyboardSource(bindings, target);
  source.start((e) => events.push(e));
  return { events, source, target };
}

describe('isEditableTarget', () => {
  it('is false for null, non-objects and plain elements', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(new EventTarget())).toBe(false);
    expect(isEditableTarget(new FakeElement('DIV'))).toBe(false);
    expect(isEditableTarget(new FakeElement('BUTTON'))).toBe(false);
    expect(isEditableTarget(new FakeElement('CANVAS'))).toBe(false);
  });

  it('is true for text inputs, textarea, select and contenteditable', () => {
    expect(isEditableTarget(new FakeElement('INPUT'))).toBe(true);
    expect(isEditableTarget(new FakeElement('input'))).toBe(true);
    expect(isEditableTarget(new FakeElement('INPUT', 'text'))).toBe(true);
    expect(isEditableTarget(new FakeElement('INPUT', 'number'))).toBe(true);
    expect(isEditableTarget(new FakeElement('INPUT', 'search'))).toBe(true);
    expect(isEditableTarget(new FakeElement('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(new FakeElement('SELECT'))).toBe(true);
    expect(isEditableTarget(new FakeElement('DIV', undefined, true))).toBe(true);
  });

  it('keeps game keys live on non-text input types', () => {
    for (const type of ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image']) {
      expect(isEditableTarget(new FakeElement('INPUT', type)), type).toBe(false);
    }
  });
});

describe('buildCodeMap', () => {
  it('maps every default binding', () => {
    const map = buildCodeMap(DEFAULT_BINDINGS);
    expect(map.get('KeyZ')).toBe('KL');
    expect(map.get('Comma')).toBe('KR');
    expect(map.get('KeyX')).toBe('DL');
    expect(map.get('KeyM')).toBe('DR');
    expect(map.size).toBe(4);
  });

  it('lets the first key in KL/KR/DL/DR order win a duplicated code', () => {
    const map = buildCodeMap({ KL: 'Space', KR: 'Space', DL: 'KeyF', DR: 'KeyF' });
    expect(map.get('Space')).toBe('KL');
    expect(map.get('KeyF')).toBe('DL');
    expect(map.size).toBe(2);
  });

  it('never binds an empty code', () => {
    const map = buildCodeMap({ KL: '', KR: 'KeyU', DL: 'KeyF', DR: 'KeyJ' });
    expect(map.has('')).toBe(false);
    expect(map.size).toBe(3);
  });
});

describe('createKeyboardSource', () => {
  it('emits down and up with the event timeStamp and prevents default', () => {
    const { events, target } = setup();
    const down = keyEvent('keydown', { code: 'KeyF' }, 100.25);
    const up = keyEvent('keyup', { code: 'KeyF' }, 180.5);
    target.dispatchEvent(down);
    target.dispatchEvent(up);
    expect(events).toEqual([
      { key: 'DL', down: true, timeStamp: 100.25, source: 'keyboard' },
      { key: 'DL', down: false, timeStamp: 180.5, source: 'keyboard' },
    ]);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
  });

  it('maps all four default keys', () => {
    const { events, target } = setup();
    for (const code of ['KeyR', 'KeyU', 'KeyF', 'KeyJ']) target.dispatchEvent(keyEvent('keydown', { code }, 1));
    expect(events.map((e) => e.key)).toEqual(['KL', 'KR', 'DL', 'DR']);
    expect(events.every((e) => e.down && e.source === 'keyboard')).toBe(true);
  });

  it('honours custom bindings', () => {
    const { events, target } = setup({ KL: 'KeyA', KR: 'KeyS', DL: 'KeyK', DR: 'KeyL' });
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyL' }, 5));
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyF' }, 6));
    expect(events).toEqual([{ key: 'DR', down: true, timeStamp: 5, source: 'keyboard' }]);
  });

  it('ignores auto-repeat but still prevents its default', () => {
    const { events, target } = setup();
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyJ' }, 10));
    const repeat = keyEvent('keydown', { code: 'KeyJ', repeat: true }, 40);
    target.dispatchEvent(repeat);
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyJ', repeat: true }, 70));
    expect(events).toHaveLength(1);
    expect(repeat.defaultPrevented).toBe(true);
    target.dispatchEvent(keyEvent('keyup', { code: 'KeyJ' }, 90));
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ key: 'DR', down: false, timeStamp: 90 });
  });

  it('leaves unbound keys alone (no event, no preventDefault)', () => {
    const { events, target } = setup();
    const e = keyEvent('keydown', { code: 'KeyA' }, 1);
    target.dispatchEvent(e);
    const up = keyEvent('keyup', { code: 'Escape' }, 2);
    target.dispatchEvent(up);
    expect(events).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
  });

  it('ignores keydown aimed at an editable element and does not prevent typing', () => {
    for (const el of [
      new FakeElement('INPUT'),
      new FakeElement('TEXTAREA'),
      new FakeElement('SELECT'),
      new FakeElement('DIV', undefined, true),
    ]) {
      const { events } = setup(RUFJ, el);
      const e = keyEvent('keydown', { code: 'KeyF' }, 1);
      el.dispatchEvent(e);
      expect(events, el.tagName).toEqual([]);
      expect(e.defaultPrevented, el.tagName).toBe(false);
    }
  });

  it('still handles keys when a button is focused', () => {
    const el = new FakeElement('BUTTON');
    const { events } = setup(RUFJ, el);
    el.dispatchEvent(keyEvent('keydown', { code: 'KeyF' }, 1));
    expect(events).toHaveLength(1);
  });

  it('with a duplicated code the first key wins', () => {
    const { events, target } = setup({ KL: 'KeyR', KR: 'KeyR', DL: 'KeyF', DR: 'KeyJ' });
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyR' }, 1));
    target.dispatchEvent(keyEvent('keyup', { code: 'KeyR' }, 2));
    expect(events.map((e) => e.key)).toEqual(['KL', 'KL']);
  });

  it('drops an orphan keyup (pressed before start)', () => {
    const { events, target } = setup();
    const up = keyEvent('keyup', { code: 'KeyF' }, 1);
    target.dispatchEvent(up);
    expect(events).toEqual([]);
    expect(up.defaultPrevented).toBe(false);
  });

  it('does not emit a second up for a single down', () => {
    const { events, target } = setup();
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyF' }, 1));
    target.dispatchEvent(keyEvent('keyup', { code: 'KeyF' }, 2));
    target.dispatchEvent(keyEvent('keyup', { code: 'KeyF' }, 3));
    expect(events.map((e) => e.down)).toEqual([true, false]);
  });

  it('re-emits down when a keyup was lost (never blocks a real press)', () => {
    const { events, target } = setup();
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyF' }, 1));
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyF' }, 2));
    expect(events.map((e) => [e.down, e.timeStamp])).toEqual([
      [true, 1],
      [true, 2],
    ]);
  });

  it('leaves Ctrl/Meta/Alt chords to the browser', () => {
    const { events, target } = setup();
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      const e = keyEvent('keydown', { code: 'KeyR', [mod]: true }, 1);
      target.dispatchEvent(e);
      expect(events, mod).toEqual([]);
      expect(e.defaultPrevented, mod).toBe(false);
    }
    // The keyup that follows a swallowed chord press is an orphan, not an up.
    target.dispatchEvent(keyEvent('keyup', { code: 'KeyR' }, 2));
    expect(events).toEqual([]);
  });

  it('still fires when the bound key is the modifier itself', () => {
    const { events, target } = setup({ KL: 'ControlLeft', KR: 'AltRight', DL: 'MetaLeft', DR: 'ShiftLeft' });
    target.dispatchEvent(keyEvent('keydown', { code: 'ControlLeft', ctrlKey: true }, 1));
    target.dispatchEvent(keyEvent('keydown', { code: 'AltRight', altKey: true }, 2));
    target.dispatchEvent(keyEvent('keydown', { code: 'MetaLeft', metaKey: true }, 3));
    target.dispatchEvent(keyEvent('keydown', { code: 'ShiftLeft', shiftKey: true }, 4));
    expect(events.map((e) => e.key)).toEqual(['KL', 'KR', 'DL', 'DR']);
  });

  it('releases a held key on keyup even if focus moved into an editable, without preventing it', () => {
    const { events, target } = setup();
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyF' }, 1));
    // Simulate the keyup being retargeted to an input by overriding target.
    const up = keyEvent('keyup', { code: 'KeyF' }, 2);
    Object.defineProperty(up, 'target', { value: new FakeElement('INPUT'), configurable: true });
    target.dispatchEvent(up);
    expect(events.map((e) => e.down)).toEqual([true, false]);
    expect(up.defaultPrevented).toBe(false);
  });

  it('releases every held key on blur with the blur timeStamp', () => {
    const { events, target } = setup();
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyR' }, 1));
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyJ' }, 2));
    const blur = new Event('blur');
    Object.defineProperty(blur, 'timeStamp', { value: 500, configurable: true });
    target.dispatchEvent(blur);
    expect(events.slice(2)).toEqual([
      { key: 'KL', down: false, timeStamp: 500, source: 'keyboard' },
      { key: 'DR', down: false, timeStamp: 500, source: 'keyboard' },
    ]);
    // Nothing is held any more, so the physical keyup is now an orphan.
    target.dispatchEvent(keyEvent('keyup', { code: 'KeyR' }, 600));
    expect(events).toHaveLength(4);
  });

  it('stop() flushes held keys, removes listeners and stops preventing default', () => {
    const { events, source, target } = setup();
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyU' }, 1));
    source.stop();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ key: 'KR', down: false, source: 'keyboard' });
    expect(typeof events[1]?.timeStamp).toBe('number');

    const e = keyEvent('keydown', { code: 'KeyU' }, 2);
    target.dispatchEvent(e);
    target.dispatchEvent(keyEvent('keyup', { code: 'KeyU' }, 3));
    expect(events).toHaveLength(2);
    expect(e.defaultPrevented).toBe(false);
    // Idempotent.
    expect(() => source.stop()).not.toThrow();
  });

  it('start() twice swaps the handler without doubling events', () => {
    const target = new EventTarget();
    const source = createKeyboardSource(RUFJ, target);
    const first = vi.fn();
    const second = vi.fn();
    source.start(first);
    source.start(second);
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyF' }, 1));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    source.stop();
  });

  it('an empty binding never matches an event with an empty code', () => {
    const { events, target } = setup({ KL: '', KR: 'KeyU', DL: 'KeyF', DR: 'KeyJ' });
    const e = keyEvent('keydown', { code: '' }, 1);
    target.dispatchEvent(e);
    expect(events).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });
});
