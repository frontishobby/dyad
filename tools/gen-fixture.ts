/**
 * Deterministic fixture song "Twin Pulse" (150 BPM, 4/4, ~72 s).
 *
 * ONE pattern definition (PATTERN below) drives both the `.osu` chart and the
 * synthesised WAV, so every audible hit sits exactly on its note. Nothing here
 * uses Math.random: noise comes from a seeded PRNG, so the same code always
 * writes the same bytes.
 *
 * Outputs (songs-src/twin-pulse/):
 *   easy.osu, normal.osu, hard.osu   osu!taiko charts (Mode 1), one per tier;
 *                hard is PATTERN itself, normal and easy are subsets of it
 *                (tierEvents), so the audio — synthesised from hard — has a
 *                hit under every note of every tier
 *   song.wav     44100 Hz, 16-bit, stereo PCM
 *   song.json    { title, artist, audioOffset } — the human-edited metadata
 *   jacket.png   1024×1024 duotone composition from the DESIGN tokens
 *
 * CLI: node tools/gen-fixture.ts [outDir]   (npm run songs:fixture)
 */
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TIERS, type Tier } from '../src/app/types.ts';
import { DARK, SHAPE } from '../src/design/tokens.ts';
import type { Theme } from '../src/design/tokens.ts';
import { writeIfChanged } from './lib/fsx.ts';
import { mulberry32 } from './lib/prng.ts';
import type { Prng } from './lib/prng.ts';
import { encodeWav16 } from './lib/wav.ts';

// ─── song constants ─────────────────────────────────────────────────────────

export const FIXTURE_ID = 'twin-pulse';
export const TITLE = 'Twin Pulse';
export const ARTIST = 'DYAD';
/** [Metadata] Version per tier. */
export const TIER_VERSION: Record<Tier, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
/** @deprecated the hard tier's Version; kept for older imports. */
export const DIFFICULTY = TIER_VERSION.hard;
export const BPM = 150;
export const METER = 4;
/** ms per beat: 400. */
export const BEAT_MS = 60000 / BPM;
/** ms per 16th-note slot: 100. */
export const SLOT_MS = BEAT_MS / 4;
export const SLOTS_PER_BAR = METER * 4;
export const BAR_MS = BEAT_MS * METER;
/** Silence before the first bar. */
export const LEAD_IN_MS = 2000;
/** Silence after the last bar so the final pad can ring out. */
export const TAIL_MS = 400;
export const SAMPLE_RATE = 44100;
export const OD = 5;
export const HP = 5;
export const SLIDER_MULTIPLIER = 1.4;
export const PRNG_SEED = 0x0d1ad;

/**
 * The pattern. One string per bar, sixteen slots (16th notes at 150 BPM =
 * 100 ms each); the spaces between beats are decoration and are stripped.
 *
 *   d / k   don / kat            D / K   big don / big kat
 *   r / R   drumroll starts      s       spinner starts
 *   ~       the roll or spinner continues through this slot (may cross bars)
 *   .       rest
 *
 * The end of a roll or spinner is the slot after its last `~`.
 */
