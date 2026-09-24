/**
 * Property-style determinism: live play with arbitrary (lagging) tick cadences
 * must produce exactly the state replay() rebuilds from the log alone, and
 * the same multiset of events per note.
 */
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/core/engine.ts';
import { replay } from '../../src/core/replay.ts';
import {
  keyKind,
  type Chart,
  type ChartNote,
  type ChartRoll,
  type ChartSpinner,
  type EngineConfig,
  type EngineEvent,
  type Hand,
  type InputLogEntry,
  type Key,
  type NoteKind,
} from '../../src/core/types.ts';
import { defaultConfig } from '../../src/core/windows.ts';
import { canonical, chart, keyOf, mulberry32, views } from './helpers.ts';

type Rng = () => number;

const flip = (k: NoteKind): NoteKind => (k === 'd' ? 'k' : 'd');
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
/** Quarter-millisecond floats: exercises non-integer hit times without drowning in noise. */
const q = (x: number): number => Math.round(x * 4) / 4;

function randomChart(rng: Rng): { chart: Chart; config: EngineConfig } {
  const od = Math.round(rng() * 100) / 10;
  // Half the cases use the game's fixed windows, half a config with a consumed-miss band (ok < miss).
  const config = rng() < 0.5 ? defaultConfig(od) : { windows: { great: 35, ok: 80, miss: 95 }, bigWindowMs: 30 };

  const notes: ChartNote[] = [];
  let t = 200 + Math.floor(rng() * 800);
  const count = 3 + Math.floor(rng() * 58);
  for (let i = 0; i < count; i++) {
    notes.push({ t, k: rng() < 0.5 ? 'd' : 'k', big: rng() < 0.3 });
    // Mostly playable gaps, often dense (inside the previous miss window), rarely stacked.
    const r = rng();
    t += r < 0.04 ? 0 : r < 0.35 ? 15 + Math.floor(rng() * 90) : 100 + Math.floor(rng() * 500);
  }
  const lastNoteT = notes[notes.length - 1]!.t;

  // 30 % of charts scatter rolls/spinners over the notes (never happens in osu, must still be deterministic).
  const chaotic = rng() < 0.3;
  let tail = lastNoteT + 300;
  const rolls: ChartRoll[] = [];
  const spinners: ChartSpinner[] = [];
  const rollCount = Math.floor(rng() * 4);
  for (let i = 0; i < rollCount; i++) {
    const len = 50 + Math.floor(rng() * 1200);
    const start = chaotic ? Math.floor(rng() * (lastNoteT + 500)) : tail;
    rolls.push({ t: start, end: start + len, big: rng() < 0.3 });
    if (!chaotic) tail += len + 300;
  }
  const spinnerCount = Math.floor(rng() * 3);
  for (let i = 0; i < spinnerCount; i++) {
    const len = 200 + Math.floor(rng() * 2000);
    const start = chaotic ? Math.floor(rng() * (lastNoteT + 500)) : tail;
    spinners.push({ t: start, end: start + len, hits: 1 + Math.floor(rng() * 12) });
    if (!chaotic) tail += len + 300;
  }
  // The engine must not depend on the chart order of rolls/spinners.
  if (rng() < 0.3) {
    rolls.reverse();
    spinners.reverse();
  }

  return { chart: chart({ notes, rolls, spinners, od }), config };
}

function randomPresses(rng: Rng, c: Chart, config: EngineConfig): InputLogEntry[] {
  const { great, ok, miss } = config.windows;
  const presses: [number, Key][] = [];
  const hand = (): Hand => (rng() < 0.5 ? 'L' : 'R');
  const anyKey = (): Key => keyOf(rng() < 0.5 ? 'd' : 'k', hand());

  for (const n of c.notes) {
    if (rng() < 0.9) {
      const kind = rng() < 0.85 ? n.k : flip(n.k);
      const h = hand();
      const r = rng();
      let t: number;
      if (r < 0.1) t = n.t;
      else if (r < 0.25) t = n.t + pick(rng, [great, ok, miss, -great, -ok, -miss]); // exact boundaries
      else t = q(n.t + (rng() * 2 - 1) * (miss + 40));
      presses.push([t, keyOf(kind, h)]);

      if (n.big && rng() < 0.75) {
        const r2 = rng();
        const second: Key =
          r2 < 0.7 ? keyOf(kind, h === 'L' ? 'R' : 'L') : r2 < 0.85 ? keyOf(kind, h) : keyOf(flip(kind), hand());
        const gap = rng() < 0.15 ? config.bigWindowMs : rng() * 45;
        presses.push([q(t + gap), second]);
      }
    }
    if (rng() < 0.15) presses.push([q(n.t + (rng() * 2 - 1) * 300), anyKey()]);
  }

  for (const r of c.rolls) {
    const count = Math.floor(rng() * 8);
    for (let i = 0; i < count; i++) presses.push([q(r.t - 50 + rng() * (r.end - r.t + 100)), anyKey()]);
  }
  for (const s of c.spinners) {
    const count = Math.floor(rng() * (s.hits + 4));
    let kind: NoteKind = rng() < 0.5 ? 'd' : 'k';
    for (let i = 0; i < count; i++) {
      if (rng() < 0.8) kind = flip(kind);
      presses.push([q(s.t - 20 + rng() * (s.end - s.t + 40)), keyOf(kind, hand())]);
    }
  }

  presses.sort((a, b) => a[0] - b[0]);
  return presses;
}

