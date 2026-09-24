import { describe, expect, it } from 'vitest';
import { createEngine, expectedRollTicks } from '../../src/core/engine.ts';
import type { EngineConfig, EngineEvent, Key } from '../../src/core/types.ts';
import { defaultConfig } from '../../src/core/windows.ts';
import { chart, keyOf, note, noteEvent, roll, spinner, type ChartSpec } from './helpers.ts';

// An explicit config with a "consumed miss" band (ok < miss) so every engine path is exercised;
// the game's fixed windows (30 / 50 / 50) have no such band. Partner window 30 ms.
const CONFIG: EngineConfig = { windows: { great: 35, ok: 80, miss: 95 }, bigWindowMs: defaultConfig().bigWindowMs };
const { great: GREAT, ok: OK, miss: MISS } = CONFIG.windows;
const BIG = CONFIG.bigWindowMs;
/** tick() keeps a partner window open bigWindowMs + windows.miss past the first hand (see engine.ts header). */
const TICK_PARTNER_LIMIT = BIG + MISS;

function engineOf(spec: ChartSpec, config: EngineConfig = CONFIG) {
  return createEngine(chart(spec), config);
}

const rollTick = (index: number, key: Key): EngineEvent => ({ type: 'roll-tick', index, key });
const spinnerTick = (index: number, key: Key, remaining: number): EngineEvent => ({
  type: 'spinner-tick',
  index,
  key,
  remaining,
});
const spinnerEnd = (index: number, completed: boolean): EngineEvent => ({ type: 'spinner-end', index, completed });

