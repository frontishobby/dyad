/**
 * Calibration metronome (PLAN §7 "보정").
 *
 * Everything runs on the audio clock, exactly like play:
 * - clicks are AudioBufferSourceNodes scheduled ahead with start(when), from a
 *   short setInterval look-ahead ("a tale of two clocks"), never played "now";
 * - the on-screen flash is drawn by requestAnimationFrame when ctx.currentTime
 *   crosses a beat, shifted by the audio offset under test;
 * - taps are converted from event.timeStamp to the audio clock the way
 *   SongPlayer.hitMs() does (getOutputTimestamp, per-frame pair as fallback).
 *
 * The scheduler takes its clock and its output through a small sink interface,
 * so the beat bookkeeping is unit-testable without Web Audio.
 */

export const CALIBRATION_BPM = 100;
/** Seconds between start() and beat 0, like the player's start lead. */
export const METRONOME_START_LEAD_S = 0.1;
/** Seconds ahead of the audio clock that clicks are scheduled. */
export const DEFAULT_LOOKAHEAD_S = 0.15;
/** ms between scheduler passes. */
export const DEFAULT_SCHEDULER_INTERVAL_MS = 25;
/** Beats older than this (s) when the scheduler gets to them are dropped, never played late. */
export const LATE_BEAT_TOLERANCE_S = 0.02;
/** The flash stays on for this long after each beat. */
export const FLASH_MS = 80;
/** Beats per bar for the accent click. */
export const BEATS_PER_BAR = 4;
/** Taps used for the input offset: the median of the last this-many. */
export const TAP_TARGET = 16;

// ─── clock conversion ───────────────────────────────────────────────────────

/** A (performance.now(), ctx.currentTime) pair captured on the last frame. */
export interface ClockPair {
  performanceTime: number;
  contextTime: number;
}

/** Shape of AudioContext.getOutputTimestamp(); both members are optional per spec. */
export interface OutputStamp {
  contextTime?: number | undefined;
  performanceTime?: number | undefined;
}

/**
 * Pure: performance-clock ms → audio-clock seconds from one output-timestamp
 * sample. Returns null when the sample is unusable (missing members, or the
 * (0, 0) Chrome reports before the first rendered quantum).
 */
export function contextTimeFromTimeStamp(timeStamp: number, stamp: OutputStamp): number | null {
  const { contextTime, performanceTime } = stamp;
  if (typeof contextTime !== 'number' || typeof performanceTime !== 'number') return null;
  if (!(performanceTime > 0) || !Number.isFinite(contextTime)) return null;
  return contextTime + (timeStamp - performanceTime) / 1000;
}

/** Same conversion from a per-frame fallback pair. */
export function contextTimeFromPair(timeStamp: number, pair: ClockPair): number {
  return pair.contextTime + (timeStamp - pair.performanceTime) / 1000;
}

/**
 * Convert a DOM event's timeStamp to the audio clock exactly like the song
 * player does: getOutputTimestamp() when it yields data, else the last
 * (performance.now(), currentTime) pair recorded each frame.
 */
export function eventContextTime(ctx: AudioContext, timeStamp: number, fallback: ClockPair): number {
  if (typeof ctx.getOutputTimestamp === 'function') {
    const t = contextTimeFromTimeStamp(timeStamp, ctx.getOutputTimestamp());
    if (t !== null) return t;
  }
  return contextTimeFromPair(timeStamp, fallback);
}

// ─── beat maths ─────────────────────────────────────────────────────────────

export function beatLengthMs(bpm: number): number {
  return 60_000 / bpm;
}

/** ms of the beat nearest to `ms` (0 = beat 0). */
export function nearestBeatMs(ms: number, beatMs: number): number {
  // `+ 0` folds the -0 that Math.round yields just below beat 0.
  return Math.round(ms / beatMs) * beatMs + 0;
}

/** 0 ≤ phase < beatMs: how far past the last beat `ms` is. */
export function beatPhaseMs(ms: number, beatMs: number): number {
  const p = ms % beatMs;
  return p < 0 ? p + beatMs : p;
}

/** Median of a sample; NaN when empty. Even counts average the middle two. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

// ─── scheduler ──────────────────────────────────────────────────────────────

export interface MetronomeSink {
  /** Audio clock, seconds. */
  now(): number;
  /** Play a click at `when` seconds on the audio clock. */
  schedule(when: number, beatIndex: number): void;
}

export interface MetronomeTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface MetronomeOptions {
  sink: MetronomeSink;
  bpm?: number;
  lookaheadS?: number;
  intervalMs?: number;
  startLeadS?: number;
  timers?: MetronomeTimers;
}

