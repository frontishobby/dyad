/**
 * Track renderer (PLAN §3, DESIGN §2/§4/§5). One code path for both
 * orientations: everything that scrolls or sits on the track is drawn in
 * track-local coordinates inside `world`, whose transform comes from
 * layout.localFrame(). Text (judgement, spinner counts) and the portrait touch
 * zones live in `hud`, positioned in screen space so they stay upright.
 * The gate is a judgement line in both orientations (no cells); a held key
 * shows its shape on the line, and the touch zones themselves light on press.
 *
 * Hot path: frame() allocates nothing. Notes and beat lines are pooled
 * Graphics that share prebuilt GraphicsContexts; per-note effect state lives
 * in typed arrays; every colour is a precomputed number.
 */
import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { Chart, Engine, EngineEvent, Judgement, Key, NoteKind } from '../core/types.ts';
import { keyHand, keyKind, partnerKey } from '../core/types.ts';
import { MOTION, SHAPE, TYPE, hexToNumber, type Theme } from '../design/tokens.ts';
import { localFrame, localToScreen, nearClipPx, seamPosition, trackNearPx, type Vec2 } from './layout.ts';
import {
  bigDiameter,
  brickContext,
  buildNoteContexts,
  burstContext,
  destroyNoteContexts,
  dividerContext,
  instance,
  lineContext,
  noteDiameter,
  rectContext,
  ringContext,
  silhouetteContext,
  type NoteContexts,
} from './shapes.ts';
import type { Layout, TrackRenderer, TrackRendererOptions } from './types.ts';

// ─── constants ──────────────────────────────────────────────────────────────

/** Judgement word stays up this long (DESIGN §1: read in one frame, then gone). */
const JUDGEMENT_TEXT_MS = 400;
/** Touch zone lit, and the pressed shape shown on the seam, while a key is held: type colour at 40%. */
const PRESS_ALPHA = 0.4;
/** OK: type colour at 60%. */
const OK_ALPHA = 0.6;
/** Big note awaiting its partner: the hand that already landed is dimmed to this. */
const LANDED_HALF_ALPHA = 0.35;
/** Notes are placed this many N beyond the spawn edge (plus the big radius) so they slide in under the mask. */
const SPAWN_MARGIN_N = 1;
/** Touch-zone silhouette diameter as a fraction of the cell's shorter side, and its alpha in the type colour. */
const SILHOUETTE_FRACTION = 0.36;
const SILHOUETTE_ALPHA = 0.5;
/** Judgement word: landscape sits this far above the track band, at the seam x. */
const JUDGEMENT_ABOVE_PX = 40;
/** Judgement word: portrait sits this many N on the spawn side of the seam, over the lane. */
const JUDGEMENT_P_N = 3;
/** Judgement word size per orientation (DESIGN §3: 40; portrait lanes are narrower). */
const JUDGEMENT_FONT = { portrait: 32, landscape: TYPE.size.judgement } as const;
/** Roll / spinner bodies brighten to this tint on a tick and fall back over cellDecay. */
const SPAN_FLASH_MS = MOTION.cellDecay;
/** Judgement line (DESIGN §4): thickness in px, and the lit overlay's thickness. */
const SEAM_LINE_PX = 2;
const SEAM_LIT_PX = 6;
/** Cap on generated beat lines (a 10-minute song at 300 BPM is 3000). */
const MAX_LINES = 20000;
/** Hit bursts alive at once (a ring buffer; the oldest is reused). */
const BURST_POOL = 16;
/** A burst grows to (1 + BURST_GROW) × its outline over MOTION.burst. */
const BURST_GROW = 0.9;
/** Burst peak alpha by cause. */
const BURST_ALPHA = { great: 1, ok: 0.7, half: 0.55, tick: 0.4 } as const;
/** Hit note pops to (1 + HIT_POP) × while it vanishes. */
const HIT_POP = 0.2;
/** Judgement word: overshoot of the pop-in (Great / OK), rise while shown, and Miss's drop, in px. */
const JUDGEMENT_OVERSHOOT = { great: 0.35, ok: 0.15 } as const;
const JUDGEMENT_RISE_PX = 12;
const JUDGEMENT_DROP_PX = 10;
/** Judgement word starts fading at this fraction of JUDGEMENT_TEXT_MS. */
const JUDGEMENT_FADE_FROM = 0.6;
/** Beat pulse: a plain beat reaches this fraction of the bar's brightness. */
const BEAT_PULSE_FRACTION = 0.4;
/** Bar pulse on the band background: surface → raised by at most this. */
const BAND_PULSE = 0.6;
/** Seam line dips to this alpha on a Miss, recovering over cellDecay. */
const SEAM_MISS_ALPHA = 0.35;
/** Spinner countdown label pops to (1 + this) × on each tick. */
const LABEL_POP = 0.3;

// key index: KL 0, KR 1, DL 2, DR 3
const KEY_ORDER: readonly Key[] = ['KL', 'KR', 'DL', 'DR'];
function keyIndex(key: Key): number {
  switch (key) {
    case 'KL': return 0;
    case 'KR': return 1;
    case 'DL': return 2;
    case 'DR': return 3;
  }
}
function kindIndex(kind: NoteKind): number {
  return kind === 'd' ? 0 : 1;
}

// per-note effect phases
const FX_NONE = 0;
const FX_AWAITING = 1;
const FX_HIT = 2;
const FX_MISS = 3;

// judgements as small ints
const J_NONE = 0;
const J_GREAT = 1;
const J_OK = 2;
const J_MISS = 3;
function judgementCode(j: Judgement | null): number {
  return j === 'great' ? J_GREAT : j === 'ok' ? J_OK : j === 'miss' ? J_MISS : J_NONE;
}

// hands
const HAND_NONE = 0;
const HAND_L = 1;
const HAND_R = 2;

// cell lit reasons
const LIT_NONE = 0;
const LIT_PRESS = 1;
const LIT_OK = 2;
const LIT_GREAT = 3;

// ─── small helpers ──────────────────────────────────────────────────────────