describe('createEngine', () => {
  it('starts with an empty, stable state', () => {
    const e = engineOf({ notes: [note(1000), note(2000, 'k', true)] });
    expect(e.state).toEqual({
      score: 0,
      accuracy: 1,
      combo: 0,
      maxCombo: 0,
      counts: { great: 0, ok: 0, miss: 0 },
      rollTicks: 0,
      spinnerTicks: 0,
      judged: 0,
      total: 2,
      finished: false,
    });
    expect(e.log).toEqual([]);
    expect(e.firstPending()).toBe(0);
    expect(e.noteView(0)).toEqual({ status: 'pending', judgement: null, awaitingPartner: false, strong: false });
    expect(e.noteView(1)).toEqual({ status: 'pending', judgement: null, awaitingPartner: false, strong: false });

    const state = e.state;
    const log = e.log;
    e.hit('DL', 1000);
    e.tick(5000);
    expect(e.state).toBe(state);
    expect(e.log).toBe(log);
    expect(state.judged).toBe(2);
  });

  it('exposes the chart and a frozen snapshot of the config', () => {
    const c = chart({ notes: [note(1000)] });
    const input = { windows: { great: 35, ok: 80, miss: 95 }, bigWindowMs: 30 };
    const e = createEngine(c, input);
    expect(e.chart).toBe(c);
    expect(e.config).toEqual(input);
    expect(Object.isFrozen(e.config)).toBe(true);
    expect(Object.isFrozen(e.config.windows)).toBe(true);
    // Mutating the caller's object later does not change how the engine judges.
    input.windows.miss = 0;
    input.bigWindowMs = 99;
    expect(e.config.bigWindowMs).toBe(30);
    expect(e.hit('DL', 1090)).toEqual([noteEvent(0, 'miss', 90, 'DL')]);
  });

  it('rejects unsorted notes and broken windows', () => {
    expect(() => engineOf({ notes: [note(1000), note(900)] })).toThrow(RangeError);
    expect(() => engineOf({ notes: [note(1000), note(1000)] })).not.toThrow();
    expect(() =>
      createEngine(chart(), { windows: { great: Number.NaN, ok: 80, miss: 95 }, bigWindowMs: 30 }),
    ).toThrow(RangeError);
    expect(() =>
      createEngine(chart(), { windows: { great: 35, ok: 80, miss: 95 }, bigWindowMs: -1 }),
    ).toThrow(RangeError);
  });

  it('rejects non-finite times at the entry points', () => {
    const e = engineOf({ notes: [note(1000)] });
    expect(() => e.hit('DL', Number.NaN)).toThrow(RangeError);
    expect(() => e.tick(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(e.log).toEqual([]);
  });

  it('finishes an empty chart on the first tick with score 0 and accuracy 1', () => {
    const e = engineOf({});
    expect(e.tick(0)).toEqual([]);
    expect(e.state.finished).toBe(true);
    expect(e.state.score).toBe(0);
    expect(e.state.accuracy).toBe(1);
    expect(e.firstPending()).toBe(0);
  });

  it('noteView throws out of range and returns live objects', () => {
    const e = engineOf({ notes: [note(1000)] });
    expect(() => e.noteView(1)).toThrow(RangeError);
    expect(() => e.noteView(-1)).toThrow(RangeError);
    const view = e.noteView(0);
    e.hit('DL', 1000);
    expect(e.noteView(0)).toBe(view);
    expect(view.status).toBe('hit');
  });
});

describe('events arrays', () => {
  it('returns one shared frozen empty array when nothing happened, a fresh one otherwise', () => {
    const e = engineOf({ notes: [note(1000), note(2000)] });
    const quiet1 = e.tick(0);
    const quiet2 = e.tick(10);
    const quiet3 = e.hit('DL', 100); // too early
    expect(quiet1).toBe(quiet2);
    expect(quiet2).toBe(quiet3);
    expect(quiet1).toEqual([]);
    expect(Object.isFrozen(quiet1)).toBe(true);

    const a = e.hit('DL', 1000);
    const b = e.hit('DL', 2000);
    expect(a).not.toBe(b);
    expect(a).not.toBe(quiet1);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(Object.isFrozen(a)).toBe(false);
  });
});

describe('press judgement (right type, in window)', () => {
  it.each([
    [0, 'great'],
    [GREAT, 'great'],
    [-GREAT, 'great'],
    [GREAT + 0.001, 'ok'],
    [OK, 'ok'],
    [-OK, 'ok'],
    [OK + 0.001, 'miss'],
    [MISS, 'miss'],
    [-MISS, 'miss'],
  ] as const)('delta %f → %s (boundaries are inclusive)', (delta, judgement) => {
    const e = engineOf({ notes: [note(1000)] });
    const hitMs = 1000 + delta;
    expect(e.hit('DL', hitMs)).toEqual([noteEvent(0, judgement, hitMs - 1000, 'DL')]);
    expect(e.noteView(0)).toEqual({
      status: judgement === 'miss' ? 'missed' : 'hit',
      judgement,
      awaitingPartner: false,
      strong: false,
    });
    expect(e.firstPending()).toBe(1);
    expect(e.state.judged).toBe(1);
    expect(e.state.counts[judgement]).toBe(1);
    expect(e.state.combo).toBe(judgement === 'miss' ? 0 : 1);
  });

  it('an in-window miss is consumed: the next press cannot rescue it', () => {
    const e = engineOf({ notes: [note(1000)] });
    e.hit('DL', 1000 - MISS);
    expect(e.state.counts.miss).toBe(1);
    expect(e.hit('DL', 1000)).toEqual([]);
    expect(e.state.counts).toEqual({ great: 0, ok: 0, miss: 1 });
    expect(e.log).toEqual([
      [1000 - MISS, 'DL'],
      [1000, 'DL'],
    ]);
  });

  it('either hand hits a regular note', () => {
    const left = engineOf({ notes: [note(1000, 'k')] });
    const right = engineOf({ notes: [note(1000, 'k')] });
    expect(left.hit('KL', 1000)).toEqual([noteEvent(0, 'great', 0, 'KL')]);
    expect(right.hit('KR', 1000)).toEqual([noteEvent(0, 'great', 0, 'KR')]);
  });

  it('too-early presses consume nothing and only go into the log', () => {
    const e = engineOf({ notes: [note(1000)] });
    expect(e.hit('DL', 1000 - MISS - 0.001)).toEqual([]);
    expect(e.hit('KL', 500)).toEqual([]);
    expect(e.noteView(0).status).toBe('pending');
    expect(e.firstPending()).toBe(0);
    expect(e.state.judged).toBe(0);
    expect(e.log).toEqual([
      [1000 - MISS - 0.001, 'DL'],
      [500, 'KL'],
    ]);
    expect(e.hit('DL', 1000)).toEqual([noteEvent(0, 'great', 0, 'DL')]);
  });

  it('a press past the miss window settles the note as a time-out miss and hits nothing', () => {
    const e = engineOf({ notes: [note(1000)] });
    expect(e.hit('DL', 1000 + MISS + 0.001)).toEqual([noteEvent(0, 'miss', null, null)]);
    expect(e.log).toEqual([[1000 + MISS + 0.001, 'DL']]);
  });

  it('keeps fractional hit times in the log and in deltaMs', () => {
    const e = engineOf({ notes: [note(1000)] });
    expect(e.hit('DR', 1012.25)).toEqual([noteEvent(0, 'great', 12.25, 'DR')]);
    expect(e.log).toEqual([[1012.25, 'DR']]);
  });
});

describe('wrong type', () => {
  it('misses the candidate with deltaMs null and the pressed key, consuming it', () => {
    const e = engineOf({ notes: [note(1000, 'd'), note(1200, 'k')] });
    expect(e.hit('KL', 1010)).toEqual([noteEvent(0, 'miss', null, 'KL')]);
    expect(e.noteView(0)).toEqual({ status: 'missed', judgement: 'miss', awaitingPartner: false, strong: false });
    expect(e.state.combo).toBe(0);
    expect(e.state.counts.miss).toBe(1);
    expect(e.firstPending()).toBe(1);
    // The right type now goes to the next note.
    expect(e.hit('KR', 1200)).toEqual([noteEvent(1, 'great', 0, 'KR')]);
  });

  it('misses even when the timing would have been great or a miss', () => {
    const early = engineOf({ notes: [note(1000, 'k')] });
    expect(early.hit('DL', 1000)).toEqual([noteEvent(0, 'miss', null, 'DL')]);
    const late = engineOf({ notes: [note(1000, 'k')] });
    expect(late.hit('DR', 1000 + MISS)).toEqual([noteEvent(0, 'miss', null, 'DR')]);
  });

  it('does nothing when the wrong type is too early', () => {
    const e = engineOf({ notes: [note(1000, 'k')] });
    expect(e.hit('DL', 1000 - MISS - 1)).toEqual([]);
    expect(e.noteView(0).status).toBe('pending');
  });
});

describe('tick: time-out misses', () => {
  it('misses a note only once songMs is strictly past t + miss', () => {
    const e = engineOf({ notes: [note(1000)] });
    expect(e.tick(1000 + MISS)).toEqual([]);
    expect(e.noteView(0).status).toBe('pending');
    expect(e.tick(1000 + MISS + 0.001)).toEqual([noteEvent(0, 'miss', null, null)]);
    expect(e.noteView(0)).toEqual({ status: 'missed', judgement: 'miss', awaitingPartner: false, strong: false });
    expect(e.state.counts.miss).toBe(1);
    expect(e.state.judged).toBe(1);
    expect(e.firstPending()).toBe(1);
  });

  it('misses every overdue note in chart order and resets the combo', () => {
    const e = engineOf({ notes: [note(1000), note(1100, 'k'), note(1200), note(5000)] });
    e.hit('DL', 1000);
    expect(e.state.combo).toBe(1);
    expect(e.tick(2000)).toEqual([noteEvent(1, 'miss', null, null), noteEvent(2, 'miss', null, null)]);
    expect(e.state.combo).toBe(0);
    expect(e.state.maxCombo).toBe(1);
    expect(e.state.counts).toEqual({ great: 1, ok: 0, miss: 2 });
    expect(e.noteView(3).status).toBe('pending');
    expect(e.tick(2001)).toEqual([]);
  });

  it('ignores ticks that lag behind (smaller songMs than before)', () => {
    const e = engineOf({ notes: [note(1000), note(2000)] });
    e.tick(1500);
    expect(e.state.counts.miss).toBe(1);
    expect(e.tick(900)).toEqual([]);
    expect(e.state.counts.miss).toBe(1);
    expect(e.noteView(1).status).toBe('pending');
  });

  it('hit() settles overdue notes before judging, exactly like a tick would have', () => {
    const ticked = engineOf({ notes: [note(0), note(1000), note(1100)] });
    ticked.tick(999.5);
    const tickedEvents = ticked.hit('DL', 1000);

    const direct = engineOf({ notes: [note(0), note(1000), note(1100)] });
    const directEvents = direct.hit('DL', 1000);

    expect(directEvents).toEqual([noteEvent(0, 'miss', null, null), noteEvent(1, 'great', 0, 'DL')]);
    expect(tickedEvents).toEqual([noteEvent(1, 'great', 0, 'DL')]);
    expect(direct.state).toEqual(ticked.state);
    expect(direct.noteView(0)).toEqual(ticked.noteView(0));
    expect(direct.noteView(1)).toEqual(ticked.noteView(1));
  });
});

describe('big notes: one hand caps at OK, both hands take the timing', () => {
  it('the first hand emits nothing and leaves the note pending but awaiting its partner', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    expect(e.hit('DL', 1010)).toEqual([]);
    expect(e.noteView(0)).toEqual({ status: 'pending', judgement: null, awaitingPartner: true, strong: false });
    expect(e.state.judged).toBe(0);
    expect(e.state.score).toBe(0);
    expect(e.state.accuracy).toBe(1);
    expect(e.state.combo).toBe(0);
    expect(e.firstPending()).toBe(0);
    expect(e.log).toEqual([[1010, 'DL']]);
  });

  it('the partner within bigWindowMs emits the note with the first hand’s timing and strong=true', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    e.hit('DL', 1010);
    expect(e.hit('DR', 1010 + BIG)).toEqual([noteEvent(0, 'great', 10, 'DL', true, true)]);
    expect(e.noteView(0)).toEqual({ status: 'hit', judgement: 'great', awaitingPartner: false, strong: true });
    expect(e.state.judged).toBe(1);
    expect(e.state.counts).toEqual({ great: 1, ok: 0, miss: 0 });
    expect(e.state.combo).toBe(1);
    expect(e.state.score).toBe(1_000_000);
    expect(e.state.accuracy).toBe(1);
    expect(e.firstPending()).toBe(1);
    // A third press of the same type does nothing more.
    expect(e.hit('DL', 1025)).toEqual([]);
    expect(e.state.score).toBe(1_000_000);
  });

  it('either hand can go first; the event carries the first key', () => {
    const e = engineOf({ notes: [note(1000, 'k', true)] });
    expect(e.hit('KR', 1000)).toEqual([]);
    expect(e.hit('KL', 1005)).toEqual([noteEvent(0, 'great', 0, 'KR', true, true)]);
  });

  it('an ok first hand scores ok even if the partner is perfect', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    e.hit('DR', 1000 - OK);
    expect(e.hit('DL', 1000 - OK + 3)).toEqual([noteEvent(0, 'ok', -OK, 'DR', true, true)]);
    expect(e.state.score).toBe(500_000);
    expect(e.state.accuracy).toBe(0.5);
  });

  it('one hand only: a Great first hand is capped at OK when the window expires by tick', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    e.hit('DL', 1010);
    expect(e.tick(1000 + BIG + 1)).toEqual([]);
    expect(e.noteView(0).awaitingPartner).toBe(true);
    expect(e.tick(1010 + TICK_PARTNER_LIMIT)).toEqual([]);
    expect(e.tick(1010 + TICK_PARTNER_LIMIT + 0.001)).toEqual([noteEvent(0, 'ok', 10, 'DL', true, false)]);
    expect(e.noteView(0)).toEqual({ status: 'hit', judgement: 'ok', awaitingPartner: false, strong: false });
    expect(e.state.counts).toEqual({ great: 0, ok: 1, miss: 0 });
    expect(e.state.combo).toBe(1);
    expect(e.state.score).toBe(500_000);
    expect(e.state.accuracy).toBe(0.5);
  });

  it('one hand only: an ok first hand stays ok', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    e.hit('DL', 1000 + OK);
    expect(e.tick(1000 + OK + TICK_PARTNER_LIMIT + 1)).toEqual([noteEvent(0, 'ok', OK, 'DL', true, false)]);
    expect(e.state.score).toBe(500_000);
  });

  it('a partner past bigWindowMs closes the window as OK and, with nothing else to hit, does nothing more', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    e.hit('DL', 1000);
    expect(e.hit('DR', 1000 + BIG + 0.001)).toEqual([noteEvent(0, 'ok', 0, 'DL', true, false)]);
    expect(e.noteView(0)).toEqual({ status: 'hit', judgement: 'ok', awaitingPartner: false, strong: false });
    expect(e.state.score).toBe(500_000);
    expect(e.log).toHaveLength(2);
  });

  it('the partner press never touches the next note, even a dense one', () => {
    const e = engineOf({ notes: [note(1000, 'd', true), note(1020, 'd')] });
    e.hit('DL', 1000);
    expect(e.hit('DR', 1010)).toEqual([noteEvent(0, 'great', 0, 'DL', true, true)]);
    expect(e.noteView(1).status).toBe('pending');
    expect(e.firstPending()).toBe(1);
    expect(e.hit('DL', 1020)).toEqual([noteEvent(1, 'great', 0, 'DL')]);
    expect(e.state.combo).toBe(2);
  });

  it('a partner press after the window caps the big note at OK and goes to the next note', () => {
    const e = engineOf({ notes: [note(1000, 'd', true), note(1050, 'd')] });
    e.hit('DL', 1000);
    expect(e.hit('DR', 1040)).toEqual([noteEvent(0, 'ok', 0, 'DL', true, false), noteEvent(1, 'great', -10, 'DR')]);
    expect(e.noteView(0).strong).toBe(false);
    expect(e.state.combo).toBe(2);
  });

  it('any other key inside the window caps the big note at OK and is judged normally', () => {
    const e = engineOf({ notes: [note(1000, 'd', true), note(1010, 'k')] });
    e.hit('DL', 1000);
    expect(e.hit('KL', 1010)).toEqual([noteEvent(0, 'ok', 0, 'DL', true, false), noteEvent(1, 'great', 0, 'KL')]);
    expect(e.noteView(0)).toEqual({ status: 'hit', judgement: 'ok', awaitingPartner: false, strong: false });
    // The window is closed for good: the real partner now finds nothing.
    expect(e.hit('DR', 1015)).toEqual([]);
    expect(e.state.score).toBe(Math.round((1_000_000 * 1.5) / 2));
  });

  it('the same key again caps the big note and is judged against the next note', () => {
    const e = engineOf({ notes: [note(1000, 'd', true), note(1020, 'd')] });
    e.hit('DL', 1000);
    expect(e.hit('DL', 1012)).toEqual([noteEvent(0, 'ok', 0, 'DL', true, false), noteEvent(1, 'great', -8, 'DL')]);
    expect(e.noteView(0).awaitingPartner).toBe(false);
  });

  it('a non-partner key with nothing to hit still closes the window', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    e.hit('DL', 1000);
    expect(e.hit('KR', 1010)).toEqual([noteEvent(0, 'ok', 0, 'DL', true, false)]);
    expect(e.noteView(0).awaitingPartner).toBe(false);
    expect(e.hit('DR', 1015)).toEqual([]);
  });

  it('a press still expires the window exactly at bigWindowMs even if a lagging tick ran in between', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    e.hit('DL', 1000);
    e.tick(1000 + BIG + 50); // inside the tick grace: window stays open
    expect(e.noteView(0).awaitingPartner).toBe(true);
    expect(e.hit('DR', 1000 + BIG)).toEqual([noteEvent(0, 'great', 0, 'DL', true, true)]);
  });

  it('a first hand that judges as miss is missed immediately with its delta and gets no window', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    expect(e.hit('DL', 1000 + OK + 5)).toEqual([noteEvent(0, 'miss', OK + 5, 'DL', true, false)]);
    expect(e.noteView(0)).toEqual({ status: 'missed', judgement: 'miss', awaitingPartner: false, strong: false });
    expect(e.hit('DR', 1000 + OK + 10)).toEqual([]);
    expect(e.state.combo).toBe(0);
  });

  it('a wrong-type first press misses the big note with no window', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)] });
    expect(e.hit('KL', 1000)).toEqual([noteEvent(0, 'miss', null, 'KL', true, false)]);
    expect(e.noteView(0).awaitingPartner).toBe(false);
    expect(e.hit('KR', 1005)).toEqual([]);
  });

  it('a big note missed by time-out reports big=true and no key', () => {
    const e = engineOf({ notes: [note(1000, 'k', true)] });
    expect(e.tick(1000 + MISS + 1)).toEqual([noteEvent(0, 'miss', null, null, true, false)]);
  });

  it('overdue later notes are settled while a window is open, and the partner still lands', () => {
    const e = engineOf({ notes: [note(1000, 'd', true), note(1010, 'd')] });
    e.hit('DL', 1000 + OK); // 1080, window until 1110
    e.tick(1010 + MISS + 1); // 1106: note 1 overdue, window still open
    expect(e.noteView(1).status).toBe('missed');
    expect(e.noteView(0).awaitingPartner).toBe(true);
    expect(e.hit('DR', 1108)).toEqual([noteEvent(0, 'ok', OK, 'DL', true, true)]);
  });

  it('every note weighs the same: two big notes hit with one hand each = 50%', () => {
    const e = engineOf({ notes: [note(1000, 'd', true), note(2000, 'k', true)] });
    e.hit('DL', 1000);
    e.hit('KR', 2000);
    e.tick(2000 + TICK_PARTNER_LIMIT + 1);
    expect(e.state.counts).toEqual({ great: 0, ok: 2, miss: 0 });
    expect(e.state.score).toBe(500_000);
    expect(e.state.accuracy).toBe(0.5);
  });
});