export const PATTERN: readonly string[] = [
  // intro — a quarter-note pulse
  'd... .... d... ....', // 0
  'd... .... d... k...', // 1
  'd... .... d... ....', // 2
  'd... k... d.k. k...', // 3
  // A — eighth-note don/kat figures
  'd.k. d... d.k. k...', // 4
  'd.k. d... k.k. d...', // 5
  'd.k. d... d.k. k...', // 6
  'd.d. k... d... K...', // 7
  'd.k. d... d.k. k...', // 8
  'd.k. d... k.k. d...', // 9
  'd.d. k.k. d.d. k.k.', // 10
  'd... .... D... ....', // 11
  // B — first drumroll (two beats)
  'd.k. d.k. d... k...', // 12
  'd.k. d.k. k... d...', // 13
  'r~~~ ~~~~ .... d.k.', // 14
  'd.k. k... d... K...', // 15
  // A' — sixteenth bursts
  'd.k. d... ddk. k...', // 16
  'd.k. d... k.k. d...', // 17
  'd.d. k... ddd. k...', // 18
  'd.k. d.k. d... K...', // 19
  'd.k. d... ddk. k...', // 20
  'd.k. d... k.k. d...', // 21
  'd.d. kkd. d.d. kkd.', // 22
  'd... .... D... ....', // 23
  // C — syncopation and quads
  'd.kd .k.d .k.d .k..', // 24
  'd.k. d.k. dkd. k...', // 25
  'd.kd .k.d .k.d .k..', // 26
  'd.k. kkd. d... K...', // 27
  'dddd k... dddd k...', // 28
  'd.k. d.k. kkkk d...', // 29
  'd.d. k.k. dkdk dk..', // 30
  'D... .... K... ....', // 31
  // D — big drumroll (one bar)
  'd.k. d.k. d.k. d.k.', // 32
  'd.d. k.k. d.d. K...', // 33
  'R~~~ ~~~~ ~~~~ ~~~~', // 34
  '.... d.k. d.k. k...', // 35
  // E — climax
  'd.kd .k.d .k.d .k..', // 36
  'dkd. k.k. dkd. K...', // 37
  'd.kd .k.d .k.d .k..', // 38
  'dkdk d... kdkd k...', // 39
  'd.d. k.k. dddd k.k.', // 40
  'd.k. d.k. dkdk D...', // 41
  // outro — spinner, then the last big don
  's~~~ ~~~~ ~~~~ ~~~~', // 42
  '~~~~ ~~.. D... ....', // 43
];

export const BAR_COUNT = PATTERN.length;
export const SONG_END_MS = LEAD_IN_MS + BAR_COUNT * BAR_MS;
export const TOTAL_MS = SONG_END_MS + TAIL_MS;

// ─── pattern → events ───────────────────────────────────────────────────────

export type FixtureEvent =
  | { kind: 'note'; t: number; k: 'd' | 'k'; big: boolean }
  | { kind: 'roll'; t: number; end: number; big: boolean }
  | { kind: 'spinner'; t: number; end: number };

/** Flatten the bar strings into timed events. Throws on a malformed pattern. */
export function patternEvents(pattern: readonly string[] = PATTERN): FixtureEvent[] {
  const slots: string[] = [];
  pattern.forEach((bar, index) => {
    const chars = bar.replace(/\s+/g, '');
    if (chars.length !== SLOTS_PER_BAR) {
      throw new Error(`pattern bar ${index} has ${chars.length} slots, expected ${SLOTS_PER_BAR}`);
    }
    slots.push(...chars);
  });

  const events: FixtureEvent[] = [];
  const timeOf = (slot: number): number => LEAD_IN_MS + slot * SLOT_MS;
  let i = 0;
  while (i < slots.length) {
    const c = slots[i]!;
    const t = timeOf(i);
    if (c === '.') {
      i++;
    } else if (c === 'd' || c === 'k' || c === 'D' || c === 'K') {
      events.push({ kind: 'note', t, k: c.toLowerCase() as 'd' | 'k', big: c === 'D' || c === 'K' });
      i++;
    } else if (c === 'r' || c === 'R' || c === 's') {
      let j = i + 1;
      while (j < slots.length && slots[j] === '~') j++;
      const end = timeOf(j);
      if (c === 's') events.push({ kind: 'spinner', t, end });
      else events.push({ kind: 'roll', t, end, big: c === 'R' });
      i = j;
    } else if (c === '~') {
      throw new Error(`pattern slot ${i} (bar ${Math.floor(i / SLOTS_PER_BAR)}) continues nothing`);
    } else {
      throw new Error(`pattern slot ${i} has unknown symbol ${JSON.stringify(c)}`);
    }
  }
  return events;
}

// ─── tiers ──────────────────────────────────────────────────────────────────

/** 16th-note slot index of a time within its bar (0..15). */
function slotInBar(t: number): number {
  return Math.round((t - LEAD_IN_MS) / SLOT_MS) % SLOTS_PER_BAR;
}

