import { describe, expect, it } from 'vitest';
import {
  HIT_SOUND,
  createHitSounds,
  hitSoundLength,
  mulberry32,
  renderDon,
  renderKat,
} from '../../src/audio/hitsounds.ts';
import { FakeAudioContext, type FakeAudioBuffer } from './fakes.ts';

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
}

const BIG_GAIN = Math.pow(10, HIT_SOUND.big.gainDb / 20);

describe('mulberry32', () => {
  it('is deterministic for a seed and uniform in [0, 1)', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(seqA).size).toBe(16);
    expect(mulberry32(1235)()).not.toBe(seqA[0]);
  });
});

describe('hitSoundLength', () => {
  it('matches the spec at 48 kHz: don 90 ms, kat 40 ms, big +40%', () => {
    expect(hitSoundLength('d', false, 48000)).toBe(4320);
    expect(hitSoundLength('d', true, 48000)).toBe(6048);
    expect(hitSoundLength('k', false, 48000)).toBe(1920);
    expect(hitSoundLength('k', true, 48000)).toBe(2688);
  });

  it('scales with the sample rate', () => {
    expect(hitSoundLength('d', false, 44100)).toBe(3969);
    expect(hitSoundLength('k', false, 44100)).toBe(1764);
    expect(hitSoundLength('k', true, 44100)).toBe(2470);
  });
});