/** Same horizon replay() uses: past every note, roll, spinner and press, plus every window. */
function endTime(c: Chart, config: EngineConfig, presses: readonly InputLogEntry[]): number {
  let last = 0;
  for (const [t] of presses) if (t > last) last = t;
  for (const n of c.notes) if (n.t > last) last = n.t;
  for (const r of c.rolls) if (r.end > last) last = r.end;
  for (const s of c.spinners) if (s.end > last) last = s.end;
  return last + config.windows.miss + config.bigWindowMs + 1;
}

/** What a batch of cases exercised, so a generator change cannot silently hollow the test out. */
interface Coverage {
  cases: number;
  chaoticLike: number;
  strong: number;
  singleHand: number;
  great: number;
  ok: number;
  inWindowMiss: number;
  wrongType: number;
  timeoutMiss: number;
  rollTicks: number;
  spinnerTicks: number;
  spinnerEnds: number;
  spinnerCompleted: number;
  quietPresses: number;
}

function emptyCoverage(): Coverage {
  return {
    cases: 0,
    chaoticLike: 0,
    strong: 0,
    singleHand: 0,
    great: 0,
    ok: 0,
    inWindowMiss: 0,
    wrongType: 0,
    timeoutMiss: 0,
    rollTicks: 0,
    spinnerTicks: 0,
    spinnerEnds: 0,
    spinnerCompleted: 0,
    quietPresses: 0,
  };
}

