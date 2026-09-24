/**
 * Song build (PLAN §4, §5, §6). For every songs-src/<id>/ directory:
 *
 *   <tier>.osu  → public/songs/<id>/chart.<tier>.json       (convert-osu.ts; tier = easy | normal | hard)
 *   song.osu    → legacy single chart, tiered by its Version (kantan/easy → easy, futsuu/normal → normal, else hard)
 *   song.wav    → public/songs/<id>/audio.<hash8>.webm      (ffmpeg, libopus 128k VBR)
 *   jacket.{png,jpg,jpeg,webp,avif}
 *               → public/songs/<id>/jacket.<hash8>.avif     (sharp, 1024, q65 effort 6)
 *               → public/songs/<id>/jacket-sm.<hash8>.avif  (256)
 *   song.json   → title / artist / audioOffset in meta.json (optional; chart meta is the fallback)
 *
 * plus meta.json per song, public/songs/index.json, and public/probe.webm
 * (1 s of quiet 440 Hz, decoded at startup to test WebM/Opus support).
 *
 * hash8 is the first 8 hex chars of sha256 over the OUTPUT bytes. Encoded
 * audio and AVIF are cached in .tools-cache/ keyed by sha256 of the source
 * bytes + encoder settings + encoder version, because AVIF effort 6 is slow.
 * The build is idempotent: files are rewritten only when their bytes change,
 * and stale hashed files are removed from each song folder.
 *
 * CLI: node tools/build-songs.ts   (npm run songs:build)
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as rosu from 'rosu-pp-js';
import sharp from 'sharp';
import { tierFromName } from '../src/app/format.ts';
import { TIERS, type SongChartRef, type SongIndex, type SongMeta, type Tier } from '../src/app/types.ts';
import type { Chart } from '../src/core/types.ts';
import { rgbToHex } from '../src/design/tokens.ts';
import { convertOsu, osuMode, serializeChart } from './convert-osu.ts';
import { hash8, readFileOrNull, sha256Hex, writeIfChanged } from './lib/fsx.ts';
import { readWavInfo } from './lib/wav.ts';

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'songs-src');
const OUT_DIR = join(ROOT, 'public', 'songs');
const CACHE_DIR = join(ROOT, '.tools-cache');
const PROBE_PATH = join(ROOT, 'public', 'probe.webm');

/** PLAN §5: `ffmpeg -i song.wav -c:a libopus -b:a 128k -vbr on -application audio`. */
const OPUS_ARGS = ['-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-application', 'audio'] as const;
/**
 * Muxer-only flag. Without it ffmpeg's WebM muxer writes a random TrackUID
 * (and its version strings), so the same WAV would produce different bytes on
 * every encode and the content hash could never be stable. The Opus stream
 * itself is identical with or without it (verified by decoding both to PCM).
 */
const BITEXACT_ARGS = ['-fflags', '+bitexact'] as const;
const PROBE_ARGS = [
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-af', 'volume=-30dB',
  '-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-application', 'audio',
  ...BITEXACT_ARGS,
] as const;
const QUIET_ARGS = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'] as const;

const AVIF_OPTIONS = { quality: 65, effort: 6 } as const;
const JACKET_SIZES = { jacket: 1024, jacketSm: 256 } as const;

/**
 * Palette extraction (PLAN §4): a small thumbnail, 4-bit-per-channel bins,
 * near-black bins ignored, and the picked colours kept apart from each other.
 * 64×64 (not 16×16) so that a bar 96 px tall on a 1024 jacket still yields
 * whole cells of its pure colour instead of only edge blends.
 */
const PALETTE_THUMB = 64;
const PALETTE_SIZE = 3;
/** Rec.709 luma on 0..255; DARK.raised (#24263A) is ≈ 39, so the ground, surface and gate never win. */
const PALETTE_MIN_LUMINANCE = 48;
/** Minimum RGB distance between two picked colours (so a bar and its edge blend do not both get in). */
const PALETTE_MIN_DISTANCE = 64;