/**
 * Derive a tier from the hard events. Every kept note is one of hard's notes
 * (never moved or retyped), so the WAV rendered from hard still has an audible
 * hit on it. Deterministic.
 *
 *   hard    everything
 *   normal  notes on even slots only (no off-beat 16ths); rolls and spinners kept
 *   easy    notes on quarter slots only (0, 4, 8, 12); kats survive only as big
 *           notes or on the bar's last beat (slot 12) so the tier reads as dons
 *           with a kat accent; each roll becomes one don at its start (the roll's
 *           first soft don is audible there); spinners removed
 */
export function tierEvents(events: readonly FixtureEvent[], tier: Tier): FixtureEvent[] {
  if (tier === 'hard') return [...events];
  const out: FixtureEvent[] = [];
  for (const e of events) {
    if (e.kind === 'note') {
      const slot = slotInBar(e.t);
      if (tier === 'normal') {
        if (slot % 2 === 0) out.push(e);
      } else if (slot % 4 === 0 && (e.k === 'd' || e.big || slot === 12)) {
        out.push(e);
      }
    } else if (e.kind === 'roll') {
      if (tier === 'normal') out.push(e);
      else out.push({ kind: 'note', t: e.t, k: 'd', big: false });
    } else if (tier === 'normal') {
      out.push(e);
    }
  }
  return out;
}

export function eventsByTier(events: readonly FixtureEvent[] = patternEvents()): Record<Tier, FixtureEvent[]> {
  return { easy: tierEvents(events, 'easy'), normal: tierEvents(events, 'normal'), hard: tierEvents(events, 'hard') };
}

// ─── .osu ───────────────────────────────────────────────────────────────────

const SOUND_FINISH = 4;
const SOUND_CLAP = 8;
const TYPE_CIRCLE = 1;
const TYPE_SLIDER = 2;
const TYPE_SPINNER = 8;
const TYPE_NEW_COMBO = 4;

/** Slider pixel length for a roll of `durationMs` at SV 1.0 (inverse of PLAN §4's formula). */
function rollPixelLength(durationMs: number): number {
  const raw = (durationMs * SLIDER_MULTIPLIER * 100) / BEAT_MS;
  const rounded = Math.round(raw);
  if (Math.abs(raw - rounded) > 1e-6) {
    throw new Error(`roll of ${durationMs} ms does not map to an integer pixel length (${raw})`);
  }
  return rounded;
}

/** osu! file format v14 text for the events. LF line endings. */
export function renderOsu(events: readonly FixtureEvent[], version: string = TIER_VERSION.hard): string {
  const objects = events.map((e) => {
    switch (e.kind) {
      case 'note': {
        const sound = (e.k === 'k' ? SOUND_CLAP : 0) | (e.big ? SOUND_FINISH : 0);
        return `256,192,${e.t},${TYPE_CIRCLE},${sound},0:0:0:0:`;
      }
      case 'roll': {
        const length = rollPixelLength(e.end - e.t);
        const sound = e.big ? SOUND_FINISH : 0;
        return `256,192,${e.t},${TYPE_SLIDER},${sound},L|${256 + length}:192,1,${length},0|0,0:0|0:0,0:0:0:0:`;
      }
      case 'spinner':
        return `256,192,${e.t},${TYPE_SPINNER | TYPE_NEW_COMBO},0,${e.end},0:0:0:0:`;
    }
  });

  const lines = [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: song.wav',
    'AudioLeadIn: 0',
    `PreviewTime: ${LEAD_IN_MS + 24 * BAR_MS}`,
    'Countdown: 0',
    'SampleSet: Normal',
    'StackLeniency: 0.7',
    'Mode: 1',
    'LetterboxInBreaks: 0',
    'WidescreenStoryboard: 0',
    '',
    '[Editor]',
    'DistanceSpacing: 1',
    'BeatDivisor: 4',
    'GridSize: 32',
    'TimelineZoom: 1',
    '',
    '[Metadata]',
    `Title:${TITLE}`,
    `TitleUnicode:${TITLE}`,
    `Artist:${ARTIST}`,
    `ArtistUnicode:${ARTIST}`,
    'Creator:tools/gen-fixture.ts',
    `Version:${version}`,
    'Source:',
    'Tags:dyad fixture synthetic',
    'BeatmapID:0',
    'BeatmapSetID:-1',
    '',
    '[Difficulty]',
    `HPDrainRate:${HP}`,
    'CircleSize:5',
    `OverallDifficulty:${OD}`,
    'ApproachRate:5',
    `SliderMultiplier:${SLIDER_MULTIPLIER}`,
    'SliderTickRate:1',
    '',
    '[Events]',
    '//Background and Video events',
    '0,0,"jacket.png",0,0',
    '//Break Periods',
    '//Storyboard Layer 0 (Background)',
    '//Storyboard Layer 1 (Fail)',
    '//Storyboard Layer 2 (Pass)',
    '//Storyboard Layer 3 (Foreground)',
    '//Storyboard Layer 4 (Overlay)',
    '//Storyboard Sound Samples',
    '',
    '[TimingPoints]',
    `${LEAD_IN_MS},${BEAT_MS},${METER},1,0,100,1,0`,
    '',
    '[HitObjects]',
    ...objects,
    '',
  ];
  return lines.join('\n');
}