function runCase(seed: number, coverage: Coverage): void {
  const rng = mulberry32(seed);
  const { chart: c, config } = randomChart(rng);
  const presses = randomPresses(rng, c, config);
  const end = endTime(c, config, presses);

  // Live: ticks at random times before each press, including times earlier than presses already
  // processed (a frame that ran late), and a burst of ticks around the end.
  const live = createEngine(c, config);
  const liveEvents: EngineEvent[] = [];
  let lastScore = 0;
  for (const [t, key] of presses) {
    const ticks = Math.floor(rng() * 4);
    for (let i = 0; i < ticks; i++) liveEvents.push(...live.tick(t - rng() * 250));
    const produced = live.hit(key, t);
    if (produced.length === 0) coverage.quietPresses += 1;
    liveEvents.push(...produced);
    expect(live.state.score).toBeGreaterThanOrEqual(lastScore);
    lastScore = live.state.score;
  }
  for (let i = 0; i < 3; i++) liveEvents.push(...live.tick(end - rng() * 200));
  liveEvents.push(...live.tick(end));

  // Reference: presses only, then one tick at the end.
  const reference = createEngine(c, config);
  const referenceEvents: EngineEvent[] = [];
  for (const [t, key] of presses) referenceEvents.push(...reference.hit(key, t));
  referenceEvents.push(...reference.tick(end));

  expect(live.state).toStrictEqual(reference.state);
  expect(views(live)).toStrictEqual(views(reference));
  expect(canonical(liveEvents)).toStrictEqual(canonical(referenceEvents));
  expect(live.log).toStrictEqual(presses);
  expect(replay(c, config, live.log)).toStrictEqual(live.state);

  // Invariants of a finished run.
  const s = live.state;
  expect(s.finished).toBe(true);
  expect(s.judged).toBe(c.notes.length);
  expect(s.counts.great + s.counts.ok + s.counts.miss).toBe(c.notes.length);
  expect(s.maxCombo).toBeLessThanOrEqual(c.notes.length);
  expect(s.combo).toBeLessThanOrEqual(s.maxCombo);
  expect(s.score).toBeGreaterThanOrEqual(0);
  expect(s.score).toBeLessThanOrEqual(1_000_000);
  expect(s.accuracy).toBeGreaterThanOrEqual(0);
  expect(s.accuracy).toBeLessThanOrEqual(1);
  const noteIndices = liveEvents.filter((e) => e.type === 'note').map((e) => e.index);
  expect([...noteIndices].sort((a, b) => a - b)).toStrictEqual(c.notes.map((_, i) => i));
  const spinnerEnds = liveEvents.filter((e) => e.type === 'spinner-end').map((e) => e.index);
  expect([...spinnerEnds].sort((a, b) => a - b)).toStrictEqual(c.spinners.map((_, i) => i));
  for (let i = 0; i < c.notes.length; i++) {
    const v = live.noteView(i);
    expect(v.status).not.toBe('pending');
    expect(v.awaitingPartner).toBe(false);
    if (v.strong) expect(c.notes[i]!.big).toBe(true);
  }

  coverage.cases += 1;
  if (c.rolls.some((r) => r.t <= lastNoteTime(c)) || c.spinners.some((sp) => sp.t <= lastNoteTime(c))) {
    coverage.chaoticLike += 1;
  }
  for (const e of liveEvents) {
    switch (e.type) {
      case 'note':
        if (e.judgement === 'great') coverage.great += 1;
        else if (e.judgement === 'ok') coverage.ok += 1;
        else if (e.deltaMs !== null) coverage.inWindowMiss += 1;
        else if (e.key === null) coverage.timeoutMiss += 1;
        else coverage.wrongType += 1;
        if (e.strong) coverage.strong += 1;
        if (e.big && !e.strong && e.judgement === 'ok') coverage.singleHand += 1;
        break;
      case 'roll-tick':
        coverage.rollTicks += 1;
        break;
      case 'spinner-tick':
        coverage.spinnerTicks += 1;
        break;
      case 'spinner-end':
        coverage.spinnerEnds += 1;
        if (e.completed) coverage.spinnerCompleted += 1;
        break;
    }
  }
}

function lastNoteTime(c: Chart): number {
  return c.notes.length > 0 ? c.notes[c.notes.length - 1]!.t : 0;
}

function expectCoverage(coverage: Coverage): void {
  expect(coverage.cases).toBeGreaterThan(0);
  expect(coverage.chaoticLike).toBeGreaterThan(10);
  expect(coverage.great).toBeGreaterThan(500);
  expect(coverage.ok).toBeGreaterThan(300);
  expect(coverage.inWindowMiss).toBeGreaterThan(100);
  expect(coverage.wrongType).toBeGreaterThan(100);
  expect(coverage.timeoutMiss).toBeGreaterThan(100);
  expect(coverage.strong).toBeGreaterThan(50);
  expect(coverage.singleHand).toBeGreaterThan(20);
  expect(coverage.rollTicks).toBeGreaterThan(100);
  expect(coverage.spinnerTicks).toBeGreaterThan(100);
  expect(coverage.spinnerEnds).toBeGreaterThan(50);
  expect(coverage.spinnerCompleted).toBeGreaterThan(10);
  expect(coverage.spinnerCompleted).toBeLessThan(coverage.spinnerEnds);
  expect(coverage.quietPresses).toBeGreaterThan(100);
}

describe('determinism: live play with random tick cadences equals replay()', () => {
  const CASES = 200;
  it(`holds for ${CASES} random charts and press sequences (seed 0x0d1ad)`, () => {
    const coverage = emptyCoverage();
    for (let i = 0; i < CASES; i++) runCase(0x0d1ad + i, coverage);
    expectCoverage(coverage);
  });

  it('holds for a second seed family', () => {
    const coverage = emptyCoverage();
    for (let i = 0; i < CASES; i++) runCase(0x5eed + i * 7919, coverage);
    expectCoverage(coverage);
  });

  it('is repeatable: the same seed yields the same log and state', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const ca = randomChart(a);
    const cb = randomChart(b);
    expect(ca).toStrictEqual(cb);
    const pa = randomPresses(a, ca.chart, ca.config);
    const pb = randomPresses(b, cb.chart, cb.config);
    expect(pa).toStrictEqual(pb);
    expect(replay(ca.chart, ca.config, pa)).toStrictEqual(replay(cb.chart, cb.config, pb));
  });
});
