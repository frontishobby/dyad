import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBE_FILE, baseUrl, probeWebmOpus } from '../../src/audio/probe.ts';
import type { ProbeWebmOpus } from '../../src/audio/types.ts';
import { FakeAudioBuffer, FakeAudioContext, makeFetch } from './fakes.ts';

describe('probeWebmOpus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is assignable to the ProbeWebmOpus contract', () => {
    const probe: ProbeWebmOpus = probeWebmOpus;
    expect(typeof probe).toBe('function');
  });

  it('resolves true when the file fetches and decodes', async () => {
    const { fetch } = makeFetch({ '/probe.webm': { body: 'ok:1' } });
    vi.stubGlobal('fetch', fetch);
    const ctx = new FakeAudioContext();
    await expect(probeWebmOpus(ctx.asReal(), '/probe.webm')).resolves.toBe(true);
    expect(ctx.decodeCalls).toHaveLength(1);
  });

  it('resolves false when the decoder rejects', async () => {
    const { fetch } = makeFetch({ '/probe.webm': { body: 'not-opus' } });
    vi.stubGlobal('fetch', fetch);
    const ctx = new FakeAudioContext();
    await expect(probeWebmOpus(ctx.asReal(), '/probe.webm')).resolves.toBe(false);
    expect(ctx.decodeCalls).toHaveLength(1);
  });

  it('resolves false when the decoder throws synchronously', async () => {
    const ctx = new FakeAudioContext({
      decode: () => {
        throw new TypeError('decodeAudioData is not a function');
      },
    });
    const { fetch } = makeFetch({ '/probe.webm': { body: 'ok:1' } });
    vi.stubGlobal('fetch', fetch);
    await expect(probeWebmOpus(ctx.asReal(), '/probe.webm')).resolves.toBe(false);
  });

  it('resolves false on a non-ok response without decoding', async () => {
    const { fetch } = makeFetch({ '/probe.webm': { status: 404, body: 'ok:1' } });
    vi.stubGlobal('fetch', fetch);
    const ctx = new FakeAudioContext();
    await expect(probeWebmOpus(ctx.asReal(), '/probe.webm')).resolves.toBe(false);
    expect(ctx.decodeCalls).toHaveLength(0);
  });

  it('resolves false when fetch itself fails', async () => {
    const { fetch } = makeFetch({ '/probe.webm': { throws: true } });
    vi.stubGlobal('fetch', fetch);
    const ctx = new FakeAudioContext();
    await expect(probeWebmOpus(ctx.asReal(), '/probe.webm')).resolves.toBe(false);
  });

  it('resolves false when fetch is unavailable', async () => {
    vi.stubGlobal('fetch', undefined);
    const ctx = new FakeAudioContext();
    await expect(probeWebmOpus(ctx.asReal(), '/probe.webm')).resolves.toBe(false);
  });

  it('resolves false when the decoded buffer is empty', async () => {
    const ctx = new FakeAudioContext({ decode: async () => new FakeAudioBuffer(1, 0, 48000) });
    const { fetch } = makeFetch({ '/probe.webm': { body: 'ok:1' } });
    vi.stubGlobal('fetch', fetch);
    await expect(probeWebmOpus(ctx.asReal(), '/probe.webm')).resolves.toBe(false);
  });

  it('defaults to <BASE_URL>probe.webm', async () => {
    const { fetch, calls } = makeFetch({});
    vi.stubGlobal('fetch', fetch);
    const ctx = new FakeAudioContext();
    await probeWebmOpus(ctx.asReal());
    expect(calls).toHaveLength(1);
    const url = calls[0] ?? '';
    expect(url.endsWith(`/${PROBE_FILE}`)).toBe(true);
    expect(url).toBe(baseUrl() + PROBE_FILE);
  });
});

describe('baseUrl', () => {
  it('always ends with a slash', () => {
    const base = baseUrl();
    expect(base.endsWith('/')).toBe(true);
    expect(base.length).toBeGreaterThan(0);
  });
});
