/**
 * Core contracts.
 *
 * src/core is framework-free TypeScript: no Pixi, no Svelte, no DOM beyond
 * `globalThis.crypto.subtle` (available in Node ≥ 19 and every target browser).
 * The only entry points into the engine are `tick(songMs)` and `hit(key, hitMs)`.
 * All times are milliseconds on the song clock (AudioContext-derived, see PLAN §7).
 */

// ─── Chart (PLAN §4) ────────────────────────────────────────────────────────

export type NoteKind = 'd' | 'k';

export interface ChartMeta {
  title: string;
  artist: string;
  difficulty: string;
  /** [min, max] BPM over uninherited timing points. */
  bpm: [number, number];
  od: number;
  hp: number;
}

export interface ChartTiming {
  /** Integer ms. */
  t: number;
  /** ms per beat (positive). */
  beatLength: number;
  /** beats per bar. */
  meter: number;
}

export interface ChartNote {
  /** Integer ms. */
  t: number;
  k: NoteKind;
  big: boolean;
}

export interface ChartRoll {
  t: number;
  end: number;
  big: boolean;
}

export interface ChartSpinner {
  t: number;
  end: number;
  /** Required alternating hits to complete. */
  hits: number;
}

export interface Chart {
  version: 1;
  meta: ChartMeta;
  /** Uninherited timing points only, sorted by t. */
  timing: ChartTiming[];
  /** Sorted by t. Every t is an integer. */
  notes: ChartNote[];
  rolls: ChartRoll[];
  spinners: ChartSpinner[];
  /** sha256 hex of canonicalChartBody(); excludes meta. Records key on this. */
  hash: string;
}

/** The hashed part of a chart. Field order is the canonical order. */
export type ChartBody = Pick<Chart, 'timing' | 'notes' | 'rolls' | 'spinners'>;

// ─── Keys (PLAN §2) ─────────────────────────────────────────────────────────

/** Pad is 2×2. Row = type (K = kat top, D = don bottom), column = hand. */
export type Key = 'KL' | 'KR' | 'DL' | 'DR';
export type Hand = 'L' | 'R';

export const KEYS: readonly Key[] = ['KL', 'KR', 'DL', 'DR'];

export function keyKind(key: Key): NoteKind {
  return key[0] === 'K' ? 'k' : 'd';
}

export function keyHand(key: Key): Hand {
  return key[1] === 'L' ? 'L' : 'R';
}

/** The other hand's key of the same type. */
export function partnerKey(key: Key): Key {
  switch (key) {
    case 'KL': return 'KR';
    case 'KR': return 'KL';
    case 'DL': return 'DR';
    case 'DR': return 'DL';
  }
}

// ─── Judgement (PLAN §2) ────────────────────────────────────────────────────

export type Judgement = 'great' | 'ok' | 'miss';

/** Half-widths in ms. great ⊂ ok ⊂ miss. Computed from OD, see windowsFromOD(). */
export interface JudgeWindows {
  great: number;
  ok: number;
  miss: number;
}

export interface EngineConfig {
  windows: JudgeWindows;
  /** Second hand of a big note must land within this many ms of the first. Default 30. */
  bigWindowMs: number;
}

export type EngineEvent =
  | {
      type: 'note';
      index: number;
      judgement: Judgement;
      /** hitMs - note.t. null when missed by time-out or by a wrong-type press. */
      deltaMs: number | null;
      key: Key | null;
      big: boolean;
      /** Both hands landed (only ever true for big notes). */
      strong: boolean;
    }
  | { type: 'roll-tick'; index: number; key: Key }
  | { type: 'spinner-tick'; index: number; key: Key; remaining: number }
  | { type: 'spinner-end'; index: number; completed: boolean };

export interface Counts {
  great: number;
  ok: number;
  miss: number;
}

