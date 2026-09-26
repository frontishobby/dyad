import { describe, expect, it } from 'vitest';
import { PREVIEW_GAIN, PREVIEW_LENGTH_MS, createPreviewPlayer } from '../../src/audio/preview.ts';
import { FakeAudioContext, flush, makeFetch } from './fakes.ts';

const URL_A = '/songs/a/audio.webm';
const URL_B = '/songs/b/audio.webm';

function setup() {
  const ctx = new FakeAudioContext();
  const { fetch } = makeFetch({ [URL_A]: { body: 'ok:60' }, [URL_B]: { body: 'ok:60' } });
  const preview = createPreviewPlayer(ctx.asReal(), fetch as unknown as typeof globalThis.fetch);
  return { ctx, preview };
}

describe('createPreviewPlayer', () => {
  it('loops a slice from the preview point and fades in', async () => {
    const { ctx, preview } = setup();
    ctx.currentTime = 2;
    preview.play(URL_A, 10_000);
    await flush();

    const source = ctx.lastSource;
    expect(source.startCalls).toEqual([2]);
    expect(source.startOffset).toBe(10);
    expect(source.loop).toBe(true);
    expect([source.loopStart, source.loopEnd]).toEqual([10, 10 + PREVIEW_LENGTH_MS / 1000]);
    const gain = ctx.gains[0];
    expect(source.connections).toEqual([gain]);
    expect(gain?.gain.ramps.at(-1)?.value).toBe(PREVIEW_GAIN);
  });

  it('pause() fades out and resume() picks up at the same point in the slice', async () => {
    const { ctx, preview } = setup();
    preview.play(URL_A, 10_000);
    await flush();
    const first = ctx.lastSource;

    ctx.currentTime = 3.5;
    preview.pause();
    expect(first.stopCalls).toHaveLength(1);

    ctx.currentTime = 40;
    preview.resume();
    await flush();
    const second = ctx.lastSource;
    expect(second).not.toBe(first);
    expect(second.startCalls).toEqual([40]);
    expect(second.startOffset).toBeCloseTo(13.5, 9);
    expect([second.loopStart, second.loopEnd]).toEqual([first.loopStart, first.loopEnd]);
  });

  it('wraps the resume point around the loop', async () => {
    const { ctx, preview } = setup();
    preview.play(URL_A, 10_000);
    await flush();
    ctx.currentTime = PREVIEW_LENGTH_MS / 1000 + 1;
    preview.pause();
    preview.resume();
    await flush();
    expect(ctx.lastSource.startOffset).toBeCloseTo(11, 9);
  });

  it('play() while paused waits for resume() and starts from the new preview point', async () => {
    const { ctx, preview } = setup();
    preview.pause();
    preview.play(URL_B, 5_000);
    await flush();
    expect(ctx.sources).toHaveLength(0);

    preview.resume();
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.lastSource.startOffset).toBe(5);
  });

  it('a decode that lands after pause() does not start', async () => {
    const { ctx, preview } = setup();
    preview.play(URL_A, 0);
    preview.pause();
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });

  it('resume() after stop() stays silent', async () => {
    const { ctx, preview } = setup();
    preview.play(URL_A, 0);
    await flush();
    preview.pause();
    preview.stop();
    preview.resume();
    await flush();
    expect(ctx.sources).toHaveLength(1);
  });
});
