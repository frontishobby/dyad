/**
 * End-to-end timing: the real SongPlayer (on a fake AudioContext), the real
 * engine, the real PlayLoop with the smoothed render clock, and the real press
 * handler. A "player" who taps the instant a note is DRAWN on the ring must be
 * judged Great/OK, lead-in and all. Guards the audio clock ↔ event clock ↔
 * render clock agreement that the game stands on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSongPlayer } from '../../src/audio/player.ts';
import { createEngine, defaultConfig } from '../../src/core/index.ts';
import type { Chart, EngineEvent, Key } from '../../src/core/types.ts';
import { PlayLoop, type FrameScheduler } from '../../src/ui/play/loop.ts';
import { createPressHandler } from '../../src/ui/play/press.ts';
import { createSmoothClock } from '../../src/ui/play/smooth.ts';
import { FakeAudioContext, makeFetch } from '../audio/fakes.ts';

const SONG = '/songs/sim/audio.abc.webm';
const OUTPUT_LATENCY_S = 0.2;

function chart(): Chart {
  const notes: Chart['notes'] = [];
  for (let i = 0; i < 40; i++) notes.push({ t: 1000 + i * 400, k: i % 2 === 0 ? 'd' : 'k', big: false });
  return {
    version: 1,
    meta: { title: 't', artist: 'a', difficulty: 'x', bpm: [150, 150], od: 5, hp: 5 },
    timing: [{ t: 0, beatLength: 400, meter: 4 }],
    notes,
    rolls: [],
    spinners: [],
    hash: 'h'.repeat(64),
  };
}

describe('play pipeline timing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([0, 3000])('taps on the drawn note are Great/OK with a %d ms lead-in', async (leadInMs) => {
    const ctx = new FakeAudioContext({ outputTimestamp: true });
    const { fetch } = makeFetch({ [SONG]: { body: 'ok:30' } });
    vi.stubGlobal('fetch', fetch);
    const player = createSongPlayer(ctx.asReal());
    await player.load([SONG]);

    // One wall clock: performance ms P; the context runs at P/1000 − base and
    // reports what is being heard OUTPUT_LATENCY_S behind.
    let P = 50_000;
    vi.spyOn(performance, 'now').mockImplementation(() => P); // the player projects the heard clock to now
    const base = 40; // seconds the context had been alive
    const tickClocks = (): void => {
      ctx.currentTime = P / 1000 - base;
      ctx.outputTimestamp = { contextTime: ctx.currentTime - OUTPUT_LATENCY_S, performanceTime: P };
    };
    tickClocks();

    const c = chart();
    const engine = createEngine(c, defaultConfig());
    let renderMs = Number.NaN;
    const scheduler: FrameScheduler = { request: () => 1, cancel: () => {} };
    const loop = new PlayLoop({
      player,
      engine,
      renderer: { apply() {}, frame: (ms) => (renderMs = ms) },
      hud: { frame() {}, noteEvents() {} },
      stage: { render() {} },
      scheduler,
      tickLagMs: () => 16,
      renderClock: createSmoothClock(),
    });
    const judged: EngineEvent[] = [];
    const press = createPressHandler({
      player,
      engine,
      renderer: { apply: (events) => judged.push(...events), press() {} },
      hitSounds: { play() {} },
      hud: { noteEvents() {} },
      inputOffset: () => 0,
      isPlaying: () => true,
    });

    player.start({ audio: 0, leadInMs });
    loop.start();
    let next = 0;
    const keyFor = (k: 'd' | 'k'): Key => (k === 'd' ? 'DL' : 'KL');
    // 60 fps for the whole chart. The tap comes on the first frame that draws the note on the ring.
    for (let frame = 0; frame < 1500; frame++) {
      P += 1000 / 60;
      tickClocks();
      loop.step(P);
      const note = c.notes[next];
      if (note && renderMs >= note.t) {
        press({ key: keyFor(note.k), down: true, timeStamp: P, source: 'keyboard' });
        press({ key: keyFor(note.k), down: false, timeStamp: P, source: 'keyboard' });
        next++;
      }
    }
    loop.stop();

    expect(next).toBe(c.notes.length);
    const noteEvents = judged.filter((e) => e.type === 'note');
    expect(noteEvents).toHaveLength(c.notes.length);
    expect(engine.state.counts.miss).toBe(0);
    // A frame of quantisation plus output latency: well inside OK (±50 ms), mostly Great (±30 ms).
    expect(engine.state.counts.great).toBeGreaterThan(c.notes.length / 2);
  });
});
