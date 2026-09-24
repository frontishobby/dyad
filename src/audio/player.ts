/**
 * Song player and song clock (PLAN §5, §7).
 *
 * The whole song is decoded into an AudioBuffer and played through a single
 * AudioBufferSourceNode scheduled slightly in the future. The song clock is
 * derived from AudioContext.currentTime only; `<audio>` is never used.
 *
 * State machine (PlayerState):
 *
 *   idle ──load()──▶ loading ──decoded──▶ loaded ──start()──▶ playing ◀─resume()─ paused
 *     ▲                 │ all failed          ▲                 │  pause() ───────▶
 *     └─────────────────┘                     │                 └─ buffer ran out ─▶ ended
 *                                             └──── stop() ───── (from playing / paused / ended)
 *
 * destroy() returns to idle and drops the buffer.
 */
import type { PlayerState, SongPlayer } from './types.ts';
import { getAudioContext } from './context.ts';

/**
 * Seconds between start() and the first sample. Scheduling a little ahead
 * removes the jitter of an immediate start(); the lead is part of the clock
 * (songMs() is −100 ms the instant start() returns).
 */
export const START_LEAD_S = 0.1;

/** Not-a-time marker for the fallback clock and startAt. */
const UNSET = Number.NaN;

class SongPlayerImpl implements SongPlayer {
  readonly ctx: AudioContext;

  private stateValue: PlayerState = 'idle';
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** ctx time at which the current source starts; NaN before start(). */
  private startAt = UNSET;
  private audioOffset = 0;

  /** Fallback clock pair captured by syncClock() (performance ms, ctx seconds). */
  private syncPerf = UNSET;
  private syncCtx = UNSET;
  private readonly hasOutputTimestamp: boolean;

