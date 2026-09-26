import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from './fakes.ts';

/** A constructible stand-in for the global AudioContext that records its options. */
class StubAudioContext extends FakeAudioContext {
  static instances: StubAudioContext[] = [];
  readonly options: AudioContextOptions | undefined;

  constructor(options?: AudioContextOptions) {
    super();
    this.options = options;
    // A context constructed outside a gesture starts suspended.
    this.state = 'suspended';
    StubAudioContext.instances.push(this);
  }
}

async function freshModule() {
  vi.resetModules();
  return import('../../src/audio/context.ts');
}

describe('getAudioContext / resumeAudio', () => {
  beforeEach(() => {
    StubAudioContext.instances = [];
    vi.stubGlobal('AudioContext', StubAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the context lazily with latencyHint "interactive" and returns the same instance', async () => {
    const { getAudioContext } = await freshModule();
    expect(StubAudioContext.instances).toHaveLength(0);

    const a = getAudioContext();
    const b = getAudioContext();
    expect(a).toBe(b);
    expect(StubAudioContext.instances).toHaveLength(1);
    expect(StubAudioContext.instances[0]?.options).toEqual({ latencyHint: 'interactive' });
  });

  it('replaces a context that has been closed', async () => {
    const { getAudioContext } = await freshModule();
    const first = getAudioContext() as unknown as StubAudioContext;
    first.state = 'closed';
    const second = getAudioContext();
    expect(second).not.toBe(first);
    expect(StubAudioContext.instances).toHaveLength(2);
  });

  it('throws a clear error when Web Audio is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { getAudioContext } = await freshModule();
    expect(() => getAudioContext()).toThrow(/Web Audio is not available/);
  });

  it('plays a one-frame silent buffer inside the gesture and resumes a suspended context', async () => {
    const { getAudioContext, resumeAudio } = await freshModule();
    const ctx = getAudioContext() as unknown as StubAudioContext;

    await resumeAudio();

    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe('running');
    expect(ctx.sources).toHaveLength(1);
    const silent = ctx.sources[0];
    expect(silent?.startCalls).toEqual([0]);
    expect(silent?.connections).toEqual([ctx.destination]);
    expect(silent?.buffer?.length).toBe(1);
    expect(silent?.buffer?.numberOfChannels).toBe(1);
    expect(silent?.buffer?.sampleRate).toBe(ctx.sampleRate);
  });

  it('does not repeat the unlock trick once the context is running, and skips resume() when running', async () => {
    const { getAudioContext, resumeAudio } = await freshModule();
    const ctx = getAudioContext() as unknown as StubAudioContext;
    await resumeAudio();
    await resumeAudio();
    await resumeAudio();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.resumeCalls).toBe(1);
  });

  it('retries the unlock trick while the context stays suspended (call was outside a gesture)', async () => {
    const { getAudioContext, resumeAudio } = await freshModule();
    const ctx = getAudioContext() as unknown as StubAudioContext;
    // Model a browser that ignores resume() outside a user gesture.
    vi.spyOn(ctx, 'resume').mockImplementation(async () => {
      ctx.resumeCalls++;
    });

    await resumeAudio();
    await resumeAudio();
    expect(ctx.state).toBe('suspended');
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.resumeCalls).toBe(2);

    // Now inside a gesture: resume succeeds and later calls stop spending the trick.
    vi.restoreAllMocks();
    await resumeAudio();
    expect(ctx.state).toBe('running');
    expect(ctx.sources).toHaveLength(3);
    await resumeAudio();
    expect(ctx.sources).toHaveLength(3);
  });

  it('creates the context on first resumeAudio() if none exists yet', async () => {
    const { resumeAudio, getAudioContext } = await freshModule();
    await resumeAudio();
    expect(StubAudioContext.instances).toHaveLength(1);
    expect(getAudioContext()).toBe(StubAudioContext.instances[0]);
  });
});

describe('audioOutput / setMasterVolume', () => {
  it('gives each context one master gain into its destination', async () => {
    const { audioOutput } = await freshModule();
    const ctx = new FakeAudioContext();
    const out = audioOutput(ctx.asReal());
    expect(audioOutput(ctx.asReal())).toBe(out);
    expect(ctx.gains).toEqual([out]);
    expect(ctx.lastGain.connections).toEqual([ctx.destination]);
  });

  it('applies the volume to existing and later masters, clamped to 0–1', async () => {
    const { audioOutput, setMasterVolume } = await freshModule();
    const a = new FakeAudioContext();
    audioOutput(a.asReal());
    setMasterVolume(0.4);
    expect(a.lastGain.gain.value).toBe(0.4);

    const b = new FakeAudioContext();
    audioOutput(b.asReal());
    expect(b.lastGain.gain.value).toBe(0.4);

    setMasterVolume(3);
    expect(a.lastGain.gain.value).toBe(1);
    setMasterVolume(NaN);
    expect(b.lastGain.gain.value).toBe(0);
  });

  it('never creates a context by itself', async () => {
    vi.stubGlobal('AudioContext', StubAudioContext);
    StubAudioContext.instances = [];
    const { setMasterVolume } = await freshModule();
    setMasterVolume(0.5);
    expect(StubAudioContext.instances).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