// ─── audio synthesis ────────────────────────────────────────────────────────

interface Mix {
  left: Float64Array;
  right: Float64Array;
  prng: Prng;
}

const TWO_PI = Math.PI * 2;

/** Equal-power pan: -1 = left, 0 = centre, 1 = right. */
function panGains(pan: number): [number, number] {
  const angle = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

/**
 * Render `durationMs` of a voice starting at `startMs`. `voice(tau, index)`
 * returns the sample at tau seconds after the start; it is called in order so
 * stateful oscillators (phase accumulators) work.
 */
function addVoice(
  mix: Mix,
  startMs: number,
  durationMs: number,
  pan: number,
  voice: (tau: number, index: number) => number,
): void {
  const start = Math.round((startMs / 1000) * SAMPLE_RATE);
  const frames = Math.min(Math.round((durationMs / 1000) * SAMPLE_RATE), mix.left.length - start);
  const [gl, gr] = panGains(pan);
  for (let n = 0; n < frames; n++) {
    const s = voice(n / SAMPLE_RATE, n);
    mix.left[start + n]! += s * gl;
    mix.right[start + n]! += s * gr;
  }
}

/** Linear fade-out over the last `fadeMs` of a voice. */
function tail(tau: number, durationMs: number, fadeMs: number): number {
  const remaining = durationMs / 1000 - tau;
  return remaining < fadeMs / 1000 ? Math.max(0, remaining / (fadeMs / 1000)) : 1;
}

const DRIVE = 1.6;
const DRIVE_NORM = Math.tanh(DRIVE);

/** Don: a sine thump whose pitch falls 120 → 50 Hz over 100 ms, exponential decay. */
function addDon(mix: Mix, startMs: number, big: boolean, gain: number): void {
  const duration = big ? 450 : 250;
  const decay = big ? 0.14 : 0.07;
  const amp = (big ? 0.9 : 0.6) * gain;
  let phase = 0;
  addVoice(mix, startMs, duration, 0, (tau) => {
    const glide = Math.max(0, 1 - tau / 0.1);
    const freq = 50 * Math.pow(120 / 50, glide);
    phase += (TWO_PI * freq) / SAMPLE_RATE;
    const body = (Math.tanh(DRIVE * Math.sin(phase)) / DRIVE_NORM) * Math.exp(-tau / decay);
    const click = mix.prng.noise() * Math.exp(-tau / 0.002) * 0.15;
    return (body + click) * amp * tail(tau, duration, 12);
  });
}

/** Kat: a 1.6 kHz sine plus white noise, 45 ms (90 ms when big). */
function addKat(mix: Mix, startMs: number, big: boolean, gain: number): void {
  const duration = big ? 90 : 45;
  const toneDecay = big ? 0.03 : 0.012;
  const noiseDecay = big ? 0.028 : 0.014;
  const amp = (big ? 0.75 : 0.5) * gain;
  addVoice(mix, startMs, duration, 0, (tau) => {
    const tone = Math.sin(TWO_PI * 1600 * tau) * Math.exp(-tau / toneDecay);
    const noise = mix.prng.noise() * Math.exp(-tau / noiseDecay);
    return (tone * 0.5 + noise * 0.5) * amp * tail(tau, duration, 6);
  });
}

/** Drumroll: rapid soft dons on every 16th until the end. */
function addRoll(mix: Mix, startMs: number, endMs: number, big: boolean): void {
  for (let t = startMs; t < endMs; t += SLOT_MS) {
    addDon(mix, t, false, big ? 0.7 : 0.45);
  }
}

/** Spinner: alternating ticks on 8ths that swell, under a rising sine sweep. */
function addSpinner(mix: Mix, startMs: number, endMs: number): void {
  const duration = endMs - startMs;
  let index = 0;
  for (let t = startMs; t < endMs; t += BEAT_MS / 2, index++) {
    const ramp = 0.35 + 0.45 * ((t - startMs) / duration);
    if (index % 2 === 0) addKat(mix, t, false, ramp);
    else addDon(mix, t, false, ramp * 0.6);
  }
  let phase = 0;
  addVoice(mix, startMs, duration, 0, (tau) => {
    const progress = tau / (duration / 1000);
    const freq = 220 * Math.pow(4, progress);
    phase += (TWO_PI * freq) / SAMPLE_RATE;
    const attack = Math.min(1, tau / 0.05);
    return Math.sin(phase) * 0.1 * attack * tail(tau, duration, 120);
  });
}

/** MIDI note number → Hz (12-TET, A4 = 440). */
function midiHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Four-bar progression, low register: Am – F – C – G. */
const CHORDS: readonly (readonly number[])[] = [
  [45, 48, 52], // A2 C3 E3
  [41, 45, 48], // F2 A2 C3
  [48, 52, 55], // C3 E3 G3
  [43, 47, 50], // G2 B2 D3
];
const CHORD_PANS: readonly number[] = [0, -0.35, 0.35];

/** A quiet detuned sine pad, one chord per bar, dipping on every beat. */
function addPad(mix: Mix, bar: number, startMs: number, durationMs: number): void {
  const chord = CHORDS[bar % CHORDS.length]!;
  const release = 180;
  chord.forEach((note, voiceIndex) => {
    const base = midiHz(note);
    const pan = CHORD_PANS[voiceIndex] ?? 0;
    const freqs = [base * (1 - 0.0012), base * (1 + 0.0012)];
    addVoice(mix, startMs, durationMs, pan, (tau) => {
      let s = 0;
      for (const f of freqs) s += Math.sin(TWO_PI * f * tau) + 0.25 * Math.sin(TWO_PI * 2 * f * tau);
      const attack = Math.min(1, tau / 0.025);
      const pulse = 1 - 0.35 * (0.5 + 0.5 * Math.cos((TWO_PI * tau) / (BEAT_MS / 1000)));
      return s * 0.028 * attack * pulse * tail(tau, durationMs, release);
    });
  });
}

/** Scale so the loudest sample sits at `peak`. */
function normalize(mix: Mix, peak: number): void {
  let max = 0;
  for (const ch of [mix.left, mix.right]) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]!);
      if (a > max) max = a;
    }
  }
  if (max === 0) return;
  const k = peak / max;
  for (const ch of [mix.left, mix.right]) {
    for (let i = 0; i < ch.length; i++) ch[i]! *= k;
  }
}

