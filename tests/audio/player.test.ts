import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSongPlayer, START_LEAD_S } from '../../src/audio/player.ts';
import type { SongPlayer } from '../../src/audio/types.ts';
import { FakeAudioContext, flush, makeFetch } from './fakes.ts';

const SONG = '/songs/x/audio.abc.webm';

async function loadedPlayer(ctx: FakeAudioContext, seconds = 2.5): Promise<SongPlayer> {
  const { fetch } = makeFetch({ [SONG]: { body: `ok:${seconds}` } });
  vi.stubGlobal('fetch', fetch);
  const player = createSongPlayer(ctx.asReal());
  await player.load([SONG]);
  return player;
}

describe('createSongPlayer', () => {
  let ctx: FakeAudioContext;

  beforeEach(() => {
    ctx = new FakeAudioContext({ outputTimestamp: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('construction', () => {
    it('starts idle on the given context with no duration', () => {
      const player = createSongPlayer(ctx.asReal());
      expect(player.ctx).toBe(ctx);
      expect(player.state).toBe('idle');
      expect(player.durationMs).toBe(0);
    });
  });

  describe('load()', () => {
    it('tries URLs in order and stops at the first that decodes', async () => {
      const { fetch, calls } = makeFetch({
        '/a.webm': { status: 404 },
        '/b.webm': { body: 'garbage' },
        '/c.webm': { body: 'ok:3' },
        '/d.webm': { body: 'ok:9' },
      });
      vi.stubGlobal('fetch', fetch);
      const player = createSongPlayer(ctx.asReal());

      await player.load(['/a.webm', '/b.webm', '/c.webm', '/d.webm']);

      expect(calls).toEqual(['/a.webm', '/b.webm', '/c.webm']);
      // The 404 body is never handed to the decoder; only /b and /c are decoded.
      expect(ctx.decodeCalls).toHaveLength(2);
      expect(player.state).toBe('loaded');
      expect(player.durationMs).toBe(3000);
    });

    it('reports loading while in flight', async () => {
      const { fetch } = makeFetch({ '/a.webm': { body: 'ok:1' } });
      vi.stubGlobal('fetch', fetch);
      const player = createSongPlayer(ctx.asReal());
      const pending = player.load(['/a.webm']);
      expect(player.state).toBe('loading');
      await pending;
      expect(player.state).toBe('loaded');
    });

    it('rejects with every failure listed when nothing decodes, and returns to idle', async () => {
      const { fetch } = makeFetch({
        '/a.webm': { status: 500 },
        '/b.webm': { body: 'nope' },
        '/c.webm': { throws: true },
      });
      vi.stubGlobal('fetch', fetch);
      const player = createSongPlayer(ctx.asReal());

      await expect(player.load(['/a.webm', '/b.webm', '/c.webm'])).rejects.toThrow(/none of 3 source/);
      await expect(player.load(['/a.webm', '/b.webm', '/c.webm'])).rejects.toThrow(
        /\/a\.webm: HTTP 500[\s\S]*\/b\.webm: EncodingError[\s\S]*\/c\.webm: Failed to fetch/,
      );
      expect(player.state).toBe('idle');
      expect(player.durationMs).toBe(0);
    });

    it('rejects an empty URL list', async () => {
      const player = createSongPlayer(ctx.asReal());
      await expect(player.load([])).rejects.toThrow(/no audio URLs/);
      expect(player.state).toBe('idle');
    });

    it('lets a newer load() win over a slower earlier one', async () => {
      let releaseFirst: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const slowCtx = new FakeAudioContext({
        decode: async (bytes) => {
          const tag = new TextDecoder().decode(bytes);
          if (tag === 'ok:1') await gate;
          const { decodeTagged } = await import('./fakes.ts');
          return decodeTagged(bytes);
        },
      });
      const { fetch } = makeFetch({ '/slow.webm': { body: 'ok:1' }, '/fast.webm': { body: 'ok:2' } });
      vi.stubGlobal('fetch', fetch);
      const player = createSongPlayer(slowCtx.asReal());

      const first = player.load(['/slow.webm']);
      const second = player.load(['/fast.webm']);
      await second;
      expect(player.durationMs).toBe(2000);

      releaseFirst?.();
      await first;
      expect(player.durationMs).toBe(2000);
      expect(player.state).toBe('loaded');
    });

    it('stops a live source before replacing the buffer', async () => {
      const player = await loadedPlayer(ctx);
      player.start({ audio: 0 });
      const oldSource = ctx.lastSource;
      await player.load([SONG]);
      expect(oldSource.stopCalls).toHaveLength(1);
      expect(player.state).toBe('loaded');
    });
  });

  describe('start()', () => {
    it('schedules the source START_LEAD_S after the current time', async () => {
      const player = await loadedPlayer(ctx);
      ctx.currentTime = 5;
      player.start({ audio: 0 });

      const source = ctx.lastSource;
      expect(START_LEAD_S).toBe(0.1);
      expect(source.startedAt).toBeCloseTo(5.1, 9);
      expect(source.startCalls).toEqual([5.1]);
      expect(source.buffer?.duration).toBe(2.5);
      expect(source.connections).toEqual([ctx.destination]);
      expect(player.state).toBe('playing');
    });

    it('throws before anything is loaded', () => {
      const player = createSongPlayer(ctx.asReal());
      expect(() => player.start({ audio: 0 })).toThrow(/nothing loaded/);
    });

    it('replaces a live source when called again, silencing the old ended event', async () => {
      const player = await loadedPlayer(ctx);
      const ended = vi.fn();
      player.onEnded(ended);
      player.start({ audio: 0 });
      const first = ctx.lastSource;
      ctx.currentTime = 1;
      player.start({ audio: 0 });
      const second = ctx.lastSource;

      expect(second).not.toBe(first);
      expect(first.stopCalls).toHaveLength(1);
      expect(first.disconnected).toBe(true);
      await flush();
      first.fireEnded();
      expect(ended).not.toHaveBeenCalled();
      expect(player.state).toBe('playing');
      expect(player.songMs()).toBeCloseTo(-100, 9);
    });

    it('can start again after the song ended', async () => {
      const player = await loadedPlayer(ctx);
      player.start({ audio: 0 });
      ctx.lastSource.fireEnded();
      expect(player.state).toBe('ended');
      ctx.currentTime = 9;
      player.start({ audio: 0 });
      expect(player.state).toBe('playing');
      expect(ctx.sources).toHaveLength(2);
      expect(ctx.lastSource.startedAt).toBeCloseTo(9.1, 9);
    });
  });

  describe('songMs()', () => {
    it('is (currentTime − startAt) × 1000 − audioOffset', async () => {
      const player = await loadedPlayer(ctx);
      ctx.currentTime = 5;
      player.start({ audio: 20 });
      expect(player.songMs()).toBeCloseTo(-100 - 20, 9);

      ctx.currentTime = 7.35;
      expect(player.songMs()).toBeCloseTo(2250 - 20, 9);
    });

    it('leadInMs delays the source and counts the clock up from −(leadIn + 100)', async () => {
      const player = await loadedPlayer(ctx);
      ctx.currentTime = 5;
      player.start({ audio: 20, leadInMs: 3000 });
      expect(ctx.lastSource.startedAt).toBeCloseTo(5 + 0.1 + 3, 9);
      expect(player.songMs()).toBeCloseTo(-3100 - 20, 9);
      ctx.currentTime = 8.1;
      expect(player.songMs()).toBeCloseTo(-20, 9); // the first sample plays now
      ctx.currentTime = 9.1;
      expect(player.songMs()).toBeCloseTo(1000 - 20, 9);
      // Non-finite or negative lead-ins are ignored.
      player.start({ audio: 0, leadInMs: -500 });
      expect(ctx.lastSource.startedAt).toBeCloseTo(9.1 + 0.1, 9);
    });

    it('applies a negative audio offset in the other direction', async () => {
      const player = await loadedPlayer(ctx);
      ctx.currentTime = 1;
      player.start({ audio: -35 });
      ctx.currentTime = 2.1;
      expect(player.songMs()).toBeCloseTo(1000 + 35, 9);
    });

    it('behaves as if start() were called now when nothing has started', async () => {
      const player = await loadedPlayer(ctx);
      ctx.currentTime = 42;
      expect(player.songMs()).toBeCloseTo(-100, 9);
    });

    it('freezes with the context while paused and continues after resume', async () => {
      const player = await loadedPlayer(ctx);
      ctx.currentTime = 0;
      player.start({ audio: 0 });
      ctx.currentTime = 1.1;
      await player.pause();
      // A suspended context does not advance currentTime.
      expect(player.songMs()).toBeCloseTo(1000, 9);
      await player.resume();
      ctx.currentTime = 1.6;
      expect(player.songMs()).toBeCloseTo(1500, 9);
    });
  });

  describe('hitMs()', () => {
    it('uses getOutputTimestamp() to map the event clock onto the song clock', async () => {
      const player = await loadedPlayer(ctx);
      ctx.currentTime = 5;
      player.start({ audio: 20 });

      // The sample being output at performance time 12000 ms was at context time 7.0 s.
      ctx.outputTimestamp = { contextTime: 7.0, performanceTime: 12000 };
      // An event stamped 345 ms later: (7.0 + 0.345 − 5.1) × 1000 − 20.
      expect(player.hitMs(12345)).toBeCloseTo(2245 - 20, 9);
      // Events from before the sample also work (negative delta).
      expect(player.hitMs(11900)).toBeCloseTo(1800 - 20, 9);
    });

    it('ignores the syncClock() pair when getOutputTimestamp() is available', async () => {
      const player = await loadedPlayer(ctx);
      ctx.currentTime = 5;
      player.start({ audio: 0 });
      vi.spyOn(performance, 'now').mockReturnValue(999_999);
      player.syncClock();
      ctx.outputTimestamp = { contextTime: 6.0, performanceTime: 1000 };
      expect(player.hitMs(1500)).toBeCloseTo(1400, 9);
    });

    it('falls back to the syncClock() pair when getOutputTimestamp() is missing', async () => {
      const plain = new FakeAudioContext();
      expect(plain.getOutputTimestamp).toBeUndefined();
      const player = await loadedPlayer(plain);
      const now = vi.spyOn(performance, 'now');

      now.mockReturnValue(20_000);
      plain.currentTime = 5;
      player.start({ audio: 20 });

      // A fresh pair, as the frame loop would record it.
      now.mockReturnValue(21_000);
      plain.currentTime = 7.0;
      player.syncClock();

      // Event 250 ms after the pair: (7.0 + 0.25 − 5.1) × 1000 − 20.
      expect(player.hitMs(21_250)).toBeCloseTo(2150 - 20, 9);
      // Pair is used as-is until the next syncClock(), even if the clocks moved.
      plain.currentTime = 8.5;
      now.mockReturnValue(30_000);
      expect(player.hitMs(21_250)).toBeCloseTo(2150 - 20, 9);
      player.syncClock();
      expect(player.hitMs(30_100)).toBeCloseTo(3500 - 20, 9);
    });

    it('captures a pair at start() so the fallback never sees NaN', async () => {
      const plain = new FakeAudioContext();
      const player = await loadedPlayer(plain);
      vi.spyOn(performance, 'now').mockReturnValue(1000);
      plain.currentTime = 2;
      player.start({ audio: 0 });
      // No explicit syncClock(): the pair recorded inside start() is used.
      expect(player.hitMs(1200)).toBeCloseTo(100, 9);
    });

    it('syncs lazily when called before start() on a browser without getOutputTimestamp', async () => {
      const plain = new FakeAudioContext();
      const player = createSongPlayer(plain.asReal());
      vi.spyOn(performance, 'now').mockReturnValue(500);
      plain.currentTime = 3;
      expect(Number.isNaN(player.hitMs(500))).toBe(false);
      expect(player.hitMs(500)).toBeCloseTo(-100, 9);
    });

    it('falls back when getOutputTimestamp() reports nothing yet (Chrome before the first quantum)', async () => {
      const player = await loadedPlayer(ctx);
      const now = vi.spyOn(performance, 'now').mockReturnValue(10_000);
      ctx.currentTime = 1;
      player.start({ audio: 0 });

      ctx.outputTimestamp = { contextTime: 0, performanceTime: 0 };
      expect(player.hitMs(10_050)).toBeCloseTo(-50, 9);

      ctx.outputTimestamp = {};
      expect(player.hitMs(10_050)).toBeCloseTo(-50, 9);

      // Once real data arrives it takes over.
      now.mockReturnValue(99_999);
      ctx.outputTimestamp = { contextTime: 1.0, performanceTime: 10_000 };
      expect(player.hitMs(10_050)).toBeCloseTo(-50, 9);
    });

    it('refreshes the fallback pair after resume()', async () => {
      const plain = new FakeAudioContext();
      const player = await loadedPlayer(plain);
      const now = vi.spyOn(performance, 'now').mockReturnValue(0);
      plain.currentTime = 0;
      player.start({ audio: 0 });

      plain.currentTime = 1.1; // 1000 ms into the song
      now.mockReturnValue(1100);
      player.syncClock();
      await player.pause();

      // Five seconds of wall time pass while currentTime stays frozen.
      now.mockReturnValue(6100);
      await player.resume();
      expect(player.hitMs(6100)).toBeCloseTo(1000, 9);
    });
  });

  describe('pause() / resume()', () => {
    it('suspend and resume the context and track state', async () => {
      const player = await loadedPlayer(ctx);
      player.start({ audio: 0 });

      await player.pause();
      expect(ctx.suspendCalls).toBe(1);
      expect(ctx.state).toBe('suspended');
      expect(player.state).toBe('paused');

      await player.resume();
      expect(ctx.resumeCalls).toBe(1);
      expect(ctx.state).toBe('running');
      expect(player.state).toBe('playing');
    });

    it('are no-ops outside playing / paused', async () => {
      const player = await loadedPlayer(ctx);
      await player.pause();
      await player.resume();
      expect(ctx.suspendCalls).toBe(0);
      expect(ctx.resumeCalls).toBe(0);
      expect(player.state).toBe('loaded');

      player.start({ audio: 0 });
      await player.resume();
      expect(ctx.resumeCalls).toBe(0);
      await player.pause();
      await player.pause();
      expect(ctx.suspendCalls).toBe(1);
    });

    it('revert state when the context refuses', async () => {
      const player = await loadedPlayer(ctx);
      player.start({ audio: 0 });
      vi.spyOn(ctx, 'suspend').mockRejectedValueOnce(new Error('InvalidStateError'));
      await expect(player.pause()).rejects.toThrow('InvalidStateError');
      expect(player.state).toBe('playing');

      await player.pause();
      vi.spyOn(ctx, 'resume').mockRejectedValueOnce(new Error('InvalidStateError'));
      await expect(player.resume()).rejects.toThrow('InvalidStateError');
      expect(player.state).toBe('paused');
    });
  });

  describe('stop() and ended', () => {
    it('stops the source, suppresses onended and returns to loaded', async () => {
      const player = await loadedPlayer(ctx);
      const ended = vi.fn();
      player.onEnded(ended);
      player.start({ audio: 0 });
      const source = ctx.lastSource;

      player.stop();
      expect(source.stopCalls).toHaveLength(1);
      expect(source.disconnected).toBe(true);
      expect(player.state).toBe('loaded');

      await flush(); // the fake dispatches `ended` after stop(), as browsers do
      source.fireEnded(); // and even a late direct dispatch must be ignored
      expect(ended).not.toHaveBeenCalled();
      expect(player.state).toBe('loaded');
    });

    it('is idempotent and safe before start()', async () => {
      const player = await loadedPlayer(ctx);
      player.stop();
      expect(player.state).toBe('loaded');
      player.start({ audio: 0 });
      player.stop();
      player.stop();
      expect(ctx.lastSource.stopCalls).toHaveLength(1);
    });

    it('resumes a context it had suspended when stopped while paused', async () => {
      const player = await loadedPlayer(ctx);
      player.start({ audio: 0 });
      await player.pause();
      player.stop();
      await flush();
      expect(ctx.resumeCalls).toBe(1);
      expect(ctx.state).toBe('running');
      expect(player.state).toBe('loaded');
    });

    it('fires onEnded listeners once when the buffer runs out and moves to ended', async () => {
      const player = await loadedPlayer(ctx);
      const a = vi.fn();
      const b = vi.fn();
      const offA = player.onEnded(a);
      player.onEnded(b);
      player.start({ audio: 0 });

      offA();
      ctx.lastSource.fireEnded();
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
      expect(player.state).toBe('ended');

      // The clock keeps running after the end (result screen timing).
      ctx.currentTime = 10;
      expect(player.songMs()).toBeCloseTo(9900, 9);
    });

    it('lets a listener unsubscribe itself during dispatch', async () => {
      const player = await loadedPlayer(ctx);
      const calls: string[] = [];
      const off = player.onEnded(() => {
        calls.push('a');
        off();
      });
      player.onEnded(() => calls.push('b'));
      player.start({ audio: 0 });
      ctx.lastSource.fireEnded();
      expect(calls).toEqual(['a', 'b']);
    });
  });

  describe('destroy()', () => {
    it('stops playback, drops the buffer and listeners, and refuses further use', async () => {
      const player = await loadedPlayer(ctx);
      const ended = vi.fn();
      player.onEnded(ended);
      player.start({ audio: 0 });
      const source = ctx.lastSource;

      player.destroy();
      expect(source.stopCalls).toHaveLength(1);
      expect(player.state).toBe('idle');
      expect(player.durationMs).toBe(0);
      source.fireEnded();
      expect(ended).not.toHaveBeenCalled();

      await expect(player.load([SONG])).rejects.toThrow(/destroyed/);
      expect(() => player.start({ audio: 0 })).toThrow(/destroyed/);
      player.destroy(); // idempotent
    });

    it('discards a load() that was still in flight', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slowCtx = new FakeAudioContext({
        decode: async () => {
          await gate;
          const { FakeAudioBuffer } = await import('./fakes.ts');
          return new FakeAudioBuffer(1, 48000, 48000);
        },
      });
      const { fetch } = makeFetch({ [SONG]: { body: 'ok:1' } });
      vi.stubGlobal('fetch', fetch);
      const player = createSongPlayer(slowCtx.asReal());
      const pending = player.load([SONG]);
      player.destroy();
      release?.();
      await pending;
      expect(player.state).toBe('idle');
      expect(player.durationMs).toBe(0);
    });
  });
});