describe('rolls', () => {
  it('any key during an active roll ticks it when no note is a candidate', () => {
    // 400 ms per beat (helpers.ts) → an eighth is 200 ms → this 500 ms roll expects 2 ticks for full credit.
    const e = engineOf({ rolls: [roll(1000, 1500)] });
    expect(expectedRollTicks(e.chart, 1000, 1500)).toBe(2);
    expect(e.hit('DL', 1000)).toEqual([rollTick(0, 'DL')]);
    expect(e.state.score).toBe(500_000);
    expect(e.hit('KR', 1250)).toEqual([rollTick(0, 'KR')]);
    expect(e.state.score).toBe(1_000_000);
    expect(e.hit('DR', 1500)).toEqual([rollTick(0, 'DR')]);
    expect(e.state.rollTicks).toBe(3);
    expect(e.state.score).toBe(1_000_000); // extra ticks are counted but earn nothing more
    expect(e.state.accuracy).toBe(1);
    expect(e.state.combo).toBe(0);
    expect(e.state.judged).toBe(0);
  });

  it('presses before t or after end do nothing', () => {
    const e = engineOf({ rolls: [roll(1000, 1500)] });
    expect(e.hit('DL', 999.999)).toEqual([]);
    expect(e.hit('DL', 1500.001)).toEqual([]);
    expect(e.state.rollTicks).toBe(0);
    expect(e.log).toHaveLength(2);
  });

  it('never steals a press from a note candidate', () => {
    const e = engineOf({ notes: [note(1200, 'k')], rolls: [roll(1000, 1500)] });
    expect(e.hit('KL', 1200)).toEqual([noteEvent(0, 'great', 0, 'KL')]);
    expect(e.state.rollTicks).toBe(0);
    // Wrong type inside the note's window also goes to the note, not the roll.
    const wrong = engineOf({ notes: [note(1200, 'k')], rolls: [roll(1000, 1500)] });
    expect(wrong.hit('DL', 1200 + MISS)).toEqual([noteEvent(0, 'miss', null, 'DL')]);
    expect(wrong.state.rollTicks).toBe(0);
  });

  it('takes presses that are too early for the next note', () => {
    const e = engineOf({ notes: [note(1400)], rolls: [roll(1000, 1300)] });
    expect(e.hit('DL', 1100)).toEqual([rollTick(0, 'DL')]);
    expect(e.noteView(0).status).toBe('pending');
    expect(e.hit('DL', 1400)).toEqual([noteEvent(0, 'great', 0, 'DL')]);
  });

  it('big rolls tick the same way, one tick per press', () => {
    const e = engineOf({ rolls: [roll(1000, 1500, true)] });
    e.hit('DL', 1100);
    e.hit('DR', 1105);
    expect(e.state.rollTicks).toBe(2);
  });

  it('reports the chart index even when rolls are not listed in time order', () => {
    const e = engineOf({ rolls: [roll(3000, 3500), roll(1000, 1500)] });
    expect(e.hit('DL', 1200)).toEqual([rollTick(1, 'DL')]);
    expect(e.hit('DL', 3200)).toEqual([rollTick(0, 'DL')]);
  });

  it('back-to-back rolls each take their own presses', () => {
    const e = engineOf({ rolls: [roll(1000, 1500), roll(1500, 2000)] });
    expect(e.hit('DL', 1500)).toEqual([rollTick(0, 'DL')]);
    expect(e.hit('DL', 1600)).toEqual([rollTick(1, 'DL')]);
  });
});

