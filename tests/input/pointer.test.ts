import { describe, expect, it, vi } from 'vitest';
import type { Key } from '../../src/core/types.ts';
import { createPointerSource, hitTestZones } from '../../src/input/pointer.ts';
import type { InputEvent, Rect } from '../../src/input/types.ts';

/** Minimal stand-in for the stage element: an EventTarget with style + capture. */
class FakeElement extends EventTarget {
  style: Record<string, unknown> = {};
  setPointerCapture = vi.fn<(id: number) => void>();
}

type PointerProps = { pointerId: number; clientX?: number; clientY?: number; button?: number; pointerType?: string };

function pointerEvent(type: string, props: PointerProps, timeStamp?: number): Event {
  const e = new Event(type, { cancelable: true, bubbles: true });
  Object.assign(e, { clientX: 0, clientY: 0, ...props });
  if (timeStamp !== undefined) Object.defineProperty(e, 'timeStamp', { value: timeStamp, configurable: true });
  return e;
}

/** 2×2 zones on a 200×200 logical canvas: KL KR on top, DL DR below. */
const ZONES: Record<Key, Rect> = {
  KL: { x: 0, y: 0, w: 100, h: 100 },
  KR: { x: 100, y: 0, w: 100, h: 100 },
  DL: { x: 0, y: 100, w: 100, h: 100 },
  DR: { x: 100, y: 100, w: 100, h: 100 },
};

function setup(zones: () => Partial<Record<Key, Rect>> = () => ZONES) {
  const element = new FakeElement();
  const events: InputEvent[] = [];
  // Client space is 2× logical, offset by 10 px: proves toLogical is applied.
  const toLogical = vi.fn((cx: number, cy: number) => ({ x: (cx - 10) / 2, y: (cy - 10) / 2 }));
  const source = createPointerSource({ element: element as unknown as HTMLElement, toLogical, zones });
  source.start((e) => events.push(e));
  return { element, events, source, toLogical };
}

/** Client coordinates that land on the centre of a zone under the test toLogical. */
const AT: Record<Key, { clientX: number; clientY: number }> = {
  KL: { clientX: 10 + 2 * 50, clientY: 10 + 2 * 50 },
  KR: { clientX: 10 + 2 * 150, clientY: 10 + 2 * 50 },
  DL: { clientX: 10 + 2 * 50, clientY: 10 + 2 * 150 },
  DR: { clientX: 10 + 2 * 150, clientY: 10 + 2 * 150 },
};

describe('hitTestZones', () => {
  it('finds the zone containing the point, exclusive on the far edges', () => {
    expect(hitTestZones(ZONES, 0, 0)).toBe('KL');
    expect(hitTestZones(ZONES, 99.9, 99.9)).toBe('KL');
    expect(hitTestZones(ZONES, 100, 0)).toBe('KR');
    expect(hitTestZones(ZONES, 0, 100)).toBe('DL');
    expect(hitTestZones(ZONES, 199, 199)).toBe('DR');
    expect(hitTestZones(ZONES, 200, 100)).toBeNull();
    expect(hitTestZones(ZONES, -1, 50)).toBeNull();
  });

  it('returns the first zone in KL/KR/DL/DR order when zones overlap', () => {
    const overlapping: Partial<Record<Key, Rect>> = {
      DR: { x: 0, y: 0, w: 10, h: 10 },
      KR: { x: 0, y: 0, w: 10, h: 10 },
    };
    expect(hitTestZones(overlapping, 5, 5)).toBe('KR');
  });

  it('skips missing zones', () => {
    expect(hitTestZones({}, 5, 5)).toBeNull();
    expect(hitTestZones({ DL: ZONES.DL }, 50, 150)).toBe('DL');
  });
});