export interface Metronome {
  readonly bpm: number;
  readonly beatMs: number;
  readonly running: boolean;
  /** Audio-clock seconds of beat 0; NaN before start(). */
  readonly startTime: number;
  /** Next beat index the scheduler will consider. */
  readonly nextBeat: number;
  start(): void;
  stop(): void;
  /** One scheduler pass. Driven by the interval; exposed for tests. */
  tick(): void;
  /** Metronome ms for an audio-clock time: 0 at beat 0, negative before it. */
  msAt(contextTime: number): number;
  /** Audio-clock seconds of beat `index`. */
  beatTime(index: number): number;
}

function defaultTimers(): MetronomeTimers {
  return {
    set: (fn, ms) => setInterval(fn, ms),
    clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  };
}

export function createMetronome(opts: MetronomeOptions): Metronome {
  const sink = opts.sink;
  const bpm = opts.bpm ?? CALIBRATION_BPM;
  const beatMs = beatLengthMs(bpm);
  const beatS = beatMs / 1000;
  const lookaheadS = opts.lookaheadS ?? DEFAULT_LOOKAHEAD_S;
  const intervalMs = opts.intervalMs ?? DEFAULT_SCHEDULER_INTERVAL_MS;
  const startLeadS = opts.startLeadS ?? METRONOME_START_LEAD_S;
  const timers = opts.timers ?? defaultTimers();

  let running = false;
  let startTime = Number.NaN;
  let nextBeat = 0;
  let handle: unknown = null;

  function beatTime(index: number): number {
    return startTime + index * beatS;
  }

  function tick(): void {
    if (!running) return;
    const now = sink.now();
    const horizon = now + lookaheadS;
    // Bounded so a clock jump (tab throttled for minutes) cannot spin here.
    let guard = 10_000;
    while (beatTime(nextBeat) < horizon && guard-- > 0) {
      const when = beatTime(nextBeat);
      // A beat the scheduler only reached after it passed is skipped, not
      // played late: a late click would teach the user a wrong offset.
      if (when >= now - LATE_BEAT_TOLERANCE_S) sink.schedule(when, nextBeat);
      nextBeat++;
    }
  }

  function start(): void {
    if (running) return;
    running = true;
    startTime = sink.now() + startLeadS;
    nextBeat = 0;
    tick();
    handle = timers.set(tick, intervalMs);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    if (handle !== null) {
      timers.clear(handle);
      handle = null;
    }
  }

  return {
    bpm,
    beatMs,
    get running() {
      return running;
    },
    get startTime() {
      return startTime;
    },
    get nextBeat() {
      return nextBeat;
    },
    start,
    stop,
    tick,
    msAt: (contextTime) => (contextTime - startTime) * 1000,
    beatTime,
  };
}

// ─── click synthesis ────────────────────────────────────────────────────────

export interface ClickSpec {
  /** Length of the burst. */
  durationMs: number;
  /** Sine frequency. */
  hz: number;
  /** Peak level, linear. */
  level: number;
  /** Amplitude decay constant, 1/s. */
  decay: number;
}

export const CLICK: ClickSpec = { durationMs: 15, hz: 1800, level: 0.6, decay: 500 };
export const ACCENT: ClickSpec = { durationMs: 15, hz: 2600, level: 0.75, decay: 500 };

/** Deterministic sine burst with exponential decay; ends at (near) zero so it never pops. */
export function clickSamples(sampleRate: number, spec: ClickSpec = CLICK): Float32Array {
  const n = Math.max(1, Math.round((sampleRate * spec.durationMs) / 1000));
  const out = new Float32Array(n);
  const twoPiF = 2 * Math.PI * spec.hz;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Linear window on top of the decay so the last sample is exactly zero.
    const window = 1 - i / n;
    out[i] = Math.sin(twoPiF * t) * Math.exp(-spec.decay * t) * spec.level * window;
  }
  return out;
}

export function createClickBuffer(ctx: BaseAudioContext, spec: ClickSpec = CLICK): AudioBuffer {
  const samples = clickSamples(ctx.sampleRate, spec);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

export interface ClickSink extends MetronomeSink {
  setVolume(v: number): void;
  destroy(): void;
}

/** A MetronomeSink on a real AudioContext: beat 0 of each bar gets the accent. */
export function createClickSink(ctx: AudioContext, volume = 0.8): ClickSink {
  const click = createClickBuffer(ctx, CLICK);
  const accent = createClickBuffer(ctx, ACCENT);
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  return {
    now: () => ctx.currentTime,
    schedule(when, beatIndex) {
      const source = ctx.createBufferSource();
      source.buffer = beatIndex % BEATS_PER_BAR === 0 ? accent : click;
      source.connect(gain);
      source.start(Math.max(when, ctx.currentTime));
    },
    setVolume(v) {
      gain.gain.value = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    },
    destroy() {
      gain.disconnect();
    },
  };
}