describe('renderDon / renderKat', () => {
  it('produce buffers of the expected length', () => {
    expect(renderDon(48000, false)).toHaveLength(4320);
    expect(renderDon(48000, true)).toHaveLength(6048);
    expect(renderKat(48000, false)).toHaveLength(1920);
    expect(renderKat(48000, true)).toHaveLength(2688);
    expect(renderDon(44100, false)).toHaveLength(3969);
  });

  it('are deterministic: rendering twice gives identical samples', () => {
    expect(renderDon(48000, false)).toEqual(renderDon(48000, false));
    expect(renderDon(48000, true)).toEqual(renderDon(48000, true));
    expect(renderKat(48000, false)).toEqual(renderKat(48000, false));
    expect(renderKat(48000, true)).toEqual(renderKat(48000, true));
    expect(renderKat(44100, true)).toEqual(renderKat(44100, true));
  });

  it('do not depend on render order (each buffer seeds its own generator)', () => {
    const katFirst = renderKat(48000, false);
    renderDon(48000, true);
    renderDon(48000, false);
    expect(renderKat(48000, false)).toEqual(katFirst);
  });

  it('give the four variants distinct content', () => {
    const d = renderDon(48000, false);
    const k = renderKat(48000, false);
    expect(Array.from(d.slice(0, 64))).not.toEqual(Array.from(k.slice(0, 64)));
    expect(Array.from(renderDon(48000, true).slice(0, 64))).not.toEqual(Array.from(d.slice(0, 64)));
  });

  it('peak at the spec level, with big variants exactly +3 dB', () => {
    const d = renderDon(48000, false);
    const dBig = renderDon(48000, true);
    const k = renderKat(48000, false);
    const kBig = renderKat(48000, true);
    expect(peakOf(d)).toBeCloseTo(HIT_SOUND.peak, 5);
    expect(peakOf(k)).toBeCloseTo(HIT_SOUND.peak, 5);
    expect(peakOf(dBig) / peakOf(d)).toBeCloseTo(BIG_GAIN, 4);
    expect(peakOf(kBig) / peakOf(k)).toBeCloseTo(BIG_GAIN, 4);
    expect(peakOf(dBig)).toBeLessThan(1);
    expect(peakOf(kBig)).toBeLessThan(1);
  });

  it('end on silence and contain no NaN', () => {
    for (const buf of [renderDon(48000, false), renderDon(48000, true), renderKat(48000, false), renderKat(48000, true)]) {
      // The fade multiplies by 0, so the last sample may be -0; === treats both as zero.
      expect(buf[buf.length - 1] === 0).toBe(true);
      expect(Math.abs(buf[buf.length - 2] ?? 1)).toBeLessThan(0.05);
      for (const v of buf) expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('don has most of its energy at the start and decays (a thump, not a drone)', () => {
    const d = renderDon(48000, false);
    const quarter = Math.floor(d.length / 4);
    const rms = (from: number, to: number) => {
      let acc = 0;
      for (let i = from; i < to; i++) acc += (d[i] ?? 0) ** 2;
      return Math.sqrt(acc / (to - from));
    };
    expect(rms(0, quarter)).toBeGreaterThan(rms(quarter * 3, d.length) * 5);
  });

  it('kat is brighter than don: many more zero crossings per second', () => {
    const crossings = (buf: Float32Array) => {
      let n = 0;
      for (let i = 1; i < buf.length; i++) {
        const prev = buf[i - 1] ?? 0;
        const cur = buf[i] ?? 0;
        if ((prev < 0 && cur >= 0) || (prev >= 0 && cur < 0)) n++;
      }
      return n / (buf.length / 48000);
    };
    // A 55–140 Hz sweep crosses a few hundred times per second; 1.7 kHz + noise crosses thousands.
    expect(crossings(renderDon(48000, false))).toBeLessThan(1500);
    expect(crossings(renderKat(48000, false))).toBeGreaterThan(3000);
  });
});

describe('createHitSounds', () => {
  it('renders one mono buffer per variant into the context at load()', async () => {
    const ctx = new FakeAudioContext({ sampleRate: 48000 });
    const sounds = createHitSounds();
    await sounds.load(ctx.asReal());

    expect(ctx.buffers).toHaveLength(4);
    const lengths = ctx.buffers.map((b) => b.length).sort((a, b) => a - b);
    expect(lengths).toEqual([1920, 2688, 4320, 6048]);
    for (const b of ctx.buffers) {
      expect(b.numberOfChannels).toBe(1);
      expect(b.sampleRate).toBe(48000);
    }
  });

  it('uses the context sample rate', async () => {
    const ctx = new FakeAudioContext({ sampleRate: 44100 });
    const sounds = createHitSounds();
    await sounds.load(ctx.asReal());
    const lengths = ctx.buffers.map((b) => b.length).sort((a, b) => a - b);
    // 0.126 s × 44100 = 5556.6 → 5557
    expect(lengths).toEqual([1764, 2470, 3969, 5557]);
  });

  it('produces identical buffers on two independent instances', async () => {
    const a = new FakeAudioContext();
    const b = new FakeAudioContext();
    await createHitSounds().load(a.asReal());
    await createHitSounds().load(b.asReal());
    expect(a.buffers).toHaveLength(4);
    a.buffers.forEach((buf, i) => {
      expect(buf.getChannelData(0)).toEqual(b.buffers[i]?.getChannelData(0));
    });
  });

  it('does not re-render for the same context, but does for a different one', async () => {
    const ctx = new FakeAudioContext();
    const sounds = createHitSounds();
    await sounds.load(ctx.asReal());
    await sounds.load(ctx.asReal());
    expect(ctx.buffers).toHaveLength(4);
    const other = new FakeAudioContext({ sampleRate: 44100 });
    await sounds.load(other.asReal());
    expect(other.buffers).toHaveLength(4);
  });

  it('play() starts a fresh source through a fresh gain immediately', async () => {
    const ctx = new FakeAudioContext();
    const sounds = createHitSounds();
    await sounds.load(ctx.asReal());

    sounds.play('d');
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.gains).toHaveLength(1);
    const source = ctx.lastSource;
    const gain = ctx.lastGain;
    expect(source.startCalls).toEqual([undefined]);
    expect(source.startedAt).toBe(ctx.currentTime);
    expect(source.connections).toEqual([gain]);
    expect(gain.connections).toEqual([ctx.destination]);
    expect(gain.gain.value).toBe(1);
    expect(source.buffer?.length).toBe(4320);

    sounds.play('k');
    sounds.play('d', true);
    sounds.play('k', true);
    expect(ctx.sources.map((s) => s.buffer?.length)).toEqual([4320, 1920, 6048, 2688]);
    expect(ctx.gains).toHaveLength(4);
    expect(new Set(ctx.sources).size).toBe(4);
  });

  it('play() picks the buffer rendered for that variant', async () => {
    const ctx = new FakeAudioContext();
    const sounds = createHitSounds();
    await sounds.load(ctx.asReal());
    sounds.play('k', true);
    const played = ctx.lastSource.buffer as FakeAudioBuffer;
    expect(played.getChannelData(0)).toEqual(renderKat(48000, true));
  });

  it('play() before load() is a silent no-op', () => {
    const sounds = createHitSounds();
    expect(() => sounds.play('d')).not.toThrow();
    expect(() => sounds.play('k', true)).not.toThrow();
  });

  it('setVolume() applies to subsequent plays and clamps to [0, 1]', async () => {
    const ctx = new FakeAudioContext();
    const sounds = createHitSounds();
    await sounds.load(ctx.asReal());

    sounds.setVolume(0.35);
    sounds.play('d');
    expect(ctx.lastGain.gain.value).toBe(0.35);

    sounds.setVolume(4);
    sounds.play('d');
    expect(ctx.lastGain.gain.value).toBe(1);

    sounds.setVolume(-1);
    sounds.play('k');
    expect(ctx.lastGain.gain.value).toBe(0);

    sounds.setVolume(Number.NaN);
    sounds.play('k');
    expect(ctx.lastGain.gain.value).toBe(0);

    // Volume set before load() still applies.
    const late = createHitSounds();
    late.setVolume(0.5);
    const ctx2 = new FakeAudioContext();
    await late.load(ctx2.asReal());
    late.play('d');
    expect(ctx2.lastGain.gain.value).toBe(0.5);
  });
});