/** Synthesise the song into planar stereo float channels. */
export function renderAudio(events: readonly FixtureEvent[]): { left: Float64Array; right: Float64Array } {
  const frames = Math.ceil((TOTAL_MS / 1000) * SAMPLE_RATE);
  const mix: Mix = { left: new Float64Array(frames), right: new Float64Array(frames), prng: mulberry32(PRNG_SEED) };

  for (let bar = 0; bar < BAR_COUNT; bar++) {
    const start = LEAD_IN_MS + bar * BAR_MS;
    const duration = bar === BAR_COUNT - 1 ? BAR_MS + TAIL_MS : BAR_MS;
    addPad(mix, bar, start, duration);
  }
  for (const e of events) {
    switch (e.kind) {
      case 'note':
        if (e.k === 'd') addDon(mix, e.t, e.big, 1);
        else addKat(mix, e.t, e.big, 1);
        break;
      case 'roll':
        addRoll(mix, e.t, e.end, e.big);
        break;
      case 'spinner':
        addSpinner(mix, e.t, e.end);
        break;
    }
  }
  normalize(mix, 0.95);
  return { left: mix.left, right: mix.right };
}

// ─── jacket ─────────────────────────────────────────────────────────────────

export const JACKET_SIZE = 1024;

type Point = readonly [x: number, y: number];

