import { describe, expect, it } from 'vitest';
import type {
  Chart,
  Engine,
  EngineConfig,
  EngineEvent,
  EngineState,
  InputLogEntry,
  Key,
  NoteView,
} from '../../src/core/types.ts';
import type { InputEvent } from '../../src/input/types.ts';
import { PlayLoop, type FrameScheduler, type LoopCollaborators } from '../../src/ui/play/loop.ts';
import { createPressHandler, isBigHit } from '../../src/ui/play/press.ts';

// ─── fakes ──────────────────────────────────────────────────────────────────

const chart: Chart = {
  version: 1,
  meta: { title: 't', artist: 'a', difficulty: 'Oni', bpm: [100, 100], od: 5, hp: 5 },
  timing: [{ t: 0, beatLength: 600, meter: 4 }],
  notes: [{ t: 1000, k: 'd', big: false }],
  rolls: [],
  spinners: [],
  hash: 'h',
};

const config: EngineConfig = { windows: { great: 50, ok: 100, miss: 150 }, bigWindowMs: 30 };

function noteEvent(judgement: 'great' | 'ok' | 'miss', big = false): EngineEvent {
  return { type: 'note', index: 0, judgement, deltaMs: 0, key: 'DL', big, strong: false };
}

/** A full Engine whose tick/hit are scripted and whose calls are traced. */
function fakeEngine(trace: string[]) {
  const state: EngineState = {
    score: 0,
    accuracy: 1,
    combo: 0,
    maxCombo: 0,
    counts: { great: 0, ok: 0, miss: 0 },
    rollTicks: 0,
    spinnerTicks: 0,
    judged: 0,
    total: 1,
    finished: false,
  };
  const log: InputLogEntry[] = [];
  let nextTickEvents: EngineEvent[] = [];
  let nextHitEvents: EngineEvent[] = [];
  const hits: { key: Key; hitMs: number }[] = [];
  const ticks: number[] = [];
  const engine: Engine = {
    chart,
    config,
    state,
    log,
    tick(songMs) {
      trace.push('tick');
      ticks.push(songMs);
      const out = nextTickEvents;
      nextTickEvents = [];
      return out;
    },
    hit(key, hitMs) {
      trace.push('hit');
      hits.push({ key, hitMs });
      log.push([hitMs, key]);
      const out = nextHitEvents;
      nextHitEvents = [];
      return out;
    },
    noteView(): NoteView {
      return { status: 'pending', judgement: null, awaitingPartner: false, strong: false };
    },
    firstPending: () => 0,
  };
  return {
    engine,
    state,
    hits,
    ticks,
    queueTick: (events: EngineEvent[]) => {
      nextTickEvents = events;
    },
    queueHit: (events: EngineEvent[]) => {
      nextHitEvents = events;
    },
  };
}

function manualScheduler() {
  const queue = new Map<number, (frameTimeMs?: number) => void>();
  let id = 0;
  const scheduler: FrameScheduler = {
    request: (cb) => {
      id++;
      queue.set(id, cb);
      return id;
    },
    cancel: (handle) => {
      queue.delete(handle);
    },
  };
  return {
    scheduler,
    pending: () => queue.size,
    /** Run every frame callback queued so far (not ones queued while running). */
    flush: (frameTimeMs?: number) => {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(frameTimeMs);
    },
  };
}