describe('spinners', () => {
  it('first press of either type counts; then the type must alternate', () => {
    const e = engineOf({ spinners: [spinner(1000, 2000, 3)] });
    expect(e.hit('KL', 1000)).toEqual([spinnerTick(0, 'KL', 2)]);
    expect(e.hit('KR', 1100)).toEqual([]); // same type: ignored
    expect(e.hit('KL', 1150)).toEqual([]);
    expect(e.hit('DL', 1200)).toEqual([spinnerTick(0, 'DL', 1)]);
    expect(e.hit('DR', 1250)).toEqual([]);
    expect(e.state.score).toBe(666_667);
    expect(e.hit('KR', 1300)).toEqual([spinnerTick(0, 'KR', 0)]);
    expect(e.state.spinnerTicks).toBe(3);
    expect(e.log).toHaveLength(6);
    expect(e.state.score).toBe(1_000_000);
    expect(e.state.accuracy).toBe(1);
    expect(e.state.combo).toBe(0);
  });

  it('keeps counting after completion with remaining floored at 0', () => {
    const e = engineOf({ spinners: [spinner(1000, 2000, 1)] });
    expect(e.hit('DL', 1000)).toEqual([spinnerTick(0, 'DL', 0)]);
    expect(e.hit('KL', 1100)).toEqual([spinnerTick(0, 'KL', 0)]);
    expect(e.state.spinnerTicks).toBe(2);
  });

  it('presses outside [t, end] do nothing', () => {
    const e = engineOf({ spinners: [spinner(1000, 2000, 3)] });
    expect(e.hit('DL', 999.9)).toEqual([]);
    expect(e.hit('DL', 2000.1)).toEqual([]);
    expect(e.hit('DL', 2000)).toEqual([spinnerTick(0, 'DL', 2)]);
  });

  it('emits spinner-end once songMs is strictly past end, with completed = ticks ≥ hits', () => {
    const done = engineOf({ spinners: [spinner(1000, 2000, 2)] });
    done.hit('DL', 1100);
    done.hit('KL', 1200);
    expect(done.tick(2000)).toEqual([]);
    expect(done.tick(2000.001)).toEqual([spinnerEnd(0, true)]);
    expect(done.tick(2500)).toEqual([]);

    const short = engineOf({ spinners: [spinner(1000, 2000, 2)] });
    short.hit('DL', 1100);
    expect(short.tick(2001)).toEqual([spinnerEnd(0, false)]);

    const untouched = engineOf({ spinners: [spinner(1000, 2000, 0)] });
    expect(untouched.tick(2001)).toEqual([spinnerEnd(0, true)]);
  });

  it('an ended spinner takes no more presses (a tick that ran ahead of a late press)', () => {
    const e = engineOf({ spinners: [spinner(1000, 2000, 5)] });
    e.tick(2001);
    expect(e.hit('DL', 1999)).toEqual([]);
    expect(e.state.spinnerTicks).toBe(0);
  });

  it('a note candidate and an active roll both take precedence', () => {
    const withNote = engineOf({ notes: [note(1500)], spinners: [spinner(1000, 2000, 3)] });
    expect(withNote.hit('DL', 1500)).toEqual([noteEvent(0, 'great', 0, 'DL')]);
    expect(withNote.state.spinnerTicks).toBe(0);
    expect(withNote.hit('KL', 1700)).toEqual([spinnerTick(0, 'KL', 2)]);

    const withRoll = engineOf({ rolls: [roll(1000, 1500)], spinners: [spinner(1000, 2000, 3)] });
    expect(withRoll.hit('DL', 1200)).toEqual([rollTick(0, 'DL')]);
    expect(withRoll.hit('DL', 1600)).toEqual([spinnerTick(0, 'DL', 2)]);
  });

  it('reports chart indices and ends in end order regardless of listing order', () => {
    const e = engineOf({ spinners: [spinner(3000, 4000, 1), spinner(1000, 2000, 1)] });
    expect(e.hit('DL', 1500)).toEqual([spinnerTick(1, 'DL', 0)]);
    expect(e.tick(2500)).toEqual([spinnerEnd(1, true)]);
    expect(e.tick(4500)).toEqual([spinnerEnd(0, false)]);
  });
});

