/**
 * Judgement engine (PLAN §2, §7). The rules are the Engine doc-comment in
 * ./types.ts; this file only adds the mechanics.
 *
 * Pure TypeScript: no Pixi, no Svelte, no DOM. Two entry points, tick(songMs)
 * from the frame loop and hit(key, hitMs) from input handlers, both on the
 * song clock in ms.
 *
 * Determinism: hit() settles everything that is overdue at hitMs (missed
 * notes, an expired partner window) before it judges the press, so the state
 * after a press depends only on the chart, the config and the presses so far,
 * never on when the frame loop happened to run. replay() therefore reproduces
 * live play from the log alone. The one thing the engine cannot undo is a
 * tick whose songMs is AHEAD of a press that arrives later (input events carry
 * timestamps from the past, and inputOffset moves them further back): a note
 * missed by such a tick stays missed. The play shell should therefore feed
 * tick() a clock that never runs ahead of the hit clock, e.g.
 * songMs - inputOffset - one frame; the renderer keeps using the plain clock.
 *
 * Partner windows are the one place tick() is deliberately lenient: a press
 * expires the window exactly at bigWindowMs, but tick() waits bigWindowMs +
 * windows.miss before giving up, so a second hand whose (past) timestamp is
 * still inside the window is never pre-empted by a frame that ran in between.
 * The extra wait only delays the `awaitingPartner` flag (and, in required
 * mode, the deferred miss); it never changes what a press is judged as.
 *
 * Hot paths allocate nothing except the per-press log tuple and, only when
 * something happened, the returned event array. `state` and every NoteView
 * are stable objects mutated in place.
 */
import {
  keyKind,
  partnerKey,
  type Chart,
  type ChartNote,
  type ChartRoll,
  type ChartSpinner,
  type Engine,
  type EngineConfig,
  type EngineEvent,
  type EngineState,
  type InputLogEntry,
  type Judgement,
  type Key,
  type NoteView,
} from './types.ts';

/** Shared, frozen result for every call that produced no events. */
const NO_EVENTS = Object.freeze([] as EngineEvent[]) as EngineEvent[];

/** j in the score formula: great 1, ok 0.5, miss 0. */
const JUDGEMENT_VALUE: Readonly<Record<Judgement, number>> = { great: 1, ok: 0.5, miss: 0 };

/** Spinner alternation bookkeeping: 0 = nothing yet, 1 = don, 2 = kat. */
const KIND_CODE = { d: 1, k: 2 } as const;

/** Indices of `items` ordered by `keyOf` (ties keep chart order). */
function orderBy<T>(items: readonly T[], keyOf: (item: T) => number): Int32Array {
  const order = Array.from(items, (_, i) => i);
  order.sort((a, b) => keyOf(items[a]!) - keyOf(items[b]!) || a - b);
  return Int32Array.from(order);
}

function assertSortedNotes(notes: readonly ChartNote[]): void {
  for (let i = 1; i < notes.length; i++) {
    if (notes[i]!.t < notes[i - 1]!.t) {
      throw new RangeError(`createEngine: chart.notes must be sorted by t (index ${i})`);
    }
  }
}

function snapshotConfig(input: EngineConfig): EngineConfig {
  const { great, ok, miss } = input.windows;
  const { bigWindowMs } = input;
  for (const [name, v] of [['great', great], ['ok', ok], ['miss', miss], ['bigWindowMs', bigWindowMs]] as const) {
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(`createEngine: config.${name} must be a finite non-negative number, got ${v}`);
    }
  }
  return Object.freeze({
    windows: Object.freeze({ great, ok, miss }),
    bigWindowMs,
  });
}

/** ms per beat at time t: the last uninherited timing point at or before t (the first one before it; 1000 without any). */
function beatLengthAt(chart: Chart, t: number): number {
  const timing = chart.timing;
  let beat = timing[0]?.beatLength ?? 1000;
  for (const tp of timing) {
    if (tp.t > t) break;
    beat = tp.beatLength;
  }
  return beat > 0 && Number.isFinite(beat) ? beat : 1000;
}