/** Lerp two 0xRRGGBB colours; k in 0..1. No allocation. */
function lerpColor(a: number, b: number, k: number): number {
  const t = k <= 0 ? 0 : k >= 1 ? 1 : k;
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return ((r + 0.5) << 16) | ((g + 0.5) << 8) | (bl + 0.5);
}

/** First index in `arr[0..len)` whose value is ≥ v. */
function lowerBound(arr: Float64Array, len: number, v: number): number {
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((arr[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Max number of times within any window of `windowMs` over a sorted list (two pointers). */
function maxInWindow(times: ArrayLike<number>, len: number, windowMs: number): number {
  let best = 0;
  let head = 0;
  for (let tail = 0; tail < len; tail++) {
    while ((times[tail] as number) - (times[head] as number) > windowMs) head++;
    const n = tail - head + 1;
    if (n > best) best = n;
  }
  return best;
}

// ─── pools ──────────────────────────────────────────────────────────────────

interface RegularPool {
  ctx: GraphicsContext;
  items: Graphics[];
  used: number;
  lastUsed: number;
}

interface BigView {
  root: Container;
  left: Graphics;
  right: Graphics;
  seam: Graphics;
}

interface BigPool {
  leftCtx: GraphicsContext;
  rightCtx: GraphicsContext;
  seamCtx: GraphicsContext;
  items: BigView[];
  used: number;
  lastUsed: number;
}

function makeRegularPool(ctx: GraphicsContext, layer: Container, size: number): RegularPool {
  const pool: RegularPool = { ctx, items: [], used: 0, lastUsed: 0 };
  growRegular(pool, layer, size);
  return pool;
}

function growRegular(pool: RegularPool, layer: Container, size: number): void {
  while (pool.items.length < size) {
    const g = instance(pool.ctx);
    layer.addChild(g);
    pool.items.push(g);
  }
}

function makeBigView(pool: BigPool): BigView {
  const root = new Container();
  root.visible = false;
  const left = new Graphics({ context: pool.leftCtx });
  const right = new Graphics({ context: pool.rightCtx });
  const seam = new Graphics({ context: pool.seamCtx });
  root.addChild(left, right, seam);
  return { root, left, right, seam };
}

function makeBigPool(leftCtx: GraphicsContext, rightCtx: GraphicsContext, seamCtx: GraphicsContext, layer: Container, size: number): BigPool {
  const pool: BigPool = { leftCtx, rightCtx, seamCtx, items: [], used: 0, lastUsed: 0 };
  growBig(pool, layer, size);
  return pool;
}

function growBig(pool: BigPool, layer: Container, size: number): void {
  while (pool.items.length < size) {
    const v = makeBigView(pool);
    layer.addChild(v.root);
    pool.items.push(v);
  }
}

function hideUnused(pool: RegularPool | BigPool): void {
  const items = pool.items;
  for (let i = pool.used; i < pool.lastUsed; i++) {
    const it = items[i];
    if (!it) break;
    if (it instanceof Graphics) it.visible = false;
    else it.root.visible = false;
  }
  pool.lastUsed = pool.used;
  pool.used = 0;
}

function destroyPool(pool: RegularPool | BigPool): void {
  for (const it of pool.items) {
    if (it instanceof Graphics) it.destroy();
    else it.root.destroy({ children: true });
  }
  pool.items.length = 0;
}

// ─── gate cells / touch zones ───────────────────────────────────────────────

interface Zone {
  base: Graphics;
  lit: Graphics;
  silhouette: Graphics;
  type: number;
}

/**
 * A roll or spinner body: one Graphics spanning [t, end] along the progress
 * axis, drawn white and tinted (raised at rest, brighter on each tick).
 * Spinners also carry an upright HUD label with the presses still needed.
 */
interface Span {
  kind: 'roll' | 'spinner';
  index: number;
  t: number;
  end: number;
  g: Graphics;
  ctx: GraphicsContext;
  label: Text | null;
}

// ─── beat lines ─────────────────────────────────────────────────────────────

interface BeatLines {
  t: Float64Array;
  bar: Uint8Array;
  count: number;
}

function buildBeatLines(chart: Chart): BeatLines {
  const timing = chart.timing;
  let endMs = 0;
  for (const n of chart.notes) if (n.t > endMs) endMs = n.t;
  for (const r of chart.rolls) if (r.end > endMs) endMs = r.end;
  for (const s of chart.spinners) if (s.end > endMs) endMs = s.end;

  const ts: number[] = [];
  const bars: number[] = [];
  for (let i = 0; i < timing.length; i++) {
    const tp = timing[i];
    if (!tp) continue;
    const beat = tp.beatLength;
    if (!(beat > 0) || !Number.isFinite(beat)) continue;
    const meter = tp.meter > 0 && Number.isFinite(tp.meter) ? Math.round(tp.meter) : 4;
    const next = timing[i + 1];
    // Last segment runs one bar past the final object.
    const segmentEnd = next ? next.t : Math.max(tp.t, endMs) + beat * meter;
    let beatNo = 0;
    for (let t = tp.t; t < segmentEnd && ts.length < MAX_LINES; t += beat, beatNo++) {
      ts.push(t);
      bars.push(beatNo % meter === 0 ? 1 : 0);
    }
  }
  return { t: Float64Array.from(ts), bar: Uint8Array.from(bars), count: ts.length };
}

// ─── renderer ───────────────────────────────────────────────────────────────

export function createTrackRenderer(opts: TrackRendererOptions): TrackRenderer {
  const { chart, theme, reducedMotion } = opts;
  let layout = opts.layout;
  let leadMs = opts.leadMs > 0 ? opts.leadMs : 750;

  // colours as numbers
  const C = {
    don: hexToNumber(theme.don),
    kat: hexToNumber(theme.kat),
    flash: hexToNumber(theme.flash),
    faint: hexToNumber(theme.textFaint),
    surface: hexToNumber(theme.surface),
    raised: hexToNumber(theme.raised),
    line: hexToNumber(theme.line),
    ground: hexToNumber(theme.ground),
    text: hexToNumber(theme.text),
    textDim: hexToNumber(theme.textDim),
  };
  const TYPE_COLOR = [C.don, C.kat] as const; // by kindIndex

  // ─── scene graph
  const view = new Container();
  view.label = 'track';
  const world = new Container();
  world.label = 'world';
  const hud = new Container();
  hud.label = 'hud';
  view.addChild(world, hud);

  const bgLayer = new Container();
  const lineLayer = new Container();
  const gateLayer = new Container();
  const noteLayer = new Container();
  const burstLayer = new Container();
  world.addChild(bgLayer, lineLayer, gateLayer, noteLayer, burstLayer);

  const zoneLayer = new Container();
  const labelLayer = new Container();
  const judgementLayer = new Container();
  const spanLabelLayer = new Container();
  hud.addChild(zoneLayer, labelLayer, judgementLayer, spanLabelLayer);

  // ─── per-note effect state
  const noteCount = chart.notes.length;
  const fx = new Uint8Array(noteCount);
  const fxAt = new Float64Array(noteCount);
  const fxJudge = new Uint8Array(noteCount);
  const fxHand = new Uint8Array(noteCount);

  // ─── key state (index = keyIndex)
  const cellPressed = new Uint8Array(4);
  /** Release time per key: touch zones and ghosts decay from it. */
  const zoneOffAt = new Float64Array(4).fill(-Infinity);
  /** Last pressed hand per note type (kindIndex) — resolves which half landed while a big note awaits its partner. */
  const lastPressHand = new Uint8Array(2);

  // ─── judgement text state
  let judgementShown = J_NONE;
  let judgementAt = -Infinity;
  /** Where the judgement word rests (screen space); the animation offsets from here. */
  const judgementBase: Vec2 = { x: 0, y: 0 };
  /** Last Miss; the seam line dips for cellDecay after it. */
  let missAt = -Infinity;

  // ─── hit bursts: pooled outlines parked on the seam (ring buffer)
  const bursts: Graphics[] = [];
  /** [don, kat, big don, big kat], rebuilt with the layout. */
  let burstCtx: GraphicsContext[] = [];
  const burstAt = new Float64Array(BURST_POOL).fill(-Infinity);
  const burstTint = new Uint32Array(BURST_POOL);
  const burstFlash = new Uint8Array(BURST_POOL);
  const burstPeak = new Float64Array(BURST_POOL);
  let burstHead = 0;

  /** Latest song time seen; press() stamps with it. */
  let now = 0;

  // ─── built geometry (rebuilt by setLayout)
  let noteCtx: NoteContexts | null = null;
  let staticContexts: GraphicsContext[] = [];
  let donPool: RegularPool | null = null;
  let katPool: RegularPool | null = null;
  let bigDonPool: BigPool | null = null;
  let bigKatPool: BigPool | null = null;
  let beatPool: RegularPool | null = null;
  let barPool: RegularPool | null = null;
  let noteMask: Graphics | null = null;
  /** Band background (white, tinted surface; the bar pulse lifts it toward raised). */
  let bandBg: Graphics | null = null;
  /** Roll and spinner bodies (rebuilt with the layout and with leadMs, since their length is in px). */
  const spans: Span[] = [];
  const spanFlashAt = new Float64Array(chart.rolls.length + chart.spinners.length).fill(-Infinity);
  const spanTmp: Vec2 = { x: 0, y: 0 };
  /** The judgement line, the receptor ring on it (big-note size) and the ring's judgement flash. */
  let seamLine: Graphics | null = null;
  let seamRing: Graphics | null = null;
  let seamLit: Graphics | null = null;
  let seamKind = LIT_NONE;
  let seamAt = -Infinity;
  /**
   * The pressed type's shape on the seam. One hand held → the regular note
   * centred; both hands → the big note (two halves). Index = kindIndex.
   */
  const ghostRegular: Graphics[] = [];
  const ghostBig: [Graphics, Graphics][] = [];
  const zones: Zone[] = [];
  const judgementTexts: Text[] = []; // index J_GREAT-1 .. J_MISS-1

  const lines = buildBeatLines(chart);

  // derived per layout / leadMs
  let N = layout.N;
  let W = layout.W;
  let leadPx = layout.leadPx;
  /** Regular and big note diameters (DESIGN §2: from the lead distance). */
  let d = noteDiameter(leadPx);
  let D = bigDiameter(leadPx);
  let pxPerMs = leadPx / leadMs;
  let farPx = leadPx + D / 2 + SPAWN_MARGIN_N * N;
  let farMs = farPx / pxPerMs;
  let missTravelPx = SHAPE.missTravel * N;
  let missTravelMs = missTravelPx / pxPerMs;
  let trackNear = trackNearPx(layout);
  let nearLineMs = 0;

  function recomputeScroll(): void {
    N = layout.N;
    W = layout.W;
    leadPx = layout.leadPx;
    d = noteDiameter(leadPx);
    D = bigDiameter(leadPx);
    pxPerMs = leadPx / leadMs;
    farPx = leadPx + D / 2 + SPAWN_MARGIN_N * N;
    farMs = farPx / pxPerMs;
    missTravelPx = SHAPE.missTravel * N;
    missTravelMs = missTravelPx / pxPerMs;
    trackNear = trackNearPx(layout);
    // Lines are clipped to the track rectangle; in landscape that reaches past the gate.
    nearLineMs = Math.max(0, -trackNear) / pxPerMs;
  }

  /** Tail window after t in which a judged note may still be drawn. */
  function tailMs(engine: Engine): number {
    const cfg = engine.config;
    const hitTail = cfg.windows.miss + cfg.bigWindowMs + MOTION.hitVanish;
    return Math.max(missTravelMs, hitTail);
  }

  /**
   * A pending note this far past the seam (negative p) is no longer drawn: it
   * is beyond both the miss travel and the engine's miss window, so it can
   * neither be hit nor is it waiting to be marked missed by a late tick.
   */
  let pendingCullPx = -Infinity;
  function updatePendingCull(engine: Engine): void {
    pendingCullPx = -Math.max(missTravelPx, engine.config.windows.miss * pxPerMs);
  }

  function scrollP(t: number, songMs: number): number {
    return (t - songMs) * pxPerMs;
  }

  // ─── pool sizing
  const noteTimes = { d: [] as number[], k: [] as number[], bd: [] as number[], bk: [] as number[] };
  for (const n of chart.notes) {
    (n.big ? (n.k === 'd' ? noteTimes.bd : noteTimes.bk) : n.k === 'd' ? noteTimes.d : noteTimes.k).push(n.t);
  }

  function sizePools(): void {
    // Visible window in ms: spawn margin ahead + the longest tail behind.
    const windowMs = farMs + Math.max(missTravelMs, 300 + MOTION.hitVanish);
    if (donPool) growRegular(donPool, noteLayer, maxInWindow(noteTimes.d, noteTimes.d.length, windowMs));
    if (katPool) growRegular(katPool, noteLayer, maxInWindow(noteTimes.k, noteTimes.k.length, windowMs));
    if (bigDonPool) growBig(bigDonPool, noteLayer, maxInWindow(noteTimes.bd, noteTimes.bd.length, windowMs));
    if (bigKatPool) growBig(bigKatPool, noteLayer, maxInWindow(noteTimes.bk, noteTimes.bk.length, windowMs));
    const lineWindow = leadMs + nearLineMs;
    const maxLines = maxInWindow(lines.t, lines.count, lineWindow) + 1;
    if (beatPool) growRegular(beatPool, lineLayer, maxLines);
    if (barPool) growRegular(barPool, lineLayer, maxLines);
  }

  // ─── static geometry
  function teardownGeometry(): void {
    if (donPool) destroyPool(donPool);
    if (katPool) destroyPool(katPool);
    if (bigDonPool) destroyPool(bigDonPool);
    if (bigKatPool) destroyPool(bigKatPool);
    if (beatPool) destroyPool(beatPool);
    if (barPool) destroyPool(barPool);
    donPool = katPool = null;
    bigDonPool = bigKatPool = null;
    beatPool = barPool = null;
    if (noteMask) {
      noteLayer.mask = null;
      noteMask.destroy();
      noteMask = null;
    }
    destroySpans();
    seamLine?.destroy();
    seamRing?.destroy();
    seamLit?.destroy();
    seamLine = seamRing = seamLit = null;
    seamKind = LIT_NONE;
    for (const g of ghostRegular) g.destroy();
    ghostRegular.length = 0;
    for (const [l, r] of ghostBig) {
      l.destroy();
      r.destroy();
    }
    ghostBig.length = 0;
    for (const z of zones) {
      z.base.destroy();
      z.lit.destroy();
      z.silhouette.destroy();
    }
    zones.length = 0;
    for (const t of judgementTexts) t.destroy();
    judgementTexts.length = 0;
    for (const g of bursts) g.destroy();
    bursts.length = 0;
    for (const ctx of burstCtx) ctx.destroy();
    burstCtx = [];
    burstAt.fill(-Infinity);
    bandBg = null;
    bgLayer.removeChildren().forEach((c) => c.destroy());
    if (noteCtx) destroyNoteContexts(noteCtx);
    noteCtx = null;
    for (const ctx of staticContexts) ctx.destroy();
    staticContexts = [];
  }

  function buildGeometry(): void {
    recomputeScroll();

    const frame = localFrame(layout);
    world.position.set(frame.x, frame.y);
    world.rotation = frame.rotation;

    const gap = N * SHAPE.gateGap;
    const gateFar = N + gap / 2; // p of the gate's far edge

    // Track background over the track rectangle only (p from trackNear to leadPx).
    // White and tinted, so the bar pulse can lift it toward `raised`.
    const bgCtx = rectContext(0, -leadPx, W, leadPx - trackNear, 0xffffff);
    const dividerCtx = dividerContext(W, -leadPx, Math.min(-gateFar, -trackNear), C.line);
    staticContexts.push(bgCtx, dividerCtx);
    bandBg = new Graphics({ context: bgCtx });
    bandBg.tint = C.surface;
    bgLayer.addChild(bandBg, new Graphics({ context: dividerCtx }));

    // Hit bursts: the regular and big outlines, and a pool of instances that swap between them.
    burstCtx = [burstContext(d, d * SHAPE.ringStroke), burstContext(D, d * SHAPE.ringStroke)];
    for (let i = 0; i < BURST_POOL; i++) {
      const g = new Graphics({ context: burstCtx[0] });
      g.visible = false;
      burstLayer.addChild(g);
      bursts.push(g);
    }

    // Notes are clipped to [spawn edge, near clip]; sideways the mask allows the big disc.
    const nearClip = nearClipPx(layout);
    const maskCtx = rectContext(-D, -leadPx, W + D * 2, leadPx - nearClip, C.ground);
    staticContexts.push(maskCtx);
    noteMask = new Graphics({ context: maskCtx });
    world.addChild(noteMask);
    noteLayer.mask = noteMask;

    // Note contexts and pools.
    noteCtx = buildNoteContexts(d, D, C.ground);
    donPool = makeRegularPool(noteCtx.don, noteLayer, 0);
    katPool = makeRegularPool(noteCtx.kat, noteLayer, 0);
    bigDonPool = makeBigPool(noteCtx.bigDonL, noteCtx.bigDonR, noteCtx.seam, noteLayer, 0);
    bigKatPool = makeBigPool(noteCtx.bigKatL, noteCtx.bigKatR, noteCtx.seam, noteLayer, 0);

    // Beat / bar lines.
    const beatCtx = lineContext(W, C.line);
    const barCtx = lineContext(W, C.faint);
    staticContexts.push(beatCtx, barCtx);
    beatPool = makeRegularPool(beatCtx, lineLayer, 0);
    barPool = makeRegularPool(barCtx, lineLayer, 0);

    // The gate: a thin judgement line across the width axis in both
    // orientations (local y = 0 is the seam) and, centred on it, an empty ring
    // of the big-note diameter that the notes pass through (taiko's receptor).
    // The ring flashes white on a Great and dim on an OK.
    {
      const lineCtx = rectContext(0, -SEAM_LINE_PX / 2, W, SEAM_LINE_PX, 0xffffff);
      const ringCtx = ringContext(D, d * SHAPE.ringStroke);
      const litCtx = ringContext(D, d * SHAPE.ringStroke * 2);
      staticContexts.push(lineCtx, ringCtx, litCtx);
      seamLine = new Graphics({ context: lineCtx });
      seamLine.tint = C.textDim; // the beat pulse lifts it toward `text`
      seamRing = new Graphics({ context: ringCtx });
      seamRing.position.set(W / 2, 0);
      seamRing.tint = C.textDim;
      seamLit = new Graphics({ context: litCtx });
      seamLit.position.set(W / 2, 0);
      seamLit.visible = false;
      gateLayer.addChild(seamLine, seamRing, seamLit);
      // Pressed-key ghosts on the seam: one hand → the regular shape centred, both → the big shape.
      const nc = noteCtx as NoteContexts;
      const kinds: [GraphicsContext, GraphicsContext, GraphicsContext][] = [
        [nc.don, nc.bigDonL, nc.bigDonR], // kindIndex 0 = don
        [nc.kat, nc.bigKatL, nc.bigKatR], // kindIndex 1 = kat
      ];
      kinds.forEach(([regular, bigL, bigR], kind) => {
        const tint = TYPE_COLOR[kind] as number;
        const g = new Graphics({ context: regular });
        const l = new Graphics({ context: bigL });
        const r = new Graphics({ context: bigR });
        for (const x of [g, l, r]) {
          x.position.set(W / 2, 0);
          x.tint = tint;
          x.visible = false;
          gateLayer.addChild(x);
        }
        ghostRegular.push(g);
        ghostBig.push([l, r]);
      });
    }

    // Touch zones (portrait).
    const tz = layout.touchZones;
    if (tz) {
      for (const key of KEY_ORDER) {
        const r = tz[key];
        const baseCtx = brickContext(r.w, r.h, C.raised);
        const litCtx = brickContext(r.w, r.h, 0xffffff);
        const silCtx = silhouetteContext(Math.min(r.w, r.h) * SILHOUETTE_FRACTION);
        staticContexts.push(baseCtx, litCtx, silCtx);
        const base = new Graphics({ context: baseCtx });
        const lit = new Graphics({ context: litCtx });
        const silhouette = new Graphics({ context: silCtx });
        base.position.set(r.x, r.y);
        lit.position.set(r.x, r.y);
        lit.visible = false;
        silhouette.position.set(r.x + r.w / 2, r.y + r.h / 2);
        // The type is the colour (DESIGN §2): a dim disc of it says what this zone hits.
        silhouette.tint = TYPE_COLOR[kindIndex(keyKind(key))] as number;
        silhouette.alpha = SILHOUETTE_ALPHA;
        zoneLayer.addChild(base, lit, silhouette);
        zones.push({ base, lit, silhouette, type: kindIndex(keyKind(key)) });
      }
    }

    // Judgement words: three prebuilt texts, one visible at a time.
    // Landscape: in the band above the track, centred on the seam x (DESIGN §4).
    // Portrait: over the lane, JUDGEMENT_P_N × N on the spawn side of the seam.
    const jc =
      layout.orientation === 'landscape'
        ? { x: seamPosition(layout), y: layout.track.y - JUDGEMENT_ABOVE_PX }
        : localToScreen(layout, JUDGEMENT_P_N * N, 0.5);
    judgementBase.x = jc.x;
    judgementBase.y = jc.y;
    const judgementSize = JUDGEMENT_FONT[layout.orientation];
    const words: [string, number][] = [
      ['Great', C.text],
      ['OK', C.textDim],
      ['Miss', C.faint],
    ];
    for (const [word, fill] of words) {
      const text = new Text({
        text: word,
        style: new TextStyle({ fontFamily: TYPE.display, fontSize: judgementSize, fontWeight: '500', fill }),
        anchor: 0.5,
      });
      text.position.set(jc.x, jc.y);
      text.visible = false;
      judgementLayer.addChild(text);
      judgementTexts.push(text);
    }

    sizePools();
    buildSpans();
  }

  buildGeometry();

  // ─── per-frame placement
  function placeRegular(pool: RegularPool, x: number, y: number, tint: number, alpha: number, scale = 1): void {
    let g = pool.items[pool.used];
    if (!g) {
      // Pool estimate was short: grow once, never per frame in steady state.
      growRegular(pool, pool === beatPool || pool === barPool ? lineLayer : noteLayer, pool.items.length + 1);
      g = pool.items[pool.used] as Graphics;
    }
    g.visible = true;
    g.position.set(x, y);
    g.scale.set(scale);
    g.tint = tint;
    g.alpha = alpha;
    pool.used++;
  }

  function placeBig(
    pool: BigPool,
    x: number,
    y: number,
    tint: number,
    alphaL: number,
    alphaR: number,
    alphaSeam: number,
    scale = 1,
  ): void {
    let v = pool.items[pool.used];
    if (!v) {
      growBig(pool, noteLayer, pool.items.length + 1);
      v = pool.items[pool.used] as BigView;
    }
    v.root.visible = true;
    v.root.position.set(x, y);
    v.root.scale.set(scale);
    v.left.tint = tint;
    v.right.tint = tint;
    v.left.alpha = alphaL;
    v.right.alpha = alphaR;
    v.seam.alpha = alphaSeam;
    pool.used++;
  }

  function placeNote(i: number, engine: Engine, songMs: number): void {
    const note = chart.notes[i];
    if (!note) return;
    const v = engine.noteView(i);
    const ki = kindIndex(note.k);
    let tint = ki === 0 ? C.don : C.kat;
    let alpha = 1;
    let alphaL = 1;
    let alphaR = 1;
    let scale = 1;
    let p: number;

    const status = v.status;
    if (status === 'missed' || (status === 'hit' && v.judgement === 'miss')) {
      // Desaturated, keeps scrolling through the gate, gone missTravel × N past the seam.
      if (fx[i] !== FX_MISS) {
        fx[i] = FX_MISS;
        fxJudge[i] = J_MISS;
      }
      p = scrollP(note.t, songMs);
      if (p < -missTravelPx) return;
      tint = C.faint;
    } else if (status === 'hit' && !v.awaitingPartner) {
      // Resolved hit: freeze where it was hit, push toward the gate, fade out.
      if (fx[i] !== FX_HIT) {
        // No event carried the resolution (partner window expired, or events not applied).
        fx[i] = FX_HIT;
        fxAt[i] = songMs;
        if (fxJudge[i] === J_NONE) fxJudge[i] = judgementCode(v.judgement);
      }
      const elapsed = songMs - (fxAt[i] as number);
      if (reducedMotion || elapsed >= MOTION.hitVanish) return;
      const k = elapsed < 0 ? 0 : elapsed / MOTION.hitVanish;
      p = scrollP(note.t, fxAt[i] as number) - SHAPE.hitPush * N * k;
      alpha = 1 - k;
      scale = 1 + HIT_POP * k;
      if (fxJudge[i] === J_GREAT) tint = C.flash;
    } else {
      // Pending, or a big note whose first hand landed and whose partner is awaited.
      p = scrollP(note.t, songMs);
      if (p > farPx || p < pendingCullPx) return;
      if (note.big && v.awaitingPartner) {
        let hand = fxHand[i] as number;
        if (hand === HAND_NONE) {
          hand = lastPressHand[ki] as number;
          fxHand[i] = hand;
        }
        if (hand === HAND_L) alphaL = LANDED_HALF_ALPHA;
        else if (hand === HAND_R) alphaR = LANDED_HALF_ALPHA;
      }
    }

    const y = -p;
    const x = W / 2;
    if (!note.big) {
      placeRegular((ki === 0 ? donPool : katPool) as RegularPool, x, y, tint, alpha, scale);
    } else {
      placeBig((ki === 0 ? bigDonPool : bigKatPool) as BigPool, x, y, tint, alpha * alphaL, alpha * alphaR, alpha, scale);
    }
  }

  function placeLines(songMs: number): void {
    const beat = beatPool as RegularPool;
    const bar = barPool as RegularPool;
    const nearT = songMs - nearLineMs;
    const farT = songMs + leadMs;
    let i = lowerBound(lines.t, lines.count, nearT);
    for (; i < lines.count; i++) {
      const t = lines.t[i] as number;
      if (t > farT) break;
      const p = scrollP(t, songMs);
      placeRegular(lines.bar[i] ? bar : beat, 0, -p, 0xffffff, 1);
    }
    hideUnused(beat);
    hideUnused(bar);
  }

  function updateZones(songMs: number): void {
    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i] as Zone;
      let alpha: number;
      if (cellPressed[i] === 1) {
        alpha = PRESS_ALPHA;
      } else {
        const d = (songMs - (zoneOffAt[i] as number)) / MOTION.cellDecay;
        alpha = d >= 1 ? 0 : PRESS_ALPHA * (1 - (d < 0 ? 0 : d));
      }
      zone.lit.visible = alpha > 0;
      zone.lit.alpha = alpha;
      zone.lit.tint = TYPE_COLOR[zone.type] as number;
    }
  }

  /**
   * Judgement word: Great and OK pop in (overshoot, settling over
   * MOTION.judgementPop) and drift toward spawn; Miss sinks the other way.
   * All fade over the last stretch of JUDGEMENT_TEXT_MS. Reduced motion: static.
   */
  function updateJudgement(songMs: number): void {
    const elapsed = songMs - judgementAt;
    const show = judgementShown !== J_NONE && elapsed >= 0 && elapsed < JUDGEMENT_TEXT_MS;
    for (let j = 0; j < judgementTexts.length; j++) {
      const text = judgementTexts[j] as Text;
      const on = show && j === judgementShown - 1;
      text.visible = on;
      if (!on) continue;
      if (reducedMotion) {
        text.scale.set(1);
        text.alpha = 1;
        text.position.set(judgementBase.x, judgementBase.y);
        continue;
      }
      const k = elapsed / JUDGEMENT_TEXT_MS;
      let scale = 1;
      let dy: number;
      if (judgementShown === J_MISS) {
        dy = JUDGEMENT_DROP_PX * k;
      } else {
        const pop = Math.min(1, elapsed / MOTION.judgementPop);
        const eased = 1 - (1 - pop) * (1 - pop);
        const over = judgementShown === J_GREAT ? JUDGEMENT_OVERSHOOT.great : JUDGEMENT_OVERSHOOT.ok;
        scale = 1 + over * (1 - eased);
        dy = -JUDGEMENT_RISE_PX * k;
      }
      text.scale.set(scale);
      text.alpha = k < JUDGEMENT_FADE_FROM ? 1 : 1 - (k - JUDGEMENT_FADE_FROM) / (1 - JUDGEMENT_FADE_FROM);
      text.position.set(judgementBase.x, judgementBase.y + dy);
    }
  }

  // ─── hit bursts
  /** Park a burst of the given shape on the seam; `flash` starts it white (Great). */
  function spawnBurst(kind: number, big: boolean, flash: boolean, peak: number, songMs: number): void {
    if (reducedMotion) return;
    const i = burstHead;
    burstHead = (burstHead + 1) % BURST_POOL;
    const g = bursts[i];
    const ctx = burstCtx[big ? 1 : 0];
    if (!g || !ctx) return;
    g.context = ctx;
    g.position.set(W / 2, 0);
    burstAt[i] = songMs;
    burstTint[i] = TYPE_COLOR[kind] as number;
    burstFlash[i] = flash ? 1 : 0;
    burstPeak[i] = peak;
  }

  function updateBursts(songMs: number): void {
    for (let i = 0; i < bursts.length; i++) {
      const g = bursts[i] as Graphics;
      const k = (songMs - (burstAt[i] as number)) / MOTION.burst;
      if (k < 0 || k >= 1) {
        g.visible = false;
        continue;
      }
      const eased = 1 - (1 - k) * (1 - k);
      g.visible = true;
      g.scale.set(1 + BURST_GROW * eased);
      g.alpha = (burstPeak[i] as number) * (1 - k);
      const tint = burstTint[i] as number;
      g.tint = burstFlash[i] === 1 ? lerpColor(C.flash, tint, Math.min(1, k * 2)) : tint;
    }
  }

  /**
   * Beat pulse: the most recent beat line lifts the seam line toward `text`
   * (a bar fully, a beat by BEAT_PULSE_FRACTION) and a bar lifts the band
   * background toward `raised`, both decaying over MOTION.beatPulse.
   */
  function updateBeatPulse(songMs: number): void {
    if (reducedMotion) return;
    let i = lowerBound(lines.t, lines.count, songMs);
    if (i >= lines.count || (lines.t[i] as number) > songMs) i--;
    let pulse = 0;
    let bar = false;
    if (i >= 0) {
      const age = songMs - (lines.t[i] as number);
      if (age < MOTION.beatPulse) {
        pulse = 1 - age / MOTION.beatPulse;
        bar = lines.bar[i] === 1;
      }
    }
    const lineTint = lerpColor(C.textDim, C.text, bar ? pulse : pulse * BEAT_PULSE_FRACTION);
    if (seamLine) seamLine.tint = lineTint;
    if (seamRing) seamRing.tint = lineTint;
    if (bandBg) bandBg.tint = lerpColor(C.surface, C.raised, bar ? pulse * BAND_PULSE : 0);
  }

  // ─── rolls and spinners
  function spanSlot(kind: 'roll' | 'spinner', index: number): number {
    return kind === 'roll' ? index : chart.rolls.length + index;
  }

  function destroySpans(): void {
    for (const sp of spans) {
      sp.g.destroy();
      sp.ctx.destroy();
      sp.label?.destroy();
    }
    spans.length = 0;
  }

  /**
   * One body per roll / spinner: a brick of the object's width, as long as its
   * duration in px, origin at the near end (local y = 0 is the start, the body
   * extends toward spawn). Rolls are 0.5W (W when big) like a note; spinners
   * take the whole width and get a countdown label. Bodies sit under the notes.
   */
  function buildSpans(): void {
    const build = (kind: 'roll' | 'spinner', index: number, t: number, end: number, width: number, radius: number, tint: number): void => {
      const length = Math.max(width, (end - t) * pxPerMs);
      const x = (W - width) / 2;
      const ctx = new GraphicsContext();
      ctx.roundRect(x, -length, width, length, radius).fill(0xffffff);
      const g = new Graphics({ context: ctx });
      g.tint = tint;
      g.visible = false;
      noteLayer.addChildAt(g, 0);
      let label: Text | null = null;
      if (kind === 'spinner') {
        label = new Text({
          text: String(chart.spinners[index]?.hits ?? 0),
          style: new TextStyle({ fontFamily: TYPE.display, fontSize: TYPE.size.combo, fontWeight: '500', fill: C.text }),
          anchor: 0.5,
        });
        label.visible = false;
        spanLabelLayer.addChild(label);
      }
      spans.push({ kind, index, t, end, g, ctx, label });
    };
    // Rolls are capsules as wide as the note they start with; spinners span the whole width.
    chart.rolls.forEach((r, i) => build('roll', i, r.t, r.end, r.big ? D : d, (r.big ? D : d) / 2, C.raised));
    chart.spinners.forEach((sp, i) => build('spinner', i, sp.t, sp.end, W, Math.min(W, N) * SHAPE.radius, C.line));
  }

  function placeSpans(songMs: number): void {
    const nearClip = nearClipPx(layout);
    for (let i = 0; i < spans.length; i++) {
      const sp = spans[i] as Span;
      const pStart = scrollP(sp.t, songMs);
      const pEnd = scrollP(sp.end, songMs);
      const visible = pStart <= farPx && pEnd >= nearClip - N;
      sp.g.visible = visible;
      if (sp.label) sp.label.visible = visible;
      if (!visible) continue;
      sp.g.position.set(0, -pStart);
      const base = sp.kind === 'roll' ? C.raised : C.line;
      const d = (songMs - (spanFlashAt[spanSlot(sp.kind, sp.index)] as number)) / SPAN_FLASH_MS;
      sp.g.tint = d >= 0 && d < 1 && !reducedMotion ? lerpColor(C.textDim, base, d) : base;
      if (sp.label) {
        // Keep the label on screen while the body is passing the seam: clamp its centre to the visible part.
        const lo = Math.max(pStart, nearClip);
        const hi = Math.min(pEnd, leadPx);
        const c = localToScreen(layout, (lo + hi) / 2, 0.5, spanTmp);
        sp.label.position.set(c.x, c.y);
        // Each tick pops the countdown.
        sp.label.scale.set(d >= 0 && d < 1 && !reducedMotion ? 1 + LABEL_POP * (1 - d) : 1);
      }
    }
  }

  function flashSpan(kind: 'roll' | 'spinner', index: number, songMs: number): void {
    spanFlashAt[spanSlot(kind, index)] = songMs;
  }

  // ─── effects
  /** Light the judgement line for a judgement (a stronger one wins while the previous still glows). */
  function lightSeam(kind: number, songMs: number): void {
    if (kind > seamKind || songMs >= seamAt + MOTION.cellDecay) {
      seamKind = kind;
      seamAt = songMs;
    }
  }

  /**
   * A held type shows its shape on the seam at PRESS_ALPHA — the regular note
   * centred for one hand, the big note for both — and the regular shape fades
   * over cellDecay once both keys are up.
   */
  function updateGhosts(songMs: number): void {
    for (let kind = 0; kind < ghostRegular.length; kind++) {
      // keyIndex: KL 0, KR 1 (kat), DL 2, DR 3 (don); kindIndex 0 = don, 1 = kat.
      const a = kind === 1 ? 0 : 2;
      const b = a + 1;
      const held = cellPressed[a]! + cellPressed[b]!;
      const regular = ghostRegular[kind] as Graphics;
      const [bigL, bigR] = ghostBig[kind] as [Graphics, Graphics];
      const both = held === 2;
      bigL.visible = both;
      bigR.visible = both;
      if (both) {
        bigL.alpha = PRESS_ALPHA;
        bigR.alpha = PRESS_ALPHA;
        regular.visible = false;
        continue;
      }
      let alpha: number;
      if (held === 1) {
        alpha = PRESS_ALPHA;
      } else {
        const offAt = Math.max(zoneOffAt[a] as number, zoneOffAt[b] as number);
        const d = (songMs - offAt) / MOTION.cellDecay;
        alpha = d >= 1 || reducedMotion ? 0 : PRESS_ALPHA * (1 - (d < 0 ? 0 : d));
      }
      regular.visible = alpha > 0;
      regular.alpha = alpha;
    }
  }

  /**
   * Judgement line: Great flashes white, OK glows dim, both decaying over
   * cellDecay; a Miss dips the line itself for as long.
   */
  function updateSeam(songMs: number): void {
    if (!seamLit) return;
    {
      const m = (songMs - missAt) / MOTION.cellDecay;
      const alpha = m >= 0 && m < 1 && !reducedMotion ? SEAM_MISS_ALPHA + (1 - SEAM_MISS_ALPHA) * m : 1;
      if (seamLine) seamLine.alpha = alpha;
      if (seamRing) seamRing.alpha = alpha;
    }
    const d = (songMs - seamAt) / MOTION.cellDecay;
    if (seamKind === LIT_NONE || d >= 1 || d < 0 || reducedMotion) {
      seamLit.visible = false;
      if (d >= 1) seamKind = LIT_NONE;
      return;
    }
    seamLit.visible = true;
    seamLit.alpha = (seamKind === LIT_GREAT ? 1 : 0.5) * (1 - d);
    seamLit.tint = seamKind === LIT_GREAT ? C.flash : C.textDim;
  }

  function litKindFor(j: number): number {
    return j === J_GREAT ? LIT_GREAT : j === J_OK ? LIT_OK : LIT_NONE;
  }

  function apply(events: readonly EngineEvent[], songMs: number): void {
    now = songMs;
    for (let e = 0; e < events.length; e++) {
      const ev = events[e] as EngineEvent;
      switch (ev.type) {
        case 'note': {
          const i = ev.index;
          if (i < 0 || i >= noteCount) break;
          const j = judgementCode(ev.judgement);
          fxJudge[i] = j;
          judgementShown = j;
          judgementAt = songMs;
          if (j === J_MISS) {
            fx[i] = FX_MISS;
            missAt = songMs;
            break; // Miss: no cell reaction, no burst.
          }
          const note = chart.notes[i];
          const lit = litKindFor(j);
          const kind = note ? kindIndex(note.k) : 0;
          if (ev.big && !ev.strong) {
            // First hand of a big note; the partner window is open.
            fx[i] = FX_AWAITING;
            fxAt[i] = songMs;
            if (ev.key) fxHand[i] = keyHand(ev.key) === 'L' ? HAND_L : HAND_R;
            lightSeam(lit, songMs);
            spawnBurst(kind, false, false, BURST_ALPHA.half, songMs);
          } else {
            fx[i] = FX_HIT;
            fxAt[i] = songMs;
            lightSeam(lit, songMs);
            spawnBurst(kind, ev.strong, j === J_GREAT, j === J_GREAT ? BURST_ALPHA.great : BURST_ALPHA.ok, songMs);
          }
          break;
        }
        case 'roll-tick':
          lightSeam(LIT_OK, songMs);
          flashSpan('roll', ev.index, songMs);
          spawnBurst(kindIndex(keyKind(ev.key)), false, false, BURST_ALPHA.tick, songMs);
          break;
        case 'spinner-tick': {
          lightSeam(LIT_OK, songMs);
          flashSpan('spinner', ev.index, songMs);
          spawnBurst(kindIndex(keyKind(ev.key)), false, false, BURST_ALPHA.tick, songMs);
          const sp = spans.find((x) => x.kind === 'spinner' && x.index === ev.index);
          if (sp?.label) sp.label.text = ev.remaining > 0 ? String(ev.remaining) : '✓';
          break;
        }
        case 'spinner-end': {
          const sp = spans.find((x) => x.kind === 'spinner' && x.index === ev.index);
          if (sp?.label) sp.label.text = ev.completed ? '✓' : sp.label.text;
          break;
        }
      }
    }
  }

  function press(key: Key, down: boolean): void {
    const i = keyIndex(key);
    if (down) {
      cellPressed[i] = 1;
      lastPressHand[kindIndex(keyKind(key))] = keyHand(key) === 'L' ? HAND_L : HAND_R;
    } else {
      // Decay starts at the release, not at the next frame.
      if (cellPressed[i] === 1) zoneOffAt[i] = now;
      cellPressed[i] = 0;
    }
  }

  function frame(songMs: number, engine: Engine): void {
    now = songMs;
    const notes = chart.notes;
    const first = Math.min(Math.max(engine.firstPending(), 0), notes.length);
    updatePendingCull(engine);

    // Judged notes still travelling (miss) or vanishing (hit).
    const tailMin = songMs - tailMs(engine);
    for (let i = first - 1; i >= 0; i--) {
      const n = notes[i] as Chart['notes'][number];
      if (n.t < tailMin) break;
      placeNote(i, engine, songMs);
    }
    // Pending notes up to the spawn edge.
    const farMax = songMs + farMs;
    for (let i = first; i < notes.length; i++) {
      const n = notes[i] as Chart['notes'][number];
      if (n.t > farMax) break;
      placeNote(i, engine, songMs);
    }
    hideUnused(donPool as RegularPool);
    hideUnused(katPool as RegularPool);
    hideUnused(bigDonPool as BigPool);
    hideUnused(bigKatPool as BigPool);

    placeLines(songMs);
    placeSpans(songMs);
    updateBeatPulse(songMs);
    updateSeam(songMs);
    updateGhosts(songMs);
    updateZones(songMs);
    updateBursts(songMs);
    updateJudgement(songMs);
  }

  function setLayout(next: Layout): void {
    layout = next;
    teardownGeometry();
    buildGeometry();
  }

  function setLeadMs(ms: number): void {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    leadMs = ms;
    recomputeScroll();
    sizePools();
    destroySpans();
    buildSpans();
  }

  function destroy(): void {
    teardownGeometry();
    view.destroy({ children: true });
  }

  return { view, setLayout, setLeadMs, frame, apply, press, destroy };
}
