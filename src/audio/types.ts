/**
 * Audio contracts (PLAN §5, §7).
 *
 * The song clock is derived from AudioContext.currentTime only. `<audio>`
 * elements are never used. Input timestamps (performance clock) are converted
 * with getOutputTimestamp(), with a per-frame (performance.now, currentTime)
 * pair as the fallback.
 */

export type PlayerState = 'idle' | 'loading' | 'loaded' | 'playing' | 'paused' | 'ended';

export interface SongPlayer {
  readonly ctx: AudioContext;
  readonly state: PlayerState;
  /** Decoded length in ms; 0 until loaded. */
  readonly durationMs: number;

  /**
   * Fetch + decodeAudioData. Tries each URL in order and resolves on the first
   * that decodes (PLAN §5: format list, currently webm only).
   */
  load(urls: readonly string[]): Promise<void>;

  /**
   * Schedule playback at ctx.currentTime + 0.1 (never `start()` immediately).
   * `offsets.audio` is applied inside songMs().
   */
  start(offsets: { audio: number }): void;

  /** ctx.suspend() / ctx.resume(): the clock pauses with the audio. */
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): void;

  /** (ctx.currentTime - startAt) × 1000 - audioOffset. Valid while playing/paused. */
  songMs(): number;

  /**
   * Convert an input event's `timeStamp` (performance clock) to song ms:
   *   const { contextTime, performanceTime } = ctx.getOutputTimestamp();
   *   (contextTime + (timeStamp - performanceTime) / 1000 - startAt) × 1000 - audioOffset
   * Fallback when getOutputTimestamp is missing: the last (performance.now(),
   * currentTime) pair recorded by syncClock().
   */
  hitMs(timeStamp: number): number;

  /** Call once per animation frame; only needed for the fallback clock. */
  syncClock(): void;

  onEnded(cb: () => void): () => void;
  destroy(): void;
}

export interface HitSounds {
  load(ctx: AudioContext): Promise<void>;
  /** Fire-and-forget: a short AudioBuffer started now. */
  play(kind: 'd' | 'k', big?: boolean): void;
  setVolume(v: number): void;
}

/**
 * Decode a 1-second probe.webm with decodeAudioData. canPlayType() is not trusted.
 * Resolves false on any failure; the UI then shows the "update your browser" notice.
 */
export type ProbeWebmOpus = (ctx: AudioContext) => Promise<boolean>;