describe('createPointerSource', () => {
  it('maps client → logical, hit-tests zones and emits down with the event timeStamp', () => {
    const { element, events, toLogical } = setup();
    const down = pointerEvent('pointerdown', { pointerId: 3, ...AT.KR, button: 0, pointerType: 'touch' }, 250.5);
    element.dispatchEvent(down);
    expect(toLogical).toHaveBeenCalledWith(AT.KR.clientX, AT.KR.clientY);
    expect(events).toEqual([{ key: 'KR', down: true, timeStamp: 250.5, source: 'touch' }]);
    expect(down.defaultPrevented).toBe(true);
    expect(element.setPointerCapture).toHaveBeenCalledWith(3);
  });

  it('hits all four zones', () => {
    const { element, events } = setup();
    let id = 0;
    for (const key of ['KL', 'KR', 'DL', 'DR'] as const) {
      element.dispatchEvent(pointerEvent('pointerdown', { pointerId: ++id, ...AT[key] }, id));
    }
    expect(events.map((e) => e.key)).toEqual(['KL', 'KR', 'DL', 'DR']);
  });

  it('releases the key the pointer went down on even after sliding away', () => {
    const { element, events } = setup();
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, ...AT.DR }, 100));
    // Finger drifted far outside every zone before lifting.
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: -500, clientY: -500 }, 160));
    expect(events).toEqual([
      { key: 'DR', down: true, timeStamp: 100, source: 'touch' },
      { key: 'DR', down: false, timeStamp: 160, source: 'touch' },
    ]);
  });

  it('releases on pointercancel and on lostpointercapture, exactly once', () => {
    const { element, events } = setup();
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, ...AT.KL }, 1));
    element.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1 }, 2));
    element.dispatchEvent(pointerEvent('lostpointercapture', { pointerId: 1 }, 3));
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }, 4));
    expect(events.map((e) => [e.down, e.timeStamp])).toEqual([
      [true, 1],
      [false, 2],
    ]);

    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, ...AT.DL }, 5));
    element.dispatchEvent(pointerEvent('lostpointercapture', { pointerId: 2 }, 6));
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 2 }, 7));
    expect(events.slice(2).map((e) => [e.key, e.down, e.timeStamp])).toEqual([
      ['DL', true, 5],
      ['DL', false, 6],
    ]);
  });

  it('ignores pointers that hit no zone but still prevents default; their up is a no-op', () => {
    const { element, events } = setup();
    const down = pointerEvent('pointerdown', { pointerId: 9, clientX: 10 + 2 * 250, clientY: 10 + 2 * 250 }, 1);
    element.dispatchEvent(down);
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 9, ...AT.KL }, 2));
    expect(events).toEqual([]);
    expect(down.defaultPrevented).toBe(true);
    expect(element.setPointerCapture).not.toHaveBeenCalled();
  });

  it('handles several simultaneous pointers independently', () => {
    const { element, events } = setup();
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, ...AT.KL }, 1));
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, ...AT.KR }, 2));
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, ...AT.KL }, 3));
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 2 }, 4));
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }, 5));
    element.dispatchEvent(pointerEvent('pointercancel', { pointerId: 3 }, 6));
    expect(events.map((e) => [e.key, e.down, e.timeStamp])).toEqual([
      ['KL', true, 1],
      ['KR', true, 2],
      ['KL', true, 3],
      ['KR', false, 4],
      ['KL', false, 5],
      ['KL', false, 6],
    ]);
  });

  it('closes a stale pointerId before reusing it', () => {
    const { element, events } = setup();
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5, ...AT.KL }, 1));
    // The up for pointer 5 was never delivered; the id shows up again.
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5, ...AT.DR }, 2));
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 5 }, 3));
    expect(events.map((e) => [e.key, e.down, e.timeStamp])).toEqual([
      ['KL', true, 1],
      ['KL', false, 2],
      ['DR', true, 2],
      ['DR', false, 3],
    ]);
  });

  it('ignores secondary buttons', () => {
    const { element, events } = setup();
    const e = pointerEvent('pointerdown', { pointerId: 1, ...AT.KL, button: 2, pointerType: 'mouse' }, 1);
    element.dispatchEvent(e);
    expect(events).toEqual([]);
    expect(e.defaultPrevented).toBe(true);
  });

  it('consults zones() on every pointerdown so layout changes apply immediately', () => {
    let current: Partial<Record<Key, Rect>> = {};
    const zones = vi.fn(() => current);
    const { element, events } = setup(zones);
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, ...AT.KL }, 1));
    expect(events).toEqual([]);
    current = ZONES;
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, ...AT.KL }, 2));
    expect(events).toHaveLength(1);
    expect(zones).toHaveBeenCalledTimes(2);
  });

  it('sets touch-action / user-select on start and restores the previous values on stop', () => {
    const element = new FakeElement();
    element.style['touchAction'] = 'auto';
    element.style['userSelect'] = 'text';
    element.style['webkitUserSelect'] = 'text';
    const source = createPointerSource({
      element: element as unknown as HTMLElement,
      toLogical: (x, y) => ({ x, y }),
      zones: () => ZONES,
    });
    source.start(() => {});
    expect(element.style['touchAction']).toBe('none');
    expect(element.style['userSelect']).toBe('none');
    expect(element.style['webkitUserSelect']).toBe('none');
    source.stop();
    expect(element.style['touchAction']).toBe('auto');
    expect(element.style['userSelect']).toBe('text');
    expect(element.style['webkitUserSelect']).toBe('text');
  });

  it('restores an empty inline style to empty and uses setProperty for the callout when available', () => {
    const element = new FakeElement();
    const props = new Map<string, string>();
    element.style['setProperty'] = (k: string, v: string) => props.set(k, v);
    element.style['getPropertyValue'] = (k: string) => props.get(k) ?? '';
    element.style['removeProperty'] = (k: string) => props.delete(k);
    const source = createPointerSource({
      element: element as unknown as HTMLElement,
      toLogical: (x, y) => ({ x, y }),
      zones: () => ZONES,
    });
    source.start(() => {});
    expect(element.style['touchAction']).toBe('none');
    expect(props.get('-webkit-touch-callout')).toBe('none');
    source.stop();
    expect(element.style['touchAction']).toBe('');
    expect(element.style['userSelect']).toBe('');
    expect(props.has('-webkit-touch-callout')).toBe(false);
  });

  it('stop() flushes ups for active pointers and removes listeners', () => {
    const { element, events, source } = setup();
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, ...AT.KL }, 1));
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, ...AT.DR }, 2));
    source.stop();
    expect(events.slice(2).map((e) => [e.key, e.down, e.source])).toEqual([
      ['KL', false, 'touch'],
      ['DR', false, 'touch'],
    ]);
    expect(events.slice(2).every((e) => typeof e.timeStamp === 'number')).toBe(true);

    const down = pointerEvent('pointerdown', { pointerId: 3, ...AT.KL }, 3);
    element.dispatchEvent(down);
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }, 4));
    expect(events).toHaveLength(4);
    expect(down.defaultPrevented).toBe(false);
    expect(() => source.stop()).not.toThrow();
  });

  it('prevents the context menu while started only', () => {
    const { element, source } = setup();
    const during = new Event('contextmenu', { cancelable: true });
    element.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    source.stop();
    const after = new Event('contextmenu', { cancelable: true });
    element.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('tolerates a throwing or missing setPointerCapture', () => {
    const { element, events } = setup();
    element.setPointerCapture.mockImplementation(() => {
      throw new Error('InvalidStateError');
    });
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, ...AT.KL }, 1));
    expect(events).toHaveLength(1);

    const bare = new EventTarget() as EventTarget & { style: Record<string, unknown> };
    bare.style = {};
    const got: InputEvent[] = [];
    const source = createPointerSource({
      element: bare as unknown as HTMLElement,
      toLogical: (x, y) => ({ x, y }),
      zones: () => ZONES,
    });
    source.start((e) => got.push(e));
    bare.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 150, clientY: 150 }, 1));
    expect(got).toEqual([{ key: 'DR', down: true, timeStamp: 1, source: 'touch' }]);
    source.stop();
  });

  it('start() twice swaps the handler without doubling events', () => {
    const element = new FakeElement();
    const source = createPointerSource({
      element: element as unknown as HTMLElement,
      toLogical: (x, y) => ({ x, y }),
      zones: () => ZONES,
    });
    const first = vi.fn();
    const second = vi.fn();
    source.start(first);
    source.start(second);
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50 }, 1));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    source.stop();
    expect(element.style['touchAction']).toBe('');
  });
});
