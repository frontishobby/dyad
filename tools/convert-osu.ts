/**
 * osu!taiko `.osu` → Chart converter (PLAN §4).
 *
 * Pure: the same text always yields the same Chart, and serializeChart() of
 * that Chart always yields the same bytes. The only async step is the sha256
 * of the canonical body (src/core/hash.ts), shared with the browser.
 *
 * Rules (PLAN §4, matched against osu!lazer's legacy decoder + taiko converter):
 *   - hitSound whistle(2) or clap(8) → 'k' (kat), otherwise 'd' (don); finish(4) → big
 *   - type bit 2 (slider) → roll, duration =
 *       pixelLength × spans / (SliderMultiplier × 100 × SV) × beatLength
 *     where beatLength comes from the active uninherited timing point and SV
 *     from the active inherited point (an uninherited point resets SV to 1.0,
 *     as in osu!; an inherited point at the same time wins over that reset)
 *   - type bit 8 (spinner) → end = objectParams endTime,
 *       hits = max(1, floor((end - t) / 1000 × DifficultyRange(OD, 3, 5, 7.5)))
 *   - uninherited timing points (beatLength > 0) → chart.timing; inherited
 *     (beatLength < 0) only feed SV
 *   - every t/end is rounded to an integer ms; lists are stable-sorted by t
 *
 * CLI: node tools/convert-osu.ts <in.osu> <out.json>
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chartHash } from '../src/core/hash.ts';
import type { Chart, ChartNote, ChartRoll, ChartSpinner, ChartTiming, NoteKind } from '../src/core/types.ts';

// ─── .osu parsing ───────────────────────────────────────────────────────────

/** Section name (lower-case, without brackets) → raw non-empty, non-comment lines. */
export type OsuSections = ReadonlyMap<string, readonly string[]>;

/**
 * Split an .osu file into sections. Tolerates CRLF/CR/LF, a UTF-8 BOM,
 * `//` comment lines, blank lines and text before the first section header
 * (the `osu file format vN` line). Section names are compared case-insensitively.
 */
export function parseOsuSections(text: string): OsuSections {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const rawLine of source.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      const name = header[1]!.trim().toLowerCase();
      current = sections.get(name) ?? [];
      sections.set(name, current);
      continue;
    }
    current?.push(line);
  }
  return sections;
}

/** `Key: Value` lines of a section as a map. Later duplicates win. Keys are compared case-insensitively. */
export function parseKeyValues(lines: readonly string[] | undefined): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const line of lines ?? []) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    map.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return map;
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ─── timing ─────────────────────────────────────────────────────────────────

interface RawTimingPoint {
  /** Integer ms. */
  t: number;
  /** > 0 uninherited (ms per beat), < 0 inherited (−100 / SV). */
  beatLength: number;
  meter: number;
}

/**
 * `time,beatLength,meter,sampleSet,sampleIndex,volume,uninherited,effects`.
 * Kind is decided by the sign of beatLength (PLAN §4), not the flag column,
 * so v3–v5 files without the column parse the same way.
 */
function parseTimingPoints(lines: readonly string[] | undefined): RawTimingPoint[] {
  const points: RawTimingPoint[] = [];
  for (const line of lines ?? []) {
    const cols = line.split(',');
    if (cols.length < 2) continue;
    const t = Number(cols[0]);
    const beatLength = Number(cols[1]);
    if (!Number.isFinite(t) || !Number.isFinite(beatLength) || beatLength === 0) continue;
    const meterRaw = cols.length >= 3 ? Math.trunc(Number(cols[2])) : 4;
    const meter = Number.isFinite(meterRaw) && meterRaw >= 1 ? meterRaw : 4;
    points.push({ t: Math.round(t), beatLength, meter });
  }
  // Stable: file order is kept among equal times, which decides "last wins" below.
  points.sort((a, b) => a.t - b.t);
  return points;
}