  private readonly endedCallbacks = new Set<() => void>();
  /** Bumped by every load()/destroy() so a superseded load() cannot clobber state. */
  private loadGeneration = 0;
  private destroyed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.hasOutputTimestamp = typeof ctx.getOutputTimestamp === 'function';
  }

  get state(): PlayerState {
    return this.stateValue;
  }

  get durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0;
  }

  async load(urls: readonly string[]): Promise<void> {
    this.assertAlive();
    if (this.stateValue === 'playing' || this.stateValue === 'paused') this.stop();

    const generation = ++this.loadGeneration;
    this.buffer = null;
    this.stateValue = 'loading';

    if (urls.length === 0) {
      this.stateValue = 'idle';
      throw new Error('SongPlayer.load(): no audio URLs given');
    }

    const failures: string[] = [];
    for (const url of urls) {
      let decoded: AudioBuffer;
      try {
        decoded = await fetchAndDecode(this.ctx, url);
      } catch (err) {
        failures.push(`${url}: ${describeError(err)}`);
        continue;
      }
      // A newer load() or destroy() took over while we were decoding.
      if (generation !== this.loadGeneration) return;
      this.buffer = decoded;
      this.stateValue = 'loaded';
      return;
    }

    if (generation !== this.loadGeneration) return;
    this.stateValue = 'idle';
    throw new Error(
      `SongPlayer.load(): none of ${urls.length} source(s) could be decoded\n  ${failures.join('\n  ')}`,
    );
  }

  start(offsets: { audio: number; leadInMs?: number }): void {
    this.assertAlive();
    const buffer = this.buffer;
    if (!buffer) {
      throw new Error(`SongPlayer.start(): nothing loaded (state is '${this.stateValue}')`);
    }
    // Restarting while a source is live replaces it; its ended event is suppressed.
    if (this.source) this.stop();

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      // stop() and start() both swap `this.source` before the old node can end.
      if (this.source !== source) return;
      this.source = null;
      this.stateValue = 'ended';
      for (const cb of [...this.endedCallbacks]) cb();
    };

    // The lead-in is silence before the first sample; it is part of the clock,
    // so songMs() counts up from −(leadIn + START_LEAD) and notes scroll in.
    const leadIn = offsets.leadInMs;
    const leadInS = leadIn !== undefined && Number.isFinite(leadIn) && leadIn > 0 ? leadIn / 1000 : 0;
    const startAt = this.ctx.currentTime + START_LEAD_S + leadInS;
    source.start(startAt);

    this.source = source;
    this.startAt = startAt;
    this.audioOffset = offsets.audio;
    this.stateValue = 'playing';
    this.syncClock();
  }

  async pause(): Promise<void> {
    if (this.stateValue !== 'playing') return;
    this.stateValue = 'paused';
    try {
      await this.ctx.suspend();
    } catch (err) {
      this.stateValue = 'playing';
      throw err;
    }
  }

  async resume(): Promise<void> {
    if (this.stateValue !== 'paused') return;
    this.stateValue = 'playing';
    try {
      await this.ctx.resume();
    } catch (err) {
      this.stateValue = 'paused';
      throw err;
    }
    // The fallback pair went stale while currentTime was frozen.
    this.syncClock();
  }

  stop(): void {
    const source = this.source;
    if (source) {
      this.source = null;
      source.onended = null;
      try {
        source.stop();
      } catch {
        // InvalidStateError if the node never started; nothing to undo.
      }
      source.disconnect();
    }
    // pause() suspended the shared context; leaving it suspended would mute
    // hit sounds and freeze the next song's clock.
    if (this.stateValue === 'paused') {
      void this.ctx.resume().catch(() => undefined);
    }
    if (this.stateValue === 'playing' || this.stateValue === 'paused' || this.stateValue === 'ended') {
      this.stateValue = this.buffer ? 'loaded' : 'idle';
    }
  }

  songMs(): number {
    return (this.heardNow() - this.effectiveStartAt()) * 1000 - this.audioOffset;
  }

  /**
   * Context time of the sound coming out of the speaker right now: the
   * getOutputTimestamp() pair projected to this instant. `currentTime` runs
   * ahead of it by the output latency (a few ms wired, 100–250 ms over
   * Bluetooth); drawing and ticking from `currentTime` would put the notes on
   * the ring before the beat is heard, and hitMs() (also heard-based) would
   * then call every well-timed tap early. While the context is not running
   * the pair goes stale, so the frozen `currentTime` is used instead.
   */
  private heardNow(): number {
    if (this.hasOutputTimestamp && this.ctx.state === 'running') {
      const { contextTime, performanceTime } = this.ctx.getOutputTimestamp();
      if (typeof contextTime === 'number' && typeof performanceTime === 'number' && performanceTime > 0) {
        const heard = contextTime + (performance.now() - performanceTime) / 1000;
        // Never ahead of the context clock, and never more than a second behind it (a stale pair).
        return Math.min(this.ctx.currentTime, Math.max(this.ctx.currentTime - 1, heard));
      }
    }
    return this.ctx.currentTime;
  }

  hitMs(timeStamp: number): number {
    const startAt = this.effectiveStartAt();
    if (this.hasOutputTimestamp) {
      const { contextTime, performanceTime } = this.ctx.getOutputTimestamp();
      // Both members are optional per spec, and Chrome reports (0, 0) until the
      // first render quantum has been output; either case means "no data yet".
      if (typeof contextTime === 'number' && typeof performanceTime === 'number' && performanceTime > 0) {
        return (contextTime + (timeStamp - performanceTime) / 1000 - startAt) * 1000 - this.audioOffset;
      }
    }
    if (Number.isNaN(this.syncPerf)) this.syncClock();
    return (this.syncCtx + (timeStamp - this.syncPerf) / 1000 - startAt) * 1000 - this.audioOffset;
  }

  syncClock(): void {
    this.syncPerf = performance.now();
    this.syncCtx = this.ctx.currentTime;
  }

  onEnded(cb: () => void): () => void {
    this.endedCallbacks.add(cb);
    return () => {
      this.endedCallbacks.delete(cb);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.loadGeneration++;
    this.endedCallbacks.clear();
    this.buffer = null;
    this.startAt = UNSET;
    this.audioOffset = 0;
    this.stateValue = 'idle';
  }

  /**
   * Before start() the clock behaves as if start() were being called right
   * now, so songMs()/hitMs() are continuous across the call instead of NaN.
   */
  private effectiveStartAt(): number {
    return Number.isNaN(this.startAt) ? this.ctx.currentTime + START_LEAD_S : this.startAt;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('SongPlayer has been destroyed');
  }
}

async function fetchAndDecode(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  return ctx.decodeAudioData(bytes);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Create a SongPlayer on the given context (default: the shared singleton). */
export function createSongPlayer(ctx: AudioContext = getAudioContext()): SongPlayer {
  return new SongPlayerImpl(ctx);
}