function harness() {
  const trace: string[] = [];
  const eng = fakeEngine(trace);
  const sched = manualScheduler();
  let songMs = 0;
  let finished = 0;
  const applied: { events: readonly EngineEvent[]; songMs: number }[] = [];
  const hudFrames: { songMs: number; state: EngineState }[] = [];
  const hudNotes: (readonly EngineEvent[])[] = [];
  const collaborators: LoopCollaborators = {
    player: {
      syncClock: () => {
        trace.push('syncClock');
      },
      songMs: () => {
        trace.push('songMs');
        return songMs;
      },
    },
    gamepad: {
      poll: () => {
        trace.push('poll');
      },
    },
    engine: eng.engine,
    renderer: {
      apply: (events, ms) => {
        trace.push('apply');
        applied.push({ events, songMs: ms });
      },
      frame: (ms, engine) => {
        trace.push('frame');
        expect(engine).toBe(eng.engine);
        expect(ms).toBe(songMs);
      },
    },
    hud: {
      frame: (ms, state) => {
        trace.push('hudFrame');
        hudFrames.push({ songMs: ms, state: { ...state } });
      },
      noteEvents: (events) => {
        trace.push('hudNotes');
        hudNotes.push(events);
      },
    },
    stage: {
      render: () => {
        trace.push('render');
      },
    },
    onFinished: () => {
      finished++;
    },
    scheduler: sched.scheduler,
  };
  const loop = new PlayLoop(collaborators);
  return {
    loop,
    trace,
    eng,
    sched,
    applied,
    hudFrames,
    hudNotes,
    finished: () => finished,
    setSongMs: (ms: number) => {
      songMs = ms;
    },
  };
}

// ─── loop ───────────────────────────────────────────────────────────────────

describe('PlayLoop', () => {
  it('runs syncClock → poll → tick → frame → hud → render in that order', () => {
    const h = harness();
    h.setSongMs(1234);
    h.loop.step();
    expect(h.trace).toEqual(['syncClock', 'poll', 'songMs', 'tick', 'frame', 'hudFrame', 'render']);
    expect(h.eng.ticks).toEqual([1234]);
    expect(h.hudFrames[0]?.songMs).toBe(1234);
  });

  it('ticks the engine on a clock that trails songMs by tickLagMs while rendering on the plain clock', () => {
    const h = harness();
    const eng = h.eng;
    let lag = 40;
    const loop = new PlayLoop({
      player: { syncClock() {}, songMs: () => 5000 },
      engine: eng.engine,
      renderer: { apply() {}, frame: (ms) => expect(ms).toBe(5000) },
      hud: { frame: (ms) => expect(ms).toBe(5000), noteEvents() {} },
      stage: { render() {} },
      scheduler: manualScheduler().scheduler,
      tickLagMs: () => lag,
    });
    loop.step();
    lag = 0;
    loop.step();
    lag = -25; // a negative or non-finite lag never runs the tick clock ahead of the render clock
    loop.step();
    lag = Number.NaN;
    loop.step();
    expect(eng.ticks).toEqual([4960, 5000, 5000, 5000]);
  });

  it('renderClock: the renderer and HUD draw the smoothed clock, the engine ticks on the raw one, reset on start', () => {
    const h = harness();
    const eng = h.eng;
    const seen: { raw: number; frame: number }[] = [];
    let resets = 0;
    const frames: number[] = [];
    const hudMs: number[] = [];
    const sched = manualScheduler();
    const loop = new PlayLoop({
      player: { syncClock() {}, songMs: () => 5000 },
      engine: eng.engine,
      renderer: { apply() {}, frame: (ms) => frames.push(ms) },
      hud: { frame: (ms) => hudMs.push(ms), noteEvents() {} },
      stage: { render() {} },
      scheduler: sched.scheduler,
      renderClock: {
        next: (raw, frame) => {
          seen.push({ raw, frame });
          return raw + 7; // whatever the smoother says goes to the drawing side only
        },
        reset: () => {
          resets++;
        },
      },
    });
    loop.step(123);
    expect(seen).toEqual([{ raw: 5000, frame: 123 }]);
    expect(frames).toEqual([5007]);
    expect(hudMs).toEqual([5007]);
    expect(eng.ticks).toEqual([5000]);
    // The scheduler's frame timestamp reaches the clock; start() resets it.
    loop.start();
    expect(resets).toBe(1);
    sched.flush(456);
    expect(seen[1]).toEqual({ raw: 5000, frame: 456 });
    loop.stop();
  });

  it('applies tick events to the renderer and the HUD before drawing, only when there are any', () => {
    const h = harness();
    h.eng.queueTick([noteEvent('miss')]);
    h.setSongMs(2000);
    h.loop.step();
    expect(h.trace).toEqual(['syncClock', 'poll', 'songMs', 'tick', 'apply', 'hudNotes', 'frame', 'hudFrame', 'render']);
    expect(h.applied).toEqual([{ events: [noteEvent('miss')], songMs: 2000 }]);
    expect(h.hudNotes).toEqual([[noteEvent('miss')]]);
    h.trace.length = 0;
    h.loop.step();
    expect(h.trace).not.toContain('apply');
    expect(h.applied).toHaveLength(1);
  });

  it('start schedules one frame at a time and stop cancels the pending one', () => {
    const h = harness();
    h.loop.start();
    expect(h.loop.running).toBe(true);
    expect(h.sched.pending()).toBe(1);
    h.loop.start();
    expect(h.sched.pending()).toBe(1);
    h.sched.flush();
    expect(h.loop.frames).toBe(1);
    expect(h.sched.pending()).toBe(1);
    h.loop.stop();
    expect(h.loop.running).toBe(false);
    expect(h.sched.pending()).toBe(0);
    h.sched.flush();
    expect(h.loop.frames).toBe(1);
  });

  it('a frame that stops the loop from inside does not reschedule', () => {
    const h = harness();
    h.eng.state.finished = true;
    const stopping = new PlayLoop({
      player: { syncClock() {}, songMs: () => 0 },
      engine: h.eng.engine,
      renderer: { apply() {}, frame() {} },
      hud: { frame() {}, noteEvents() {} },
      stage: { render() {} },
      onFinished: () => stopping.stop(),
      scheduler: h.sched.scheduler,
    });
    stopping.start();
    h.sched.flush();
    expect(stopping.running).toBe(false);
    expect(h.sched.pending()).toBe(0);
  });

  it('reports finished exactly once, from the frame in which the engine finished', () => {
    const h = harness();
    h.loop.step();
    expect(h.finished()).toBe(0);
    h.eng.state.finished = true;
    h.loop.step();
    expect(h.finished()).toBe(1);
    h.loop.step();
    h.loop.step();
    expect(h.finished()).toBe(1);
  });

  it('polls the gamepad before tick so its edges are judged in the same frame, and tolerates no gamepad', () => {
    const h = harness();
    h.loop.step();
    expect(h.trace.indexOf('poll')).toBeLessThan(h.trace.indexOf('tick'));
    const trace: string[] = [];
    const eng = fakeEngine(trace);
    const loop = new PlayLoop({
      player: { syncClock() {}, songMs: () => 0 },
      gamepad: null,
      engine: eng.engine,
      renderer: { apply() {}, frame() {} },
      hud: { frame() {}, noteEvents() {} },
      stage: { render() {} },
      scheduler: manualScheduler().scheduler,
    });
    loop.step();
    expect(trace).toEqual(['tick']);
  });
});