describe('score, accuracy and combo', () => {
  const spec: ChartSpec = {
    notes: [note(1000, 'd'), note(2000, 'd', true), note(3000, 'k'), note(4000, 'k'), note(5000, 'd')],
  };
  // max weights: 1 + 2 + 1 + 1 + 1 = 6

  it('follows earned / maxTotal for the score and earned / maxJudged for accuracy', () => {
    const e = engineOf(spec);
    e.hit('DL', 1000); // great: 1 of 5 notes
    expect(e.state.score).toBe(Math.round(1_000_000 / 5));
    expect(e.state.accuracy).toBe(1);

    e.hit('DR', 2000); // big, first hand: nothing yet (awaiting the partner)
    expect(e.state.accuracy).toBe(1);
    expect(e.state.score).toBe(Math.round(1_000_000 / 5));

    e.hit('KL', 3000 + OK); // closes the big note as ok (0.5), then ok (0.5)
    expect(e.state.accuracy).toBe(2 / 3);
    expect(e.state.score).toBe(Math.round((1_000_000 * 2) / 5));

    e.tick(4000 + MISS + 1); // miss: 0
    expect(e.state.accuracy).toBe(2 / 4);

    e.hit('DL', 5000); // great: 1
    expect(e.state.accuracy).toBe(3 / 5);
    expect(e.state.score).toBe(600_000);
    expect(e.state.counts).toEqual({ great: 2, ok: 2, miss: 1 });
    expect(e.state.judged).toBe(5);
  });

  it('one hand caps a big note at OK; both hands take its timing', () => {
    const single = engineOf(spec);
    single.hit('DL', 1000);
    single.hit('DR', 2000);
    single.hit('KL', 3000);
    single.hit('KL', 4000);
    single.hit('DL', 5000);
    expect(single.state.score).toBe(900_000);
    expect(single.state.accuracy).toBe(0.9);
    expect(single.state.counts).toEqual({ great: 4, ok: 1, miss: 0 });

    const strong = engineOf(spec);
    strong.hit('DL', 1000);
    strong.hit('DR', 2000);
    strong.hit('DL', 2010);
    strong.hit('KL', 3000);
    strong.hit('KL', 4000);
    strong.hit('DL', 5000);
    expect(strong.state.score).toBe(1_000_000);
    expect(strong.state.accuracy).toBe(1);
    expect(strong.state.counts).toEqual({ great: 5, ok: 0, miss: 0 });
    expect(strong.state.maxCombo).toBe(5);
  });

  it('combo counts each non-miss note once (not per hand) and resets on a miss', () => {
    const e = engineOf(spec);
    e.hit('DL', 1000);
    e.hit('DR', 2000); // first hand: not judged yet
    expect(e.state.combo).toBe(1);
    e.hit('DL', 2005); // both hands: one note, one combo
    expect(e.state.combo).toBe(2);
    e.hit('KL', 3000);
    expect(e.state.combo).toBe(3);
    e.hit('DL', 4000); // wrong type
    expect(e.state.combo).toBe(0);
    expect(e.state.maxCombo).toBe(3);
    e.hit('DL', 5000);
    expect(e.state.combo).toBe(1);
    expect(e.state.maxCombo).toBe(3);
  });

  it('rounds to the nearest integer', () => {
    const e = engineOf({ notes: [note(1000), note(2000), note(3000)] });
    e.hit('DL', 1000);
    expect(e.state.score).toBe(333_333);
    e.hit('DL', 2000);
    expect(e.state.score).toBe(666_667);
    e.hit('DL', 3000);
    expect(e.state.score).toBe(1_000_000);
  });

  it('the score never decreases', () => {
    const e = engineOf({ notes: [note(1000, 'd', true), note(1100), note(1200, 'k'), note(1300, 'd', true)] });
    let last = 0;
    const check = () => {
      expect(e.state.score).toBeGreaterThanOrEqual(last);
      last = e.state.score;
    };
    e.hit('DL', 1000);
    check();
    e.hit('DR', 1010);
    check();
    e.hit('KL', 1100);
    check(); // wrong type
    e.tick(1400);
    check(); // note 2 and 3 timed out
    e.tick(2000);
    check();
    expect(e.state.score).toBe(Math.round(1_000_000 / 4));
  });

  it('rolls and spinners each weigh one note in the score and never touch accuracy', () => {
    // 3 objects: one note, one roll (expects 2 ticks), one spinner (2 hits).
    const e = engineOf({ notes: [note(5000)], rolls: [roll(1000, 1500)], spinners: [spinner(2000, 3000, 2)] });
    e.hit('DL', 1100);
    expect(e.state.score).toBe(Math.round(1_000_000 * 0.5 / 3));
    e.hit('DL', 1200);
    expect(e.state.score).toBe(Math.round(1_000_000 / 3));
    e.hit('DL', 2100);
    e.hit('KL', 2200);
    expect(e.state.rollTicks).toBe(2);
    expect(e.state.spinnerTicks).toBe(2);
    expect(e.state.score).toBe(666_667);
    expect(e.state.accuracy).toBe(1);
    expect(e.state.judged).toBe(0);
    e.hit('DL', 5000);
    expect(e.state.score).toBe(1_000_000);
    e.tick(6000);
    expect(e.state.finished).toBe(true);
  });

  it('an unplayed roll or spinner simply earns nothing: no miss, no combo break', () => {
    const e = engineOf({ notes: [note(1000), note(4000)], rolls: [roll(2000, 2500)], spinners: [spinner(3000, 3500, 4)] });
    e.hit('DL', 1000);
    e.hit('DL', 4000);
    e.tick(5000);
    expect(e.state.counts).toEqual({ great: 2, ok: 0, miss: 0 });
    expect(e.state.combo).toBe(2);
    expect(e.state.score).toBe(500_000);
    expect(e.state.accuracy).toBe(1);
    expect(e.state.finished).toBe(true);
  });

  it('expectedRollTicks follows the tempo at the roll and never drops below one', () => {
    const c = chart({ rolls: [roll(1000, 1100)] }); // 400 ms per beat
    expect(expectedRollTicks(c, 1000, 1100)).toBe(1);
    expect(expectedRollTicks(c, 1000, 2000)).toBe(5);
    const twoTempi = { ...c, timing: [{ t: 0, beatLength: 500, meter: 4 }, { t: 5000, beatLength: 250, meter: 4 }] };
    expect(expectedRollTicks(twoTempi, 1000, 2000)).toBe(4);
    expect(expectedRollTicks(twoTempi, 5000, 6000)).toBe(8);
    expect(expectedRollTicks({ ...c, timing: [] }, 1000, 2000)).toBe(2); // 1000 ms per beat fallback
  });
});