/** Presses that earn a roll in full: one per eighth note at the roll's tempo, at least one. */
export function expectedRollTicks(chart: Chart, t: number, end: number): number {
  const eighth = beatLengthAt(chart, t) / 2;
  return Math.max(1, Math.floor((end - t) / eighth));
}

export function createEngine(chart: Chart, input: EngineConfig): Engine {
  const notes: readonly ChartNote[] = chart.notes;
  const rolls: readonly ChartRoll[] = chart.rolls;
  const spinners: readonly ChartSpinner[] = chart.spinners;
  assertSortedNotes(notes);

  const config = snapshotConfig(input);
  const { great: greatWindow, ok: okWindow, miss: missWindow } = config.windows;
  const { bigWindowMs } = config;
  /** How long tick() keeps a partner window open past bigWindowMs (see header). */
  const partnerGraceMs = missWindow;

  // ─── state ────────────────────────────────────────────────────────────────

  const state: EngineState = {
    score: 0,
    accuracy: 1,
    combo: 0,
    maxCombo: 0,
    counts: { great: 0, ok: 0, miss: 0 },
    rollTicks: 0,
    spinnerTicks: 0,
    judged: 0,
    total: notes.length,
    finished: false,
  };
  const log: InputLogEntry[] = [];
  const views: NoteView[] = notes.map(
    (): NoteView => ({ status: 'pending', judgement: null, awaitingPartner: false, strong: false }),
  );

  /** Every note weighs 1 (a big note is one note, hit with one or two hands). */
  const maxTotal = notes.length;
  /** Σ earned over judged notes (multiples of 0.5, exact in binary). */
  let earned = 0;
  /** Judged notes. */
  let maxJudged = 0;
  /** Index of the earliest note that has not been consumed by a press or a miss. */
  let cursor = 0;

  // At most one partner window can be open: every press either lands in it or closes it.
  let bigIndex = -1;
  let bigKey: Key = 'DL';
  let bigOpenedAt = 0;
  let bigJudgement: Judgement = 'miss';
  let bigDelta = 0;

  // Rolls and spinners are looked up in t order; the chart index is what events carry.
  const rollOrder = orderBy(rolls, (r) => r.t);
  let rollCursor = 0;
  let lastRollEnd = -Infinity;
  for (const roll of rolls) if (roll.end > lastRollEnd) lastRollEnd = roll.end;

  /**
   * Bonus objects (PLAN §2): a roll is worth one note once it has been hit
   * `expected` times (one tick per eighth at the roll's tempo); a spinner is
   * worth one note once its `hits` alternating presses are in. Both fill in
   * proportionally, never miss, and never touch accuracy.
   */
  const rollExpected = new Int32Array(rolls.length);
  for (let i = 0; i < rolls.length; i++) {
    const roll = rolls[i]!;
    rollExpected[i] = expectedRollTicks(chart, roll.t, roll.end);
  }
  const rollCounted = new Int32Array(rolls.length);
  const maxBonus = rolls.length + spinners.length;
  let bonus = 0;

  const spinnerOrder = orderBy(spinners, (s) => s.t);
  const spinnerEndOrder = orderBy(spinners, (s) => s.end);
  let spinnerCursor = 0;
  let spinnerEndCursor = 0;
  const spinnerHits = new Int32Array(spinners.length);
  const spinnerLastKind = new Uint8Array(spinners.length);
  const spinnerEnded = new Uint8Array(spinners.length);

  /** Per-call event accumulator; null until the first event so quiet calls allocate nothing. */
  let out: EngineEvent[] | null = null;
  function emit(event: EngineEvent): void {
    (out ??= []).push(event);
  }

  function refreshScore(): void {
    const denominator = maxTotal + maxBonus;
    state.score = denominator === 0 ? 0 : Math.round((1_000_000 * (earned + bonus)) / denominator);
    state.accuracy = maxJudged === 0 ? 1 : earned / maxJudged;
  }

  // ─── notes ────────────────────────────────────────────────────────────────

  /** Final judgement of one note: counts, combo, score and the 'note' event. */
  function judge(
    index: number,
    judgement: Judgement,
    deltaMs: number | null,
    key: Key | null,
    strong: boolean,
    gained: number,
  ): void {
    const note = notes[index]!;
    const view = views[index]!;
    view.status = judgement === 'miss' ? 'missed' : 'hit';
    view.judgement = judgement;
    view.awaitingPartner = false;
    view.strong = strong;

    state.counts[judgement] += 1;
    state.judged += 1;
    maxJudged += 1;
    earned += gained;
    if (judgement === 'miss') state.combo = 0;
    else if (++state.combo > state.maxCombo) state.maxCombo = state.combo;
    refreshScore();

    emit({ type: 'note', index, judgement, deltaMs, key, big: note.big, strong });
  }

  /** First hand of a big note landed with great/ok: the note waits bigWindowMs for the other hand. */
  function openPartnerWindow(index: number, key: Key, hitMs: number, judgement: Judgement, delta: number): void {
    bigIndex = index;
    bigKey = key;
    bigOpenedAt = hitMs;
    bigJudgement = judgement;
    bigDelta = delta;
    views[index]!.awaitingPartner = true;
  }

  /** partnerKey(bigKey) pressed inside the window: the first hand's timing, both hands. Never touches the next note. */
  function landPartner(): void {
    const index = bigIndex;
    bigIndex = -1;
    judge(index, bigJudgement, bigDelta, bigKey, true, JUDGEMENT_VALUE[bigJudgement]);
  }

  /** Window expired or a non-partner key arrived: one hand only, so the note is capped at OK. */
  function closePartnerWindow(): void {
    const index = bigIndex;
    bigIndex = -1;
    const judgement: Judgement = bigJudgement === 'great' ? 'ok' : bigJudgement;
    judge(index, judgement, bigDelta, bigKey, false, JUDGEMENT_VALUE[judgement]);
  }

  /**
   * Everything that is overdue at `nowMs`, in the order it became due: an open
   * partner window resolves at bigOpenedAt + bigWindowMs, a pending note times
   * out at t + windows.miss. Keeping that order identical for ticks and presses
   * is what makes combo/maxCombo a pure function of the log. A tick may not
   * close the window before the grace has passed; while it waits, notes that
   * would become due after the window's expiry wait too.
   */
  function settle(nowMs: number, partnerLimitMs: number): void {
    while (cursor < notes.length && nowMs - notes[cursor]!.t > missWindow) {
      if (bigIndex >= 0 && bigOpenedAt + bigWindowMs < notes[cursor]!.t + missWindow) {
        if (nowMs - bigOpenedAt > partnerLimitMs) closePartnerWindow();
        else break;
      }
      judge(cursor++, 'miss', null, null, false, 0);
    }
    if (bigIndex >= 0 && nowMs - bigOpenedAt > partnerLimitMs) closePartnerWindow();
    // Rolls and spinners that ended more than a miss window ago are never scanned again.
    // The tolerance keeps slightly out-of-order presses (or a frame that ran ahead) from
    // losing a roll or spinner that is still active at the press's own time.
    while (rollCursor < rollOrder.length && nowMs - rolls[rollOrder[rollCursor]!]!.end > missWindow) rollCursor++;
    while (
      spinnerCursor < spinnerOrder.length &&
      nowMs - spinners[spinnerOrder[spinnerCursor]!]!.end > missWindow
    ) {
      spinnerCursor++;
    }
  }

  // ─── rolls and spinners ───────────────────────────────────────────────────

  /** A press with no note candidate: the earliest active roll takes it. */
  function tickRoll(key: Key, hitMs: number): boolean {
    for (let k = rollCursor; k < rollOrder.length; k++) {
      const index = rollOrder[k]!;
      const roll = rolls[index]!;
      if (roll.t > hitMs) break;
      if (hitMs > roll.end) continue;
      state.rollTicks += 1;
      const expected = rollExpected[index]!;
      if (rollCounted[index]! < expected) {
        rollCounted[index] = rollCounted[index]! + 1;
        bonus += 1 / expected;
        refreshScore();
      }
      emit({ type: 'roll-tick', index, key });
      return true;
    }
    return false;
  }

  /** A press with no note candidate and no active roll: the earliest active spinner takes it if the type alternates. */
  function tickSpinner(key: Key, hitMs: number): boolean {
    for (let k = spinnerCursor; k < spinnerOrder.length; k++) {
      const index = spinnerOrder[k]!;
      const spinner = spinners[index]!;
      if (spinner.t > hitMs) break;
      if (hitMs > spinner.end || spinnerEnded[index] === 1) continue;
      const kind = KIND_CODE[keyKind(key)];
      if (spinnerLastKind[index] === kind) return false;
      spinnerLastKind[index] = kind;
      const hits = spinnerHits[index]! + 1;
      spinnerHits[index] = hits;
      state.spinnerTicks += 1;
      const required = Math.max(1, spinner.hits);
      if (hits <= required) {
        bonus += 1 / required;
        refreshScore();
      }
      emit({ type: 'spinner-tick', index, key, remaining: Math.max(0, spinner.hits - hits) });
      return true;
    }
    return false;
  }

  // ─── entry points ─────────────────────────────────────────────────────────

  function tick(songMs: number): EngineEvent[] {
    if (!Number.isFinite(songMs)) throw new RangeError(`tick: songMs must be finite, got ${songMs}`);
    out = null;

    settle(songMs, bigWindowMs + partnerGraceMs);

    while (spinnerEndCursor < spinnerEndOrder.length) {
      const index = spinnerEndOrder[spinnerEndCursor]!;
      const spinner = spinners[index]!;
      if (!(songMs > spinner.end)) break;
      spinnerEnded[index] = 1;
      spinnerEndCursor++;
      emit({ type: 'spinner-end', index, completed: spinnerHits[index]! >= spinner.hits });
    }

    if (
      !state.finished &&
      state.judged === state.total &&
      bigIndex < 0 &&
      spinnerEndCursor === spinners.length &&
      songMs > lastRollEnd
    ) {
      state.finished = true;
    }

    return out ?? NO_EVENTS;
  }

  function hit(key: Key, hitMs: number): EngineEvent[] {
    if (!Number.isFinite(hitMs)) throw new RangeError(`hit: hitMs must be finite, got ${hitMs}`);
    out = null;
    log.push([hitMs, key]);

    // 1. Settle first, so the outcome is a function of the log alone.
    settle(hitMs, bigWindowMs);

    // 4. An open partner window: the partner lands, anything else closes it and is judged normally.
    if (bigIndex >= 0) {
      if (key === partnerKey(bigKey)) {
        landPartner();
        return out ?? NO_EVENTS;
      }
      closePartnerWindow();
    }

    // 2./3. Candidate = earliest pending note inside the miss window.
    if (cursor < notes.length) {
      const note = notes[cursor]!;
      const delta = hitMs - note.t;
      const distance = Math.abs(delta);
      if (distance <= missWindow) {
        const index = cursor++;
        if (keyKind(key) !== note.k) {
          judge(index, 'miss', null, key, false, 0);
        } else {
          const judgement: Judgement = distance <= greatWindow ? 'great' : distance <= okWindow ? 'ok' : 'miss';
          if (note.big && judgement !== 'miss') openPartnerWindow(index, key, hitMs, judgement, delta);
          else judge(index, judgement, delta, key, false, JUDGEMENT_VALUE[judgement]);
        }
        return out ?? NO_EVENTS;
      }
      // Too early (delta < -miss): consumes no note. Rolls and spinners may still take it.
    }

    // 5. No candidate.
    if (!tickRoll(key, hitMs)) tickSpinner(key, hitMs);
    return out ?? NO_EVENTS;
  }

  function noteView(index: number): NoteView {
    const view = views[index];
    if (!view) throw new RangeError(`noteView: index ${index} out of range [0, ${notes.length})`);
    return view;
  }

  function firstPending(): number {
    // The note waiting for its partner is still pending and sits below the cursor.
    return bigIndex >= 0 ? bigIndex : cursor;
  }

  return { chart, config, state, log, tick, hit, noteView, firstPending };
}