// ─── press handler ──────────────────────────────────────────────────────────

function pressHarness(playing = true) {
  const trace: string[] = [];
  const eng = fakeEngine(trace);
  const pressed: { key: Key; down: boolean }[] = [];
  const applied: { events: readonly EngineEvent[]; songMs: number }[] = [];
  const sounds: { kind: 'd' | 'k'; big: boolean | undefined }[] = [];
  const hudNotes: (readonly EngineEvent[])[] = [];
  let inputOffset = 0;
  const handler = createPressHandler({
    player: {
      hitMs: (timeStamp) => {
        trace.push('hitMs');
        // performance 5000 ms ↔ song 1000 ms in this fake.
        return timeStamp - 4000;
      },
    },
    engine: eng.engine,
    renderer: {
      press: (key, down) => {
        trace.push(down ? 'pressDown' : 'pressUp');
        pressed.push({ key, down });
      },
      apply: (events, songMs) => {
        trace.push('apply');
        applied.push({ events, songMs });
      },
    },
    hitSounds: {
      play: (kind, big) => {
        trace.push('sound');
        sounds.push({ kind, big });
      },
    },
    hud: {
      noteEvents: (events) => {
        trace.push('hudNotes');
        hudNotes.push(events);
      },
    },
    inputOffset: () => inputOffset,
    isPlaying: () => playing,
  });
  const event = (key: Key, down: boolean, timeStamp: number): InputEvent => ({ key, down, timeStamp, source: 'keyboard' });
  return {
    handler,
    trace,
    eng,
    pressed,
    applied,
    sounds,
    hudNotes,
    event,
    setInputOffset: (ms: number) => {
      inputOffset = ms;
    },
  };
}