const HASHED_FILE = /^(audio\.[0-9a-f]{8}\.webm|jacket(?:-sm)?\.[0-9a-f]{8}\.avif)$/;
const CHART_FILE = /^chart(?:\.[a-z]+)?\.json$/;

// ─── helpers ────────────────────────────────────────────────────────────────

function log(status: string, path: string): void {
  console.log(`${status.padEnd(9)} ${path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path}`);
}

let ffmpegVersionCache: string | null = null;

async function ffmpegVersion(): Promise<string> {
  if (ffmpegVersionCache !== null) return ffmpegVersionCache;
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version']);
    ffmpegVersionCache = stdout.split('\n')[0]?.trim() ?? 'ffmpeg';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('ffmpeg is not on PATH (needed for libopus encoding)');
    }
    throw err;
  }
  return ffmpegVersionCache;
}

async function runFfmpeg(args: readonly string[]): Promise<void> {
  try {
    await execFileAsync('ffmpeg', [...QUIET_ARGS, ...args], { maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') throw new Error('ffmpeg is not on PATH (needed for libopus encoding)');
    throw new Error(`ffmpeg failed: ${e.stderr?.trim() || e.message}`);
  }
}

/**
 * Return the cached bytes for `key`, or run `produce` (which must write the
 * file at the temp path it is given) and store the result under
 * .tools-cache/<kind>/<key><ext>. Returns [bytes, wasCached].
 */
async function cachedFile(
  kind: string,
  key: string,
  ext: string,
  produce: (tmpPath: string) => Promise<void>,
): Promise<[Uint8Array, boolean]> {
  const dir = join(CACHE_DIR, kind);
  const final = join(dir, `${key}${ext}`);
  const hit = await readFileOrNull(final);
  if (hit) return [hit, true];
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${key}.partial${ext}`);
  await rm(tmp, { force: true });
  await produce(tmp);
  await rename(tmp, final);
  return [await readFile(final), false];
}

// ─── encoders ───────────────────────────────────────────────────────────────

async function encodeAudio(wavPath: string, wavBytes: Uint8Array): Promise<[Uint8Array, boolean]> {
  const settings = `ffmpeg ${OPUS_ARGS.join(' ')} ${BITEXACT_ARGS.join(' ')}\n${await ffmpegVersion()}`;
  const key = sha256Hex(wavBytes, '\n', settings);
  return cachedFile('audio', key, '.webm', (tmp) =>
    runFfmpeg(['-i', wavPath, ...OPUS_ARGS, ...BITEXACT_ARGS, tmp]),
  );
}

async function encodeAvif(pngBytes: Uint8Array, size: number): Promise<[Uint8Array, boolean]> {
  const settings = `sharp avif size=${size} ${JSON.stringify(AVIF_OPTIONS)} ${JSON.stringify(sharp.versions)}`;
  const key = sha256Hex(pngBytes, '\n', settings);
  return cachedFile('avif', key, '.avif', async (tmp) => {
    await sharp(Buffer.from(pngBytes))
      .resize(size, size, { fit: 'cover' })
      .avif(AVIF_OPTIONS)
      .toFile(tmp);
  });
}

async function encodeProbe(): Promise<[Uint8Array, boolean]> {
  const key = sha256Hex(`ffmpeg ${PROBE_ARGS.join(' ')}\n${await ffmpegVersion()}`);
  return cachedFile('probe', key, '.webm', (tmp) => runFfmpeg([...PROBE_ARGS, tmp]));
}

// ─── palette ────────────────────────────────────────────────────────────────

interface Bin {
  key: number;
  count: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Dominant colours of a jacket, deterministic: shrink to a thumbnail (never
 * enlarged), bin each pixel at 4 bits per channel, rank bins by count (ties by
 * bin key), drop near-black bins so the ground colour cannot win, then walk
 * the ranking taking each bin's mean colour when it is far enough from the
 * colours already taken. Dark bins fill in only when bright ones run out, and
 * the distance rule is relaxed only when the image has too few colours.
 */
export async function extractPalette(pngBytes: Uint8Array): Promise<string[]> {
  const { data, info } = await sharp(Buffer.from(pngBytes))
    .resize(PALETTE_THUMB, PALETTE_THUMB, { fit: 'cover', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const bins = new Map<number, Bin>();
  for (let i = 0; i + channels <= data.length; i += channels) {
    const r = data[i]!;
    const g = channels >= 3 ? data[i + 1]! : r;
    const b = channels >= 3 ? data[i + 2]! : r;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) {
      bin.count++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    } else {
      bins.set(key, { key, count: 1, r, g, b });
    }
  }

  type Rgb = [number, number, number];
  const ranked = [...bins.values()].sort((a, b) => b.count - a.count || a.key - b.key);
  const mean = (bin: Bin): Rgb => [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count];
  const luminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const colours = ranked.map(mean);
  const bright = colours.filter((c) => luminance(c) >= PALETTE_MIN_LUMINANCE);
  const dark = colours.filter((c) => luminance(c) < PALETTE_MIN_LUMINANCE);

  const picked: Rgb[] = [];
  const take = (candidates: readonly Rgb[], minDistance: number): void => {
    for (const c of candidates) {
      if (picked.length >= PALETTE_SIZE) return;
      if (picked.every((p) => distance(p, c) >= minDistance)) picked.push(c);
    }
  };
  take(bright, PALETTE_MIN_DISTANCE);
  take(dark, PALETTE_MIN_DISTANCE);
  take(bright, 1);
  take(dark, 1);
  return picked.map(rgbToHex);
}

// ─── per-song build ─────────────────────────────────────────────────────────

interface SongSource {
  title?: string;
  artist?: string;
  audioOffset?: number;
}

async function readSongSource(path: string): Promise<SongSource> {
  const raw = await readFileOrNull(path);
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${path}: expected an object`);
  const obj = parsed as Record<string, unknown>;
  const source: SongSource = {};
  if (typeof obj.title === 'string') source.title = obj.title;
  if (typeof obj.artist === 'string') source.artist = obj.artist;
  if (typeof obj.audioOffset === 'number' && Number.isFinite(obj.audioOffset)) source.audioOffset = obj.audioOffset;
  return source;
}

async function requireFile(path: string): Promise<Uint8Array> {
  const bytes = await readFileOrNull(path);
  if (!bytes) throw new Error(`missing ${path}`);
  return bytes;
}

/**
 * Drop hit objects that repeat an earlier object's timestamp (a generator
 * artefact: osu!taiko has no chords). The converter merges them the same way;
 * the rating must see the same chart, or stacked notes read as infinite speed.
 */
export function dedupeHitObjects(osuText: string): string {
  const marker = /^\[HitObjects\]\s*$/m;
  const at = osuText.search(marker);
  if (at < 0) return osuText;
  const head = osuText.slice(0, at);
  const body = osuText.slice(at);
  const seen = new Set<string>();
  const lines = body.split('\n').filter((line, i) => {
    if (i === 0) return true;
    const parts = line.split(',');
    if (parts.length < 5) return true;
    const t = parts[2]?.trim() ?? '';
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  return head + lines.join('\n');
}

/**
 * osu!taiko star rating of a .osu, from rosu-pp (the official difficulty
 * calculator ported to Rust, here through Wasm). No mods, clock rate 1.
 * Rounded to 2 decimals so meta.json is stable across float noise.
 */
export function starsFor(osuText: string): number {
  const map = new rosu.Beatmap(dedupeHitObjects(osuText));
  try {
    if (map.mode !== rosu.GameMode.Taiko) map.convert(rosu.GameMode.Taiko);
    const attrs = new rosu.Difficulty({}).calculate(map);
    return Math.round(attrs.stars * 100) / 100;
  } finally {
    map.free();
  }
}

/**
 * Level 1–10 from the star rating (src/app/types.ts documents the mapping):
 * clamp(1, 10, round(stars × 1.6)) — Kantan ~2★ → 3, Oni ~4.5★ → 7, 6★+ → 10.
 */
export function levelFor(stars: number): number {
  if (!Number.isFinite(stars)) return 1;
  return Math.max(1, Math.min(10, Math.round(stars * 1.6)));
}

function chartRef(tier: Tier, file: string, chart: Chart, stars: number): SongChartRef {
  return {
    tier,
    name: chart.meta.difficulty,
    file,
    hash: chart.hash,
    od: chart.meta.od,
    bpm: [chart.meta.bpm[0], chart.meta.bpm[1]],
    notes: chart.notes.length,
    stars,
    level: levelFor(stars),
  };
}

interface ChartSource {
  tier: Tier;
  /** Source file name inside the song folder. */
  osu: string;
  /** Output file name inside the song folder. */
  file: string;
}

/**
 * Charts of a song folder: <tier>.osu for each tier that exists, or the legacy
 * song.osu (tiered by its Version). Other .osu files are reported and skipped.
 */
/** Accepted jacket source names, in preference order. */
export const JACKET_NAMES = ['jacket.png', 'jacket.jpg', 'jacket.jpeg', 'jacket.webp', 'jacket.avif'] as const;

/** The jacket file name in `srcDir` (first of JACKET_NAMES that exists), or an error naming what is accepted. */
export async function findJacket(srcDir: string): Promise<string> {
  const names = new Set((await readdir(srcDir)).map((n) => n.toLowerCase()));
  for (const name of JACKET_NAMES) if (names.has(name)) return name;
  throw new Error(`${srcDir}: no jacket (expected one of ${JACKET_NAMES.join(', ')})`);
}

export async function discoverCharts(srcDir: string): Promise<ChartSource[]> {
  const names = (await readdir(srcDir)).filter((n) => n.toLowerCase().endsWith('.osu')).sort();
  const found: ChartSource[] = [];
  const tiered = new Set<Tier>();
  for (const name of names) {
    const base = name.slice(0, -4).toLowerCase();
    if ((TIERS as readonly string[]).includes(base)) {
      const tier = base as Tier;
      found.push({ tier, osu: name, file: `chart.${tier}.json` });
      tiered.add(tier);
    }
  }
  if (found.length === 0 && names.includes('song.osu')) {
    const text = (await readFile(join(srcDir, 'song.osu'))).toString('utf8');
    const version = /^Version:\s*(.*)$/m.exec(text)?.[1]?.trim() ?? '';
    const tier = tierFromName(version);
    console.warn(`warning: ${srcDir}/song.osu is the legacy single-chart layout; treating it as ${tier} (rename it to ${tier}.osu)`);
    found.push({ tier, osu: 'song.osu', file: `chart.${tier}.json` });
  }
  for (const name of names) {
    if (!found.some((f) => f.osu === name)) console.warn(`warning: ${srcDir}/${name} is not easy/normal/hard.osu; skipped`);
  }
  return found.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
}

async function buildSong(id: string): Promise<SongMeta> {
  const srcDir = join(SRC_DIR, id);
  const outDir = join(OUT_DIR, id);
  await mkdir(outDir, { recursive: true });

  // charts, one per tier
  const sources = await discoverCharts(srcDir);
  if (sources.length === 0) throw new Error(`${srcDir}: no easy.osu / normal.osu / hard.osu`);
  const charts: SongChartRef[] = [];
  let firstChart: Chart | null = null;
  const chartFiles = new Set<string>();
  for (const src of sources) {
    const osuText = (await requireFile(join(srcDir, src.osu))).toString();
    const mode = osuMode(osuText);
    if (mode !== null && mode !== 1) console.warn(`warning: ${id}/${src.osu} has Mode ${mode}; expected osu!taiko (1)`);
    const chart = await convertOsu(osuText);
    const chartPath = join(outDir, src.file);
    log((await writeIfChanged(chartPath, serializeChart(chart))) ? 'wrote' : 'unchanged', chartPath);
    charts.push(chartRef(src.tier, src.file, chart, starsFor(osuText)));
    chartFiles.add(src.file);
    firstChart ??= chart;
  }
  const chart = firstChart as Chart;
  for (const name of (await readdir(outDir)).sort()) {
    if (CHART_FILE.test(name) && !chartFiles.has(name)) {
      await unlink(join(outDir, name));
      log('removed', join(outDir, name));
    }
  }

  // audio
  const wavPath = join(srcDir, 'song.wav');
  const wavBytes = await requireFile(wavPath);
  const wavInfo = readWavInfo(wavBytes);
  const durationMs = Math.round((wavInfo.frames / wavInfo.sampleRate) * 1000);
  const [audioBytes, audioCached] = await encodeAudio(wavPath, wavBytes);
  const audioName = `audio.${hash8(audioBytes)}.webm`;
  const audioPath = join(outDir, audioName);
  log((await writeIfChanged(audioPath, audioBytes)) ? (audioCached ? 'cached' : 'encoded') : 'unchanged', audioPath);

  // jackets (any format sharp decodes; the first name found wins)
  const pngBytes = await requireFile(join(srcDir, await findJacket(srcDir)));
  const names: Record<keyof typeof JACKET_SIZES, string> = { jacket: '', jacketSm: '' };
  for (const kind of Object.keys(JACKET_SIZES) as (keyof typeof JACKET_SIZES)[]) {
    const [avifBytes, avifCached] = await encodeAvif(pngBytes, JACKET_SIZES[kind]);
    const name = `${kind === 'jacket' ? 'jacket' : 'jacket-sm'}.${hash8(avifBytes)}.avif`;
    names[kind] = name;
    const path = join(outDir, name);
    log((await writeIfChanged(path, avifBytes)) ? (avifCached ? 'cached' : 'encoded') : 'unchanged', path);
  }
  const palette = await extractPalette(pngBytes);

  // stale hashed files
  const keep = new Set([audioName, names.jacket, names.jacketSm]);
  for (const name of (await readdir(outDir)).sort()) {
    if (HASHED_FILE.test(name) && !keep.has(name)) {
      await unlink(join(outDir, name));
      log('removed', join(outDir, name));
    }
  }

  // meta.json (field order follows SongMeta)
  const source = await readSongSource(join(srcDir, 'song.json'));
  const meta: SongMeta = {
    id,
    title: source.title ?? chart.meta.title,
    artist: source.artist ?? chart.meta.artist,
    palette,
    audioOffset: source.audioOffset ?? 0,
    durationMs,
    audio: audioName,
    jacket: names.jacket,
    jacketSm: names.jacketSm,
    charts,
  };
  const metaPath = join(outDir, 'meta.json');
  log((await writeIfChanged(metaPath, `${JSON.stringify(meta, null, 2)}\n`)) ? 'wrote' : 'unchanged', metaPath);

  console.log(`  ${id}: ${(durationMs / 1000).toFixed(1)} s, bpm ${chart.meta.bpm[0]}–${chart.meta.bpm[1]}, palette ${palette.join(' ')}`);
  for (const c of charts) console.log(`    ${c.tier.padEnd(6)} lv${c.level} ${c.notes} notes, od ${c.od}, ${c.file}, hash ${c.hash}`);
  return meta;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function songIds(): Promise<string[]> {
  const entries = await readdir(SRC_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

async function warnOrphans(ids: readonly string[]): Promise<void> {
  const known = new Set(ids);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(OUT_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory() && !known.has(e.name)) {
      console.warn(`warning: public/songs/${e.name}/ has no songs-src counterpart (left in place; delete it by hand)`);
    }
  }
}

async function main(): Promise<void> {
  await ffmpegVersion();
  const ids = await songIds();
  if (ids.length === 0) console.warn('warning: songs-src/ has no song directories');

  const songs: SongMeta[] = [];
  for (const id of ids) songs.push(await buildSong(id));
  await warnOrphans(ids);

  const index: SongIndex = { version: 1, songs: songs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
  const indexPath = join(OUT_DIR, 'index.json');
  log((await writeIfChanged(indexPath, `${JSON.stringify(index, null, 2)}\n`)) ? 'wrote' : 'unchanged', indexPath);

  const [probeBytes, probeCached] = await encodeProbe();
  log((await writeIfChanged(PROBE_PATH, probeBytes)) ? (probeCached ? 'cached' : 'encoded') : 'unchanged', PROBE_PATH);
}

if (import.meta.main) {
  await main();
}