/** SVG path for a polygon with every corner rounded to radius `r` (arcs, not béziers). */
function roundedPolygonPath(points: readonly Point[], r: number): string {
  const n = points.length;
  const fmt = (v: number): string => v.toFixed(2).replace(/\.?0+$/, '');
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = points[i]!;
    const [ax, ay] = points[(i + n - 1) % n]!;
    const [bx, by] = points[(i + 1) % n]!;
    const ua = [ax - px, ay - py] as const;
    const ub = [bx - px, by - py] as const;
    const la = Math.hypot(ua[0], ua[1]);
    const lb = Math.hypot(ub[0], ub[1]);
    const u = [ua[0] / la, ua[1] / la] as const;
    const v = [ub[0] / lb, ub[1] / lb] as const;
    const cos = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
    const theta = Math.acos(cos);
    const d = Math.min(r / Math.tan(theta / 2), la / 2, lb / 2);
    const p1 = [px + u[0] * d, py + u[1] * d] as const;
    const p2 = [px + v[0] * d, py + v[1] * d] as const;
    // Travel direction is A → P → B; in SVG's y-down space a positive cross
    // product is a clockwise turn, which is sweep-flag 1.
    const cross = -ua[0] * ub[1] + ua[1] * ub[0];
    const sweep = cross > 0 ? 1 : 0;
    parts.push(`${i === 0 ? 'M' : 'L'}${fmt(p1[0])} ${fmt(p1[1])}`);
    parts.push(`A${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(p2[0])} ${fmt(p2[1])}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

/** A kat: a bar of `thickness` bent upward by `rise` at its centre (DESIGN §2). */
function chevronPath(cx: number, cy: number, width: number, thickness: number, rise: number): string {
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const yTop = cy - thickness / 2 + rise / 2;
  const points: Point[] = [
    [x0, yTop],
    [cx, yTop - rise],
    [x1, yTop],
    [x1, yTop + thickness],
    [cx, yTop + thickness - rise],
    [x0, yTop + thickness],
  ];
  return roundedPolygonPath(points, thickness * SHAPE.radius);
}

/** A don: a straight brick. */
function brick(cx: number, cy: number, width: number, thickness: number, fill: string): string {
  const r = thickness * SHAPE.radius;
  return `<rect x="${cx - width / 2}" y="${cy - thickness / 2}" width="${width}" height="${thickness}" rx="${r}" fill="${fill}"/>`;
}

/**
 * The jacket: a snapshot of the track. Notes fall from the top toward a gate
 * at the bottom; a kat chevron and a big don brick are the two "pulses",
 * ghosted copies above them hint at the scroll. Only token colours are used.
 */
export function jacketSvg(theme: Theme = DARK): string {
  const S = JACKET_SIZE;
  const W = 640;
  const x0 = (S - W) / 2;
  const cx = S / 2;
  const T = 96;
  const gap = T * SHAPE.gateGap;
  const cellW = (W - gap) / 2;
  const katW = W * SHAPE.noteWidth;
  const rise = T * SHAPE.katPeak;
  const gateTop = 768;
  const cellR = T * SHAPE.radius;

  const beatLines: string[] = [];
  for (let y = 128; y < S; y += 128) {
    const isBar = y % 512 === 0;
    beatLines.push(
      `<line x1="${x0}" y1="${y}" x2="${x0 + W}" y2="${y}" stroke="${isBar ? theme.textFaint : theme.line}" stroke-width="2"/>`,
    );
  }

  const cell = (col: number, row: number): string =>
    `<rect x="${x0 + col * (cellW + gap)}" y="${gateTop + row * (T + gap)}" width="${cellW}" height="${T}" rx="${cellR}" fill="${theme.raised}" stroke="${theme.line}" stroke-width="2"/>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`,
    `<rect width="${S}" height="${S}" fill="${theme.ground}"/>`,
    `<rect x="${x0}" y="0" width="${W}" height="${S}" fill="${theme.surface}"/>`,
    ...beatLines,
    `<line x1="${cx}" y1="0" x2="${cx}" y2="${S}" stroke="${theme.line}" stroke-width="2" stroke-dasharray="10 14"/>`,
    // ghosts further up the track
    `<path d="${chevronPath(cx, 128, katW, T, rise)}" fill="${theme.raised}"/>`,
    brick(cx, 288, katW, T, theme.raised),
    // the two pulses
    `<path d="${chevronPath(cx, 448, katW, T, rise)}" fill="${theme.kat}"/>`,
    brick(cx, 640, W, T, theme.don),
    `<rect x="${cx - 1}" y="${640 - T / 2}" width="2" height="${T}" fill="${theme.ground}"/>`,
    // the gate
    cell(0, 0),
    cell(1, 0),
    cell(0, 1),
    cell(1, 1),
    '</svg>',
    '',
  ].join('\n');
}

/** Rasterise the jacket SVG to a 1024×1024 PNG with sharp. Byte-stable for a given sharp build. */
export async function renderJacketPng(svg: string = jacketSvg()): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp(Buffer.from(svg, 'utf8'), { density: 72 })
      .resize(JACKET_SIZE, JACKET_SIZE)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
}

// ─── fixture bundle ─────────────────────────────────────────────────────────

export interface Fixture {
  /** The hard tier's events (the pattern itself; the audio is rendered from these). */
  events: FixtureEvent[];
  eventsByTier: Record<Tier, FixtureEvent[]>;
  /** One .osu text per tier. */
  osu: Record<Tier, string>;
  wav: Uint8Array;
  songJson: string;
  jacketSvg: string;
}

export function songJson(): string {
  return `${JSON.stringify({ title: TITLE, artist: ARTIST, audioOffset: 0 }, null, 2)}\n`;
}

/** Everything except the PNG, in memory. Synchronous and deterministic. */
export function generateFixture(): Fixture {
  const events = patternEvents();
  const byTier = eventsByTier(events);
  const { left, right } = renderAudio(events);
  const osu = {} as Record<Tier, string>;
  for (const tier of TIERS) osu[tier] = renderOsu(byTier[tier], TIER_VERSION[tier]);
  return {
    events,
    eventsByTier: byTier,
    osu,
    wav: encodeWav16([left, right], SAMPLE_RATE),
    songJson: songJson(),
    jacketSvg: jacketSvg(),
  };
}

/** Write the fixture into `dir` (created if missing). Returns the paths written. */
export async function writeFixture(dir: string): Promise<string[]> {
  const fixture = generateFixture();
  const files: [string, Uint8Array | string][] = [
    ...TIERS.map((tier): [string, string] => [`${tier}.osu`, fixture.osu[tier]]),
    ['song.wav', fixture.wav],
    ['song.json', fixture.songJson],
    ['jacket.png', await renderJacketPng(fixture.jacketSvg)],
  ];
  const written: string[] = [];
  for (const [name, bytes] of files) {
    const path = join(dir, name);
    const changed = await writeIfChanged(path, bytes);
    written.push(path);
    console.log(`${changed ? 'wrote    ' : 'unchanged'} ${path}`);
  }
  // The single-chart layout is gone; a stale song.osu would be mis-tiered by the build.
  const legacy = join(dir, 'song.osu');
  if (existsSync(legacy)) {
    await unlink(legacy);
    console.log(`removed   ${legacy}`);
  }
  for (const tier of TIERS) {
    const events = fixture.eventsByTier[tier];
    const notes = events.filter((e) => e.kind === 'note');
    const big = notes.filter((e) => e.kind === 'note' && e.big).length;
    const rolls = events.filter((e) => e.kind === 'roll').length;
    const spinners = events.filter((e) => e.kind === 'spinner').length;
    console.log(`${FIXTURE_ID}/${tier}: ${notes.length} notes (${big} big), ${rolls} rolls, ${spinners} spinners`);
  }
  console.log(`${FIXTURE_ID}: ${BAR_COUNT} bars, ${(TOTAL_MS / 1000).toFixed(1)} s`);
  return written;
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.argv[2] ?? join(root, 'songs-src', FIXTURE_ID);
  await writeFixture(outDir);
}