describe('finished', () => {
  it('becomes true on the tick after the last note is judged, even before its time', () => {
    const e = engineOf({ notes: [note(1000), note(2000)] });
    e.hit('DL', 1000);
    e.hit('DL', 1970);
    expect(e.state.finished).toBe(false); // hit() never sets it
    e.tick(1980);
    expect(e.state.finished).toBe(true);
  });

  it('waits for time-out misses', () => {
    const e = engineOf({ notes: [note(1000)] });
    e.tick(1000 + MISS);
    expect(e.state.finished).toBe(false);
    e.tick(1000 + MISS + 1);
    expect(e.state.finished).toBe(true);
  });

  it('waits for the last roll to end and every spinner to end', () => {
    const e = engineOf({ notes: [note(1000)], rolls: [roll(2000, 3000)], spinners: [spinner(4000, 5000, 1)] });
    e.hit('DL', 1000);
    e.tick(3000);
    expect(e.state.finished).toBe(false);
    e.tick(3001);
    expect(e.state.finished).toBe(false); // spinner not ended
    e.tick(5000);
    expect(e.state.finished).toBe(false);
    expect(e.tick(5001)).toEqual([spinnerEnd(0, false)]);
    expect(e.state.finished).toBe(true);
  });

  it('waits for an open partner window', () => {
    const both = engineOf({ notes: [note(1000, 'd', true)] });
    both.hit('DL', 1000);
    both.tick(1010);
    expect(both.state.finished).toBe(false);
    both.hit('DR', 1015);
    both.tick(1020);
    expect(both.state.finished).toBe(true);

    const single = engineOf({ notes: [note(1000, 'd', true)] });
    single.hit('DL', 1000);
    single.tick(1010);
    expect(single.state.finished).toBe(false);
    single.tick(1000 + TICK_PARTNER_LIMIT + 1);
    expect(single.state.finished).toBe(true);
    expect(single.state.counts.ok).toBe(1);
  });

  it('is sticky across lagging ticks', () => {
    const e = engineOf({ notes: [note(1000)], rolls: [roll(2000, 3000)] });
    e.hit('DL', 1000);
    e.tick(3001);
    expect(e.state.finished).toBe(true);
    e.tick(2500);
    expect(e.state.finished).toBe(true);
  });
});