export interface EngineState {
  /**
   * round(1_000_000 × (notesEarned + bonus) / (notes + rolls + spinners)).
   * Every note, roll and spinner weighs 1: a roll fills in per counted tick
   * (up to its expected ticks), a spinner per alternating hit (up to hits).
   * Grows monotonically during play.
   */
  score: number;
  /** Notes only: earned / judgedSoFar, 0..1. 1 when nothing judged yet. Rolls and spinners never touch it. */
  accuracy: number;
  combo: number;
  maxCombo: number;
  counts: Counts;
  rollTicks: number;
  spinnerTicks: number;
  /** Notes judged so far (hit or missed). */
  judged: number;
  /** chart.notes.length */
  total: number;
  /** True once every note is judged and every roll/spinner has ended. */
  finished: boolean;
}

export type NoteStatus = 'pending' | 'hit' | 'missed';

export interface NoteView {
  status: NoteStatus;
  judgement: Judgement | null;
  /** Big note: first hand landed, waiting for the partner within bigWindowMs. */
  awaitingPartner: boolean;
  strong: boolean;
}

/** [songMs, key]. Every press goes into the log, whether or not it hit anything. */
export type InputLogEntry = readonly [t: number, key: Key];

/**
 * Judging rules (PLAN §2), implemented in src/core/engine.ts:
 *
 * hit(key, hitMs):
 *   1. Settle overdue notes first: any pending note with t + miss < hitMs is missed
 *      right here (so the final state is a pure function of the input log, and
 *      replay() reproduces live play exactly, whatever the frame timing was).
 *   2. Candidate = earliest pending note with |hitMs - t| ≤ windows.miss.
 *      Too-early presses (t - hitMs > miss) consume nothing and only go into the log.
 *   3. Wrong type → candidate is missed (taiko rule). Right type → judgement by |delta|:
 *      ≤ great → 'great', ≤ ok → 'ok', else 'miss' (in window, consumed).
 *   4. Big note (one rule, no option): the first key judges timing and opens
 *      bigWindowMs for partnerKey(key); the note event is deferred. The partner
 *      inside the window → that timing's judgement with strong=true. Expiry or any
 *      other key → the note is capped at OK (a Great first hand becomes OK), strong=false.
 *      Presses inside a big note's partner window never touch the next note.
 *   5. If no candidate: an active roll (t ≤ hitMs ≤ end) takes the press as a tick
 *      (worth 1/expected of a note until `expected` ticks are in; expected = one per
 *      eighth at the roll's tempo); an active spinner takes it if it alternates type
 *      (first press: either), worth 1/hits of a note until complete.
 *   6. The press is appended to the log regardless.
 *
 * tick(songMs): misses notes with t + miss < songMs, expires partner windows,
 *   emits spinner-end when songMs > end, sets finished.
 *
 * Score (PLAN §2): every note, roll and spinner weighs 1; a note earns great 1 /
 *   ok 0.5 / miss 0, rolls and spinners fill in with their ticks. Accuracy is notes only.
 *   combo: +1 per non-miss note (once per note, not per hand); reset on miss.
 */
export interface Engine {
  readonly chart: Chart;
  readonly config: EngineConfig;
  readonly state: Readonly<EngineState>;
  readonly log: readonly InputLogEntry[];
  tick(songMs: number): EngineEvent[];
  hit(key: Key, hitMs: number): EngineEvent[];
  noteView(index: number): NoteView;
  /** Index of the earliest pending note (for renderers that cull). */
  firstPending(): number;
}

// ─── Records (PLAN §12) ─────────────────────────────────────────────────────

export interface Offsets {
  /**
   * Screen vs audio, ms. SUBTRACTED from the raw audio clock
   * (songMs = (currentTime − startAt) × 1000 − audio): positive means the
   * sound reaches the ear late, so the visual / judgement clock is delayed to
   * match. Same sign convention in SongPlayer, Calibrate and Settings.
   */
  audio: number;
  /** Input latency, ms. Subtracted from hit timestamps. */
  input: number;
}

export interface PlayResult {
  chartHash: string;
  songId: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: Counts;
  rollTicks: number;
  spinnerTicks: number;
  offsets: Offsets;
  /** Full input log; score is recomputable from (chartHash, config, replay). */
  replay: InputLogEntry[];
  /** Unix ms. */
  createdAt: number;
}
