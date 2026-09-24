/**
 * Hit sounds (PLAN §7): short AudioBuffers started the instant a key lands.
 *
 * No asset files. The four buffers (don / kat, regular / big) are synthesised
 * at load() time from a seeded generator, so a given sample rate always yields
 * the same samples. play() is fire-and-forget: a fresh BufferSource + GainNode
 * per hit, started immediately (sub-ms latency; the nodes are collected once
 * the buffer runs out).
 */
import type { NoteKind } from '../core/types.ts';
import type { HitSounds } from './types.ts';

const TWO_PI = Math.PI * 2;

/** Synthesis parameters. Lengths are in ms, levels are linear peak amplitude. */
export const HIT_SOUND = {
  /** Sine sweep 140→55 Hz with exponential decay, plus a soft (low-passed noise) click. */
  don: { ms: 90, sweepFromHz: 140, sweepToHz: 55, clickMs: 6, clickLevel: 0.35, clickLowpassHz: 3000 },
  /** 1.7 kHz sine plus a white-noise burst. */
  kat: { ms: 40, toneHz: 1700, toneLevel: 0.55, noiseLevel: 0.45 },
  /** Big variants: +40% length, +3 dB. */
  big: { lengthScale: 1.4, gainDb: 3 },
  /** Peak of a regular hit after normalisation; big = peak × 10^(gainDb/20). */
  peak: 0.5,
  /** Tails decay to −40 dB by the end of the buffer. */
  decayDb: 40,
  /** Linear fade over the last few ms so every buffer ends on zero. */
  tailFadeMs: 3,
} as const;

/** 'DYAD' as ASCII; each kind gets its own stream so big/regular share an attack. */
const SEED = 0x44594144;
const SEEDS: Record<NoteKind, number> = { d: SEED ^ 0xd0, k: SEED ^ 0x4b };

/** mulberry32: tiny, seedable, deterministic; returns uniform [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Amplitude decay constant k for exp(−k·t) reaching −decayDb at `seconds`. */
function decayConstant(seconds: number): number {
  return ((HIT_SOUND.decayDb / 20) * Math.LN10) / seconds;
}

/** Buffer length in samples for a kind/variant at the given sample rate. */
export function hitSoundLength(kind: NoteKind, big: boolean, sampleRate: number): number {
  const ms = kind === 'd' ? HIT_SOUND.don.ms : HIT_SOUND.kat.ms;
  return Math.round((ms / 1000) * (big ? HIT_SOUND.big.lengthScale : 1) * sampleRate);
}

/**
 * Tail fade + peak normalisation. Returns a new array; the input is not touched.
 * Big variants are normalised 3 dB above regular ones.
 */
function finalise(raw: Float32Array, sampleRate: number, big: boolean): Float32Array {
  const n = raw.length;
  const fade = Math.min(n, Math.max(1, Math.round((HIT_SOUND.tailFadeMs / 1000) * sampleRate)));
  const shaped = raw.map((v, i) => (i >= n - fade ? v * ((n - 1 - i) / fade) : v));

  let peak = 0;
  for (const v of shaped) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  if (peak === 0) return shaped;

  const target = HIT_SOUND.peak * (big ? dbToGain(HIT_SOUND.big.gainDb) : 1);
  const scale = target / peak;
  return shaped.map((v) => v * scale);
}

/** Don: a low thump. Exponential sweep 140→55 Hz over the whole length, soft click on top. */
export function renderDon(sampleRate: number, big: boolean): Float32Array {
  const { sweepFromHz, sweepToHz, clickMs, clickLevel, clickLowpassHz } = HIT_SOUND.don;
  const n = hitSoundLength('d', big, sampleRate);
  const duration = n / sampleRate;
  const out = new Float32Array(n);

  // f(t) = f0 · r^(t/T); its integral gives the phase, so the sweep is glitch-free.
  const ratio = sweepToHz / sweepFromHz;
  const phaseScale = (TWO_PI * sweepFromHz * duration) / Math.log(ratio);
  const bodyDecay = decayConstant(duration);

  const clickSeconds = clickMs / 1000;
  const clickDecay = decayConstant(clickSeconds) / 2;
  const lowpass = 1 - Math.exp((-TWO_PI * clickLowpassHz) / sampleRate);
  const rand = mulberry32(SEEDS.d);
  let filtered = 0;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const body = Math.sin(phaseScale * (Math.pow(ratio, t / duration) - 1)) * Math.exp(-bodyDecay * t);
    let click = 0;
    if (t < clickSeconds) {
      filtered += lowpass * (rand() * 2 - 1 - filtered);
      // Exponential decay × linear window: reaches exactly zero at clickMs.
      click = filtered * clickLevel * Math.exp(-clickDecay * t) * (1 - t / clickSeconds);
    }
    out[i] = body + click;
  }
  return finalise(out, sampleRate, big);
}

/** Kat: a bright rim click. 1.7 kHz tone and a faster-dying white-noise burst. */
export function renderKat(sampleRate: number, big: boolean): Float32Array {
  const { toneHz, toneLevel, noiseLevel } = HIT_SOUND.kat;
  const n = hitSoundLength('k', big, sampleRate);
  const duration = n / sampleRate;
  const out = new Float32Array(n);

  const toneDecay = decayConstant(duration);
  const noiseDecay = decayConstant(duration * 0.6);
  const rand = mulberry32(SEEDS.k);

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const tone = Math.sin(TWO_PI * toneHz * t) * Math.exp(-toneDecay * t);
    const noise = (rand() * 2 - 1) * Math.exp(-noiseDecay * t);
    out[i] = tone * toneLevel + noise * noiseLevel;
  }
  return finalise(out, sampleRate, big);
}

/** Render one variant into an AudioBuffer owned by `ctx` (mono, at the context's rate). */
function toBuffer(ctx: AudioContext, samples: Float32Array): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

interface Bank {
  ctx: AudioContext;
  d: AudioBuffer;
  dBig: AudioBuffer;
  k: AudioBuffer;
  kBig: AudioBuffer;
}

export function createHitSounds(): HitSounds {
  let bank: Bank | null = null;
  let volume = 1;

  return {
    async load(ctx: AudioContext): Promise<void> {
      if (bank && bank.ctx === ctx) return;
      const sr = ctx.sampleRate;
      bank = {
        ctx,
        d: toBuffer(ctx, renderDon(sr, false)),
        dBig: toBuffer(ctx, renderDon(sr, true)),
        k: toBuffer(ctx, renderKat(sr, false)),
        kBig: toBuffer(ctx, renderKat(sr, true)),
      };
    },

    play(kind: NoteKind, big = false): void {
      if (!bank) return;
      const buffer = kind === 'd' ? (big ? bank.dBig : bank.d) : big ? bank.kBig : bank.k;
      const { ctx } = bank;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start();
    },

    setVolume(v: number): void {
      volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    },
  };
}