describe('createPressHandler', () => {
  it('judges synchronously inside the event with the converted timestamp minus the input offset', () => {
    const h = pressHarness();
    h.setInputOffset(12);
    h.eng.queueHit([noteEvent('great')]);
    h.handler(h.event('DL', true, 5000));
    expect(h.trace).toEqual(['pressDown', 'hitMs', 'hit', 'sound', 'apply', 'hudNotes']);
    expect(h.eng.hits).toEqual([{ key: 'DL', hitMs: 988 }]);
    expect(h.applied).toEqual([{ events: [noteEvent('great')], songMs: 988 }]);
    expect(h.sounds).toEqual([{ kind: 'd', big: false }]);
    expect(h.hudNotes).toEqual([[noteEvent('great')]]);
  });

  it('a press between frames is judged before the next frame ticks', () => {
    const h = harness();
    const handler = createPressHandler({
      player: { hitMs: (ts) => ts },
      engine: h.eng.engine,
      renderer: { press() {}, apply() {} },
      hitSounds: { play() {} },
      hud: { noteEvents() {} },
      inputOffset: () => 0,
      isPlaying: () => true,
    });
    h.loop.start();
    // The frame is queued but has not run; the press must not wait for it.
    handler({ key: 'KR', down: true, timeStamp: 777, source: 'touch' });
    expect(h.eng.hits).toEqual([{ key: 'KR', hitMs: 777 }]);
    expect(h.eng.ticks).toEqual([]);
    h.sched.flush();
    expect(h.trace.indexOf('hit')).toBeLessThan(h.trace.indexOf('tick'));
    expect(h.eng.engine.log).toEqual([[777, 'KR']]);
  });

  it('releases only light the gate; presses while not playing light the gate but are not judged', () => {
    const idle = pressHarness(false);
    idle.handler(idle.event('KL', true, 100));
    idle.handler(idle.event('KL', false, 150));
    expect(idle.trace).toEqual(['pressDown', 'pressUp']);
    expect(idle.eng.hits).toEqual([]);
    expect(idle.sounds).toEqual([]);

    const live = pressHarness(true);
    live.handler(live.event('DR', false, 150));
    expect(live.trace).toEqual(['pressUp']);
    expect(live.eng.hits).toEqual([]);
  });

  it('plays the hit sound for the key type, big when the press landed on a big note', () => {
    const h = pressHarness();
    h.eng.queueHit([noteEvent('ok', true)]);
    h.handler(h.event('KL', true, 5000));
    h.eng.queueHit([noteEvent('ok', true)]);
    h.handler(h.event('KR', true, 5010));
    h.eng.queueHit([noteEvent('miss', true)]);
    h.handler(h.event('DL', true, 5400));
    h.eng.queueHit([]);
    h.handler(h.event('DR', true, 5800));
    expect(h.sounds).toEqual([
      { kind: 'k', big: true },
      { kind: 'k', big: true },
      { kind: 'd', big: false },
      { kind: 'd', big: false },
    ]);
  });

  it('isBigHit', () => {
    expect(isBigHit([])).toBe(false);
    expect(isBigHit([noteEvent('great', false)])).toBe(false);
    expect(isBigHit([noteEvent('great', true)])).toBe(true);
    expect(isBigHit([noteEvent('miss', true)])).toBe(false);
    expect(isBigHit([{ type: 'roll-tick', index: 0, key: 'DL' }, noteEvent('great', true)])).toBe(true);
  });
});