/** Uninherited points, one per time (the last one in file order wins, as in osu!). */
function uninheritedTiming(points: readonly RawTimingPoint[]): ChartTiming[] {
  const byTime = new Map<number, ChartTiming>();
  for (const p of points) {
    if (p.beatLength > 0) byTime.set(p.t, { t: p.t, beatLength: p.beatLength, meter: p.meter });
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

interface SvPoint {
  t: number;
  sv: number;
}

/** osu!taiko clamps inherited beat length magnitude to [10, 10000] → SV ∈ [0.01, 10]. */
function svFromInherited(beatLength: number): number {
  const magnitude = Math.min(10000, Math.max(10, -beatLength));
  return 100 / magnitude;
}

/**
 * Slider velocity timeline. Every timing point contributes: an uninherited
 * point resets SV to 1.0, an inherited one sets −100 / beatLength. Among
 * points sharing a time an inherited one wins (osu!lazer's legacy decoder
 * appends non-timing control points after the implicit reset).
 */
function svTimeline(points: readonly RawTimingPoint[]): SvPoint[] {
  const byTime = new Map<number, SvPoint>();
  for (const p of points) {
    const existing = byTime.get(p.t);
    if (p.beatLength < 0) {
      byTime.set(p.t, { t: p.t, sv: svFromInherited(p.beatLength) });
    } else if (!existing) {
      byTime.set(p.t, { t: p.t, sv: 1 });
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Last entry with t ≤ time, or null when `time` precedes every entry. */
function activeAt<T extends { t: number }>(sorted: readonly T[], time: number): T | null {
  let lo = 0;
  let hi = sorted.length - 1;
  let found: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = sorted[mid]!;
    if (entry.t <= time) {
      found = entry;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** osu!lazer TimingControlPoint.DEFAULT: used only when a file has no uninherited point at all. */
const DEFAULT_BEAT_LENGTH = 1000;

// ─── hit objects ────────────────────────────────────────────────────────────

const TYPE_CIRCLE = 1;
const TYPE_SLIDER = 2;
const TYPE_SPINNER = 8;
const TYPE_HOLD = 128;

const SOUND_WHISTLE = 2;
const SOUND_FINISH = 4;
const SOUND_CLAP = 8;

/** osu!lazer IBeatmapDifficultyInfo.DifficultyRange(difficulty, min, mid, max). */
export function difficultyRange(difficulty: number, min: number, mid: number, max: number): number {
  if (difficulty > 5) return mid + ((max - mid) * (difficulty - 5)) / 5;
  if (difficulty < 5) return mid - ((mid - min) * (5 - difficulty)) / 5;
  return mid;
}

/** Required alternating hits for a spinner (swell) of `durationMs` at overall difficulty `od`. */
export function spinnerHits(durationMs: number, od: number): number {
  const ratio = difficultyRange(od, 3, 5, 7.5);
  return Math.max(1, Math.floor((durationMs / 1000) * ratio));
}

interface ConvertedObjects {
  notes: ChartNote[];
  rolls: ChartRoll[];
  spinners: ChartSpinner[];
}

function convertHitObjects(
  lines: readonly string[] | undefined,
  timing: readonly ChartTiming[],
  sv: readonly SvPoint[],
  sliderMultiplier: number,
  od: number,
): ConvertedObjects {
  const notes: ChartNote[] = [];
  const rolls: ChartRoll[] = [];
  const spinners: ChartSpinner[] = [];

  for (const line of lines ?? []) {
    const cols = line.split(',');
    if (cols.length < 4) continue;
    const time = Number(cols[2]);
    const type = Math.trunc(Number(cols[3]));
    if (!Number.isFinite(time) || !Number.isFinite(type)) continue;
    const t = Math.round(time);
    const hitSound = Math.trunc(numberOr(cols[4], 0));
    const big = (hitSound & SOUND_FINISH) !== 0;
    const kind: NoteKind = (hitSound & (SOUND_WHISTLE | SOUND_CLAP)) !== 0 ? 'k' : 'd';

    // Same precedence as osu!lazer's legacy decoder: circle, slider, spinner, hold.
    if (type & TYPE_CIRCLE) {
      notes.push({ t, k: kind, big });
    } else if (type & TYPE_SLIDER) {
      // objectParams: curveType|curvePoints, slides, length, edgeSounds, edgeSets
      const spans = Math.max(1, Math.trunc(numberOr(cols[6], 1)));
      const pixelLength = Math.max(0, numberOr(cols[7], 0));
      const beatLength = (activeAt(timing, t) ?? timing[0])?.beatLength ?? DEFAULT_BEAT_LENGTH;
      const velocity = activeAt(sv, t)?.sv ?? 1;
      const duration = ((pixelLength * spans) / (sliderMultiplier * 100 * velocity)) * beatLength;
      rolls.push({ t, end: t + Math.round(duration), big });
    } else if (type & TYPE_SPINNER) {
      const end = Math.max(t, Math.round(numberOr(cols[5], t)));
      spinners.push({ t, end, hits: spinnerHits(end - t, od) });
    } else if (type & TYPE_HOLD) {
      // osu!mania hold: `endTime:hitSample`. Never in a taiko file, but lazer
      // converts anything with a duration into a swell, so do the same.
      const endRaw = (cols[5] ?? '').split(':')[0];
      const end = Math.max(t, Math.round(numberOr(endRaw, t)));
      spinners.push({ t, end, hits: spinnerHits(end - t, od) });
    }
  }

  notes.sort((a, b) => a.t - b.t);
  rolls.sort((a, b) => a.t - b.t);
  spinners.sort((a, b) => a.t - b.t);
  return { notes, rolls, spinners };
}

// ─── conversion ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A timing segment shorter than this is a generator blip (a stretched beat
 * fitted as its own BPM), not a tempo the player would notice: it is left
 * out of the displayed range. The last segment runs to the end and always counts.
 */
export const MIN_BPM_SEGMENT_MS = 2000;

function bpmRange(timing: readonly ChartTiming[]): [number, number] {
  if (timing.length === 0) return [0, 0];
  const lasting = timing.filter((p, i) => {
    const next = timing[i + 1];
    return next === undefined || next.t - p.t >= MIN_BPM_SEGMENT_MS;
  });
  let min = Infinity;
  let max = -Infinity;
  for (const p of lasting.length > 0 ? lasting : timing) {
    const bpm = 60000 / p.beatLength;
    if (bpm < min) min = bpm;
    if (bpm > max) max = bpm;
  }
  return [round2(min), round2(max)];
}

/** Ruleset id from [General] Mode (1 = taiko), or null when absent. */
export function osuMode(text: string): number | null {
  const general = parseKeyValues(parseOsuSections(text).get('general'));
  const mode = general.get('mode');
  return mode === undefined ? null : Math.trunc(numberOr(mode, NaN));
}

/** Convert an osu!taiko `.osu` file's text into a Chart. Deterministic. */
export async function convertOsu(text: string): Promise<Chart> {
  const sections = parseOsuSections(text);
  const metadata = parseKeyValues(sections.get('metadata'));
  const difficulty = parseKeyValues(sections.get('difficulty'));

  const od = numberOr(difficulty.get('overalldifficulty'), 5);
  const hp = numberOr(difficulty.get('hpdrainrate'), 5);
  const sliderMultiplier = numberOr(difficulty.get('slidermultiplier'), 1.4);

  const rawTiming = parseTimingPoints(sections.get('timingpoints'));
  const timing = uninheritedTiming(rawTiming);
  const sv = svTimeline(rawTiming);
  const { notes, rolls, spinners } = convertHitObjects(
    sections.get('hitobjects'),
    timing,
    sv,
    sliderMultiplier,
    od,
  );

  const hash = await chartHash({ timing, notes, rolls, spinners });
  return {
    version: 1,
    meta: {
      title: metadata.get('title') ?? '',
      artist: metadata.get('artist') ?? '',
      difficulty: metadata.get('version') ?? '',
      bpm: bpmRange(timing),
      od,
      hp,
    },
    timing,
    notes,
    rolls,
    spinners,
    hash,
  };
}

/**
 * Canonical JSON for chart.json: keys in the exact order of the Chart
 * interface, 2-space indent, trailing newline. Extra properties are dropped.
 */
export function serializeChart(chart: Chart): string {
  const ordered = {
    version: chart.version,
    meta: {
      title: chart.meta.title,
      artist: chart.meta.artist,
      difficulty: chart.meta.difficulty,
      bpm: [chart.meta.bpm[0], chart.meta.bpm[1]],
      od: chart.meta.od,
      hp: chart.meta.hp,
    },
    timing: chart.timing.map((p) => ({ t: p.t, beatLength: p.beatLength, meter: p.meter })),
    notes: chart.notes.map((n) => ({ t: n.t, k: n.k, big: n.big })),
    rolls: chart.rolls.map((r) => ({ t: r.t, end: r.end, big: r.big })),
    spinners: chart.spinners.map((s) => ({ t: s.t, end: s.end, hits: s.hits })),
    hash: chart.hash,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main(argv: readonly string[]): Promise<number> {
  const [input, output] = argv;
  if (!input || !output) {
    console.error('usage: node tools/convert-osu.ts <in.osu> <out.json>');
    return 2;
  }
  const text = await readFile(input, 'utf8');
  const mode = osuMode(text);
  if (mode !== null && mode !== 1) {
    console.warn(`warning: ${input} has Mode ${mode}; DYAD expects osu!taiko (Mode 1)`);
  }
  const chart = await convertOsu(text);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serializeChart(chart));
  console.log(
    `${output}: ${chart.notes.length} notes, ${chart.rolls.length} rolls, ${chart.spinners.length} spinners, ` +
      `${chart.timing.length} timing points, bpm ${chart.meta.bpm[0]}–${chart.meta.bpm[1]}, hash ${chart.hash.slice(0, 12)}…`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