describe('log', () => {
  it('records every press as [t, key] in arrival order, whatever it did', () => {
    const e = engineOf({ notes: [note(1000, 'd', true)], spinners: [spinner(2000, 3000, 2)] });
    e.hit('KL', 100); // too early
    e.hit('DL', 1000); // big first hand
    e.hit('DR', 1010); // strong
    e.hit('DR', 1020); // nothing
    e.hit('DL', 2100); // spinner
    e.hit('DR', 2200); // ignored, same type
    e.tick(4000);
    expect(e.log).toEqual([
      [100, 'KL'],
      [1000, 'DL'],
      [1010, 'DR'],
      [1020, 'DR'],
      [2100, 'DL'],
      [2200, 'DR'],
    ]);
    for (const entry of e.log) expect(entry).toHaveLength(2);
  });
});

describe('firstPending', () => {
  it('tracks the cursor through hits, misses and a big note awaiting its partner', () => {
    const e = engineOf({ notes: [note(1000), note(2000, 'd', true), note(3000)] });
    expect(e.firstPending()).toBe(0);
    e.hit('DL', 1000);
    expect(e.firstPending()).toBe(1);
    e.hit('DL', 2000);
    expect(e.firstPending()).toBe(1); // still pending, awaiting the partner
    e.hit('DR', 2010);
    expect(e.firstPending()).toBe(2);
    e.tick(3000 + MISS + 1);
    expect(e.firstPending()).toBe(3);
  });

  it('keys are mapped to types consistently with keyOf', () => {
    expect(keyOf('d', 'L')).toBe('DL');
    expect(keyOf('k', 'R')).toBe('KR');
  });
});
