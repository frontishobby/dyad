/**
 * Headless renderer tests. Pixi's scene graph constructs without a GPU or a
 * DOM, so we can drive frame()/apply()/press() against a fake Engine and
 * inspect what the pools make visible. No rendering happens here.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Chart, Engine, EngineEvent, EngineState, InputLogEntry, Key, NoteView } from '../../src/core/types.ts';
import { DARK, MOTION, SHAPE, hexToNumber } from '../../src/design/tokens.ts';
import { computeLayout, localFrame, seamPosition } from '../../src/render/layout.ts';
import { createTrackRenderer } from '../../src/render/track.ts';
import type { Orientation } from '../../src/render/types.ts';

// ─── fixtures ───────────────────────────────────────────────────────────────

function chart(notes: Chart['notes'], timing: Chart['timing'] = [{ t: 0, beatLength: 500, meter: 4 }]): Chart {
  return {
    version: 1,
    meta: { title: 't', artist: 'a', difficulty: 'Oni', bpm: [120, 120], od: 5, hp: 5 },
    timing,
    notes,
    rolls: [],
    spinners: [],
    hash: '0'.repeat(64),
  };
}

class FakeEngine implements Engine {
  readonly config = { windows: { great: 35, ok: 80, miss: 120 }, bigWindowMs: 30 };
  readonly log: InputLogEntry[] = [];
  readonly state: EngineState = {
    score: 0, accuracy: 1, combo: 0, maxCombo: 0, counts: { great: 0, ok: 0, miss: 0 },
    rollTicks: 0, spinnerTicks: 0, judged: 0, total: 0, finished: false,
  };
  views: NoteView[];
  constructor(readonly chart: Chart) {
    this.views = chart.notes.map(() => ({ status: 'pending', judgement: null, awaitingPartner: false, strong: false }));
    this.state.total = chart.notes.length;
  }
  tick(): EngineEvent[] { return []; }
  hit(): EngineEvent[] { return []; }
  noteView(i: number): NoteView { return this.views[i] as NoteView; }
  firstPending(): number {
    const i = this.views.findIndex((v) => v.status === 'pending');
    return i < 0 ? this.views.length : i;
  }
  set(i: number, v: Partial<NoteView>): void { Object.assign(this.views[i] as NoteView, v); }
}

function byLabel(root: Container, label: string): Container {
  const c = root.children.find((ch) => ch.label === label);
  if (!c) throw new Error(`no child ${label}`);
  return c as Container;
}

/** Visible pooled note objects in the note layer (regular Graphics or big Containers). */
function visibleNotes(view: Container): Container[] {
  const world = byLabel(view, 'world');
  const noteLayer = world.children[3] as Container;
  return noteLayer.children.filter((c) => c.visible);
}

function visibleLines(view: Container): Graphics[] {
  const world = byLabel(view, 'world');
  const lineLayer = world.children[1] as Container;
  return lineLayer.children.filter((c) => c.visible) as Graphics[];
}

/** The judgement line's flash overlay (gate layer: line, flash, then the ghosts). */
function seamFlash(view: Container): Graphics {
  const world = byLabel(view, 'world');
  return (world.children[2] as Container).children[1] as Graphics;
}

function hudTexts(view: Container): Text[] {
  const hud = byLabel(view, 'hud');
  const out: Text[] = [];
  for (const layer of hud.children as Container[]) for (const c of layer.children) if (c instanceof Text) out.push(c);
  return out;
}

function make(orientation: Orientation, notes: Chart['notes'], extra: { reducedMotion?: boolean } = {}) {
  const c = chart(notes);
  const engine = new FakeEngine(c);
  const layout = computeLayout(orientation);
  const leadMs = 750;
  const renderer = createTrackRenderer({ chart: c, theme: DARK, layout, leadMs, reducedMotion: extra.reducedMotion ?? false });
  return { c, engine, layout, leadMs, renderer };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('createTrackRenderer', () => {
  it('builds world + hud, with the world transform from the layout', () => {
    for (const o of ['portrait', 'landscape'] as const) {
      const { renderer, layout } = make(o, [{ t: 1000, k: 'd', big: false }]);
      const world = byLabel(renderer.view, 'world');
      const f = localFrame(layout);
      expect(world.x).toBeCloseTo(f.x, 9);
      expect(world.y).toBeCloseTo(f.y, 9);
      expect(world.rotation).toBeCloseTo(f.rotation, 12);
      renderer.destroy();
    }
  });

  it('places a pending note along the progress axis: p = (t − songMs)/leadMs × leadPx', () => {
    const { renderer, engine, layout, leadMs } = make('portrait', [{ t: 1000, k: 'd', big: false }]);
    renderer.frame(250, engine);
    const vis = visibleNotes(renderer.view);
    expect(vis).toHaveLength(1);
    const g = vis[0] as Graphics;
    const p = ((1000 - 250) / leadMs) * layout.leadPx;
    expect(g.y).toBeCloseTo(-p, 9);
    expect(g.x).toBeCloseTo(layout.W / 2, 9);
    expect(g.tint).toBe(hexToNumber(DARK.don));
    // At the seam.
    renderer.frame(1000, engine);
    expect((visibleNotes(renderer.view)[0] as Graphics).y).toBeCloseTo(0, 9);
    // Screen-space check through the world transform: seam y in portrait.
    const world = byLabel(renderer.view, 'world');
    expect(world.y).toBeCloseTo(seamPosition(layout), 9);
    renderer.destroy();
  });

  it('does not draw notes beyond the spawn margin', () => {
    const { renderer, engine } = make('portrait', [{ t: 5000, k: 'k', big: false }]);
    renderer.frame(0, engine);
    expect(visibleNotes(renderer.view)).toHaveLength(0);
    renderer.frame(4300, engine);
    expect(visibleNotes(renderer.view)).toHaveLength(1);
    renderer.destroy();
  });

  it('miss: desaturates, keeps scrolling, hides missTravel × N past the seam', () => {
    const { renderer, engine, layout, leadMs } = make('portrait', [{ t: 1000, k: 'k', big: false }]);
    engine.set(0, { status: 'missed', judgement: 'miss' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'miss', deltaMs: null, key: null, big: false, strong: false }], 1120);
    renderer.frame(1050, engine);
    let vis = visibleNotes(renderer.view);
    expect(vis).toHaveLength(1);
    expect((vis[0] as Graphics).tint).toBe(hexToNumber(DARK.textFaint));
    expect((vis[0] as Graphics).y).toBeCloseTo(((1050 - 1000) / leadMs) * layout.leadPx, 9);
    // Just before the travel limit: still visible. Past it: gone.
    const travelMs = (SHAPE.missTravel * layout.N * leadMs) / layout.leadPx;
    renderer.frame(1000 + travelMs - 1, engine);
    expect(visibleNotes(renderer.view)).toHaveLength(1);
    renderer.frame(1000 + travelMs + 1, engine);
    vis = visibleNotes(renderer.view);
    expect(vis).toHaveLength(0);
    // Miss lights nothing: the line's flash stays off.
    expect(seamFlash(renderer.view).visible).toBe(false);
    renderer.destroy();
  });

  it('great hit: freezes, pushes hitPush × N toward the gate, flashes, vanishes within hitVanish', () => {
    const { renderer, engine, layout } = make('portrait', [{ t: 1000, k: 'd', big: false }]);
    engine.set(0, { status: 'hit', judgement: 'great' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'great', deltaMs: 0, key: 'DL', big: false, strong: false }], 1000);
    renderer.frame(1000 + MOTION.hitVanish / 2, engine);
    const vis = visibleNotes(renderer.view);
    expect(vis).toHaveLength(1);
    const g = vis[0] as Graphics;
    expect(g.tint).toBe(hexToNumber(DARK.flash));
    expect(g.alpha).toBeCloseTo(0.5, 9);
    // Pushed toward the gate (past the seam = +y local) by half the push.
    expect(g.y).toBeCloseTo(SHAPE.hitPush * layout.N * 0.5, 9);
    renderer.frame(1000 + MOTION.hitVanish, engine);
    expect(visibleNotes(renderer.view)).toHaveLength(0);
    // The line flashed white for the Great (still decaying at hitVanish < cellDecay).
    const flash = seamFlash(renderer.view);
    expect(flash.visible).toBe(true);
    expect(flash.tint).toBe(hexToNumber(DARK.flash));
    renderer.destroy();
  });

  it('ok hit keeps the type colour; reducedMotion hides instantly with no push', () => {
    const { renderer, engine } = make('landscape', [{ t: 1000, k: 'k', big: false }]);
    engine.set(0, { status: 'hit', judgement: 'ok' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'ok', deltaMs: 50, key: 'KR', big: false, strong: false }], 1050);
    renderer.frame(1060, engine);
    const g = visibleNotes(renderer.view)[0] as Graphics;
    expect(g.tint).toBe(hexToNumber(DARK.kat));
    renderer.destroy();

    const rm = make('landscape', [{ t: 1000, k: 'k', big: false }], { reducedMotion: true });
    rm.engine.set(0, { status: 'hit', judgement: 'ok' });
    rm.renderer.apply([{ type: 'note', index: 0, judgement: 'ok', deltaMs: 50, key: 'KR', big: false, strong: false }], 1050);
    rm.renderer.frame(1051, rm.engine);
    expect(visibleNotes(rm.renderer.view)).toHaveLength(0);
    rm.renderer.destroy();
  });

  it('big note awaiting its partner dims the landed half, then vanishes on strong', () => {
    const { renderer, engine } = make('portrait', [{ t: 1000, k: 'd', big: true }]);
    renderer.frame(500, engine);
    let vis = visibleNotes(renderer.view);
    expect(vis).toHaveLength(1);
    const big = vis[0] as Container;
    expect(big.children).toHaveLength(3); // left, right, seam
    expect((big.children[0] as Graphics).alpha).toBe(1);
    expect((big.children[1] as Graphics).alpha).toBe(1);

    engine.set(0, { status: 'hit', judgement: 'great', awaitingPartner: true });
    renderer.apply([{ type: 'note', index: 0, judgement: 'great', deltaMs: 0, key: 'DR', big: true, strong: false }], 1000);
    renderer.frame(1010, engine);
    vis = visibleNotes(renderer.view);
    expect(vis).toHaveLength(1);
    const left = vis[0]!.children[0] as Graphics;
    const right = vis[0]!.children[1] as Graphics;
    expect(left.alpha).toBe(1);
    expect(right.alpha).toBeLessThan(1);
    // Still scrolling (not frozen) while awaiting.
    expect(vis[0]!.y).toBeGreaterThan(0);

    engine.set(0, { awaitingPartner: false, strong: true });
    renderer.apply([{ type: 'note', index: 0, judgement: 'great', deltaMs: 0, key: 'DR', big: true, strong: true }], 1020);
    renderer.frame(1020 + MOTION.hitVanish + 1, engine);
    expect(visibleNotes(renderer.view)).toHaveLength(0);
    // The strong hit lit the line like any Great.
    expect(seamFlash(renderer.view).visible).toBe(true);
    renderer.destroy();
  });

  it('big note awaiting its partner (no event yet): landed hand inferred from the last press of that type', () => {
    const { renderer, engine } = make('portrait', [{ t: 1000, k: 'k', big: true }]);
    renderer.frame(900, engine);
    renderer.press('KL', true);
    engine.set(0, { awaitingPartner: true }); // still pending, no event
    renderer.frame(1000, engine);
    const big = visibleNotes(renderer.view)[0] as Container;
    expect((big.children[0] as Graphics).alpha).toBeLessThan(1);
    expect((big.children[1] as Graphics).alpha).toBe(1);
    renderer.destroy();
  });

  it('a hit resolved without an event (partner window expired) still vanishes', () => {
    const { renderer, engine } = make('portrait', [{ t: 1000, k: 'd', big: true }]);
    engine.set(0, { status: 'hit', judgement: 'ok', awaitingPartner: true });
    renderer.frame(1000, engine);
    expect(visibleNotes(renderer.view)).toHaveLength(1);
    engine.set(0, { awaitingPartner: false });
    renderer.frame(1040, engine); // resolution detected here
    expect(visibleNotes(renderer.view)).toHaveLength(1);
    renderer.frame(1040 + MOTION.hitVanish + 1, engine);
    expect(visibleNotes(renderer.view)).toHaveLength(0);
    renderer.destroy();
  });

  it.each(['portrait', 'landscape'] as const)('%s: no gate cells, a judgement line that flashes on a hit, pressed shapes on it', (orientation) => {
    const { renderer, engine, layout } = make(orientation, [{ t: 1000, k: 'd', big: false }]);
    expect(hudTexts(renderer.view).map((t) => t.text).sort()).toEqual(['Great', 'Miss', 'OK']);
    const world = byLabel(renderer.view, 'world');
    const gateLayer = world.children[2] as Container;
    expect(gateLayer.children).toHaveLength(8); // line, flash, then per type: regular ghost + two big halves
    const [line, flash, donGhost, donL, donR, katGhost] = gateLayer.children as [Graphics, Graphics, Graphics, Graphics, Graphics, Graphics, Graphics, Graphics];
    renderer.frame(500, engine);
    expect(line.visible).toBe(true);
    expect(flash.visible).toBe(false);
    expect(donGhost.visible).toBe(false);
    // One hand: the regular don shape, centred on the seam, at 40%; no flash.
    renderer.press('DL', true);
    renderer.frame(510, engine);
    expect(flash.visible).toBe(false);
    expect(donGhost.visible).toBe(true);
    expect(donGhost.alpha).toBeCloseTo(0.4, 9);
    expect(donGhost.tint).toBe(hexToNumber(DARK.don));
    expect(donGhost.x).toBeCloseTo(layout.W / 2, 9);
    expect(donL.visible).toBe(false);
    expect(katGhost.visible).toBe(false);
    // Both hands: the big shape instead.
    renderer.press('DR', true);
    renderer.frame(520, engine);
    expect(donGhost.visible).toBe(false);
    expect(donL.visible).toBe(true);
    expect(donR.visible).toBe(true);
    renderer.press('DR', false);
    renderer.frame(530, engine);
    expect(donL.visible).toBe(false);
    expect(donGhost.visible).toBe(true);
    renderer.press('DL', false);
    renderer.frame(530 + MOTION.cellDecay / 2, engine);
    expect(donGhost.alpha).toBeLessThan(0.4);
    expect(donGhost.alpha).toBeGreaterThan(0);
    renderer.frame(530 + MOTION.cellDecay + 1, engine);
    expect(donGhost.visible).toBe(false);
    // A Great flashes the line white and decays.
    engine.set(0, { status: 'hit', judgement: 'great' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'great', deltaMs: 0, key: 'DL', big: false, strong: false }], 1000);
    renderer.frame(1000, engine);
    expect(flash.visible).toBe(true);
    expect(flash.alpha).toBeCloseTo(1, 9);
    expect(flash.tint).toBe(hexToNumber(DARK.flash));
    renderer.frame(1000 + MOTION.cellDecay / 2, engine);
    expect(flash.alpha).toBeCloseTo(0.5, 9);
    renderer.frame(1000 + MOTION.cellDecay + 1, engine);
    expect(flash.visible).toBe(false);
    renderer.destroy();
  });

  it('judgement word shows for ~400 ms, one at a time', () => {
    const { renderer, engine } = make('portrait', [{ t: 1000, k: 'd', big: false }]);
    const texts = hudTexts(renderer.view);
    expect(texts.map((t) => t.text).sort()).toEqual(['Great', 'Miss', 'OK']);
    const words = texts.filter((t) => ['Great', 'OK', 'Miss'].includes(t.text));
    renderer.frame(500, engine);
    expect(words.every((t) => !t.visible)).toBe(true);
    engine.set(0, { status: 'hit', judgement: 'ok' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'ok', deltaMs: 40, key: 'DR', big: false, strong: false }], 1040);
    renderer.frame(1041, engine);
    expect(words.filter((t) => t.visible).map((t) => t.text)).toEqual(['OK']);
    renderer.frame(1040 + 399, engine);
    expect(words.filter((t) => t.visible)).toHaveLength(1);
    renderer.frame(1040 + 401, engine);
    expect(words.filter((t) => t.visible)).toHaveLength(0);
    renderer.destroy();
  });

  it('hit burst: the note outline grows from the seam and fades over MOTION.burst; Great starts white', () => {
    const { renderer, engine, layout } = make('landscape', [{ t: 1000, k: 'k', big: false }, { t: 2000, k: 'd', big: true }]);
    const world = byLabel(renderer.view, 'world');
    const burstLayer = world.children[4] as Container;
    const bursts = burstLayer.children as Graphics[];
    expect(bursts.length).toBeGreaterThan(0);
    renderer.frame(500, engine);
    expect(bursts.every((b) => !b.visible)).toBe(true);

    engine.set(0, { status: 'hit', judgement: 'great' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'great', deltaMs: 0, key: 'KL', big: false, strong: false }], 1000);
    renderer.frame(1000, engine);
    const b = bursts.filter((x) => x.visible);
    expect(b).toHaveLength(1);
    const burst = b[0] as Graphics;
    expect(burst.x).toBeCloseTo(layout.W / 2, 9);
    expect(burst.y).toBeCloseTo(0, 9);
    expect(burst.scale.x).toBeCloseTo(1, 9);
    expect(burst.alpha).toBeCloseTo(1, 9);
    expect(burst.tint).toBe(hexToNumber(DARK.flash));
    renderer.frame(1000 + MOTION.burst / 2, engine);
    expect(burst.scale.x).toBeGreaterThan(1);
    expect(burst.alpha).toBeCloseTo(0.5, 9);
    expect(burst.tint).toBe(hexToNumber(DARK.kat));
    renderer.frame(1000 + MOTION.burst, engine);
    expect(burst.visible).toBe(false);

    // A strong big hit bursts the big outline (a different context) in the type colour, no white.
    engine.set(1, { status: 'hit', judgement: 'ok', strong: true });
    renderer.apply([{ type: 'note', index: 1, judgement: 'ok', deltaMs: 10, key: 'DR', big: true, strong: true }], 2010);
    renderer.frame(2010, engine);
    const big = bursts.filter((x) => x.visible);
    expect(big).toHaveLength(1);
    expect((big[0] as Graphics).context).not.toBe(burst.context);
    expect((big[0] as Graphics).tint).toBe(hexToNumber(DARK.don));
    expect((big[0] as Graphics).alpha).toBeCloseTo(0.7, 9);

    // A Miss bursts nothing.
    const missed = make('landscape', [{ t: 1000, k: 'd', big: false }]);
    missed.engine.set(0, { status: 'missed', judgement: 'miss' });
    missed.renderer.apply([{ type: 'note', index: 0, judgement: 'miss', deltaMs: null, key: null, big: false, strong: false }], 1200);
    missed.renderer.frame(1200, missed.engine);
    const mWorld = byLabel(missed.renderer.view, 'world');
    expect((mWorld.children[4] as Container).children.every((x) => !x.visible)).toBe(true);
    missed.renderer.destroy();

    // Reduced motion: no burst at all.
    const rm = make('landscape', [{ t: 1000, k: 'k', big: false }], { reducedMotion: true });
    rm.engine.set(0, { status: 'hit', judgement: 'great' });
    rm.renderer.apply([{ type: 'note', index: 0, judgement: 'great', deltaMs: 0, key: 'KL', big: false, strong: false }], 1000);
    rm.renderer.frame(1000, rm.engine);
    expect((byLabel(rm.renderer.view, 'world').children[4] as Container).children.every((x) => !x.visible)).toBe(true);
    rm.renderer.destroy();
    renderer.destroy();
  });

  it('hit note pops to 1.2× while it vanishes', () => {
    const { renderer, engine } = make('landscape', [{ t: 1000, k: 'd', big: false }]);
    engine.set(0, { status: 'hit', judgement: 'ok' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'ok', deltaMs: 0, key: 'DL', big: false, strong: false }], 1000);
    renderer.frame(1000, engine);
    expect((visibleNotes(renderer.view)[0] as Graphics).scale.x).toBeCloseTo(1, 9);
    renderer.frame(1000 + MOTION.hitVanish / 2, engine);
    expect((visibleNotes(renderer.view)[0] as Graphics).scale.x).toBeCloseTo(1.1, 9);
    renderer.destroy();
  });

  it('judgement word pops in and drifts: Great overshoots and rises, Miss sinks; static under reduced motion', () => {
    const { renderer, engine, layout } = make('landscape', [{ t: 1000, k: 'd', big: false }, { t: 2000, k: 'd', big: false }]);
    const words = hudTexts(renderer.view);
    const great = words.find((t) => t.text === 'Great') as Text;
    const miss = words.find((t) => t.text === 'Miss') as Text;
    const baseY = layout.track.y - 40;
    engine.set(0, { status: 'hit', judgement: 'great' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'great', deltaMs: 0, key: 'DL', big: false, strong: false }], 1000);
    renderer.frame(1000, engine);
    expect(great.visible).toBe(true);
    expect(great.scale.x).toBeCloseTo(1.35, 9);
    expect(great.alpha).toBeCloseTo(1, 9);
    renderer.frame(1000 + MOTION.judgementPop, engine);
    expect(great.scale.x).toBeCloseTo(1, 9);
    expect(great.y).toBeLessThan(baseY);
    renderer.frame(1000 + 380, engine);
    expect(great.alpha).toBeLessThan(1);
    expect(great.alpha).toBeGreaterThan(0);

    engine.set(1, { status: 'missed', judgement: 'miss' });
    renderer.apply([{ type: 'note', index: 1, judgement: 'miss', deltaMs: null, key: null, big: false, strong: false }], 2200);
    renderer.frame(2200 + 200, engine);
    expect(great.visible).toBe(false);
    expect(miss.visible).toBe(true);
    expect(miss.scale.x).toBeCloseTo(1, 9);
    expect(miss.y).toBeGreaterThan(baseY);
    renderer.destroy();

    const rm = make('landscape', [{ t: 1000, k: 'd', big: false }], { reducedMotion: true });
    const rmGreat = hudTexts(rm.renderer.view).find((t) => t.text === 'Great') as Text;
    rm.engine.set(0, { status: 'hit', judgement: 'great' });
    rm.renderer.apply([{ type: 'note', index: 0, judgement: 'great', deltaMs: 0, key: 'DL', big: false, strong: false }], 1000);
    rm.renderer.frame(1000, rm.engine);
    expect(rmGreat.scale.x).toBeCloseTo(1, 9);
    expect(rmGreat.y).toBeCloseTo(baseY, 9);
    rm.renderer.destroy();
  });

  it('beat pulse: the seam line brightens on each beat (fully on a bar) and the band lifts on a bar, both decaying', () => {
    // 120 BPM, 4/4: beats at 0, 500, 1000, 1500; bars at 0, 2000.
    const { renderer, engine } = make('landscape', [{ t: 5000, k: 'd', big: false }]);
    const world = byLabel(renderer.view, 'world');
    const band = (world.children[0] as Container).children[0] as Graphics;
    const line = (world.children[2] as Container).children[0] as Graphics;
    const dim = hexToNumber(DARK.textDim);
    const text = hexToNumber(DARK.text);
    // On the bar: line fully bright, band lifted.
    renderer.frame(2000, engine);
    expect(line.tint).toBe(text);
    expect(band.tint).not.toBe(hexToNumber(DARK.surface));
    // A plain beat: partway, band untouched.
    renderer.frame(2500, engine);
    expect(line.tint).not.toBe(dim);
    expect(line.tint).not.toBe(text);
    expect(band.tint).toBe(hexToNumber(DARK.surface));
    // Decayed.
    renderer.frame(2500 + MOTION.beatPulse, engine);
    expect(line.tint).toBe(dim);
    renderer.destroy();

    const rm = make('landscape', [{ t: 5000, k: 'd', big: false }], { reducedMotion: true });
    const rmLine = ((byLabel(rm.renderer.view, 'world').children[2] as Container).children[0]) as Graphics;
    rm.renderer.frame(2000, rm.engine);
    expect(rmLine.tint).toBe(dim);
    rm.renderer.destroy();
  });

  it('a Miss dips the landscape seam line for cellDecay', () => {
    const { renderer, engine } = make('landscape', [{ t: 1000, k: 'd', big: false }]);
    const line = (byLabel(renderer.view, 'world').children[2] as Container).children[0] as Graphics;
    renderer.frame(900, engine);
    expect(line.alpha).toBeCloseTo(1, 9);
    engine.set(0, { status: 'missed', judgement: 'miss' });
    renderer.apply([{ type: 'note', index: 0, judgement: 'miss', deltaMs: null, key: null, big: false, strong: false }], 1200);
    renderer.frame(1200, engine);
    expect(line.alpha).toBeCloseTo(0.35, 9);
    renderer.frame(1200 + MOTION.cellDecay, engine);
    expect(line.alpha).toBeCloseTo(1, 9);
    renderer.destroy();
  });

  it('beat and bar lines scroll with time and are culled to the track', () => {
    const { renderer, engine, layout, leadMs } = make('portrait', [{ t: 4000, k: 'd', big: false }]);
    renderer.frame(0, engine);
    const lines = visibleLines(renderer.view);
    // 750 ms lead at 500 ms/beat: beats at 0 and 500 visible (plus nothing behind: track ends before the seam in portrait).
    expect(lines.length).toBe(2);
    const ys = lines.map((l) => l.y).sort((a, b) => a - b);
    expect(ys[1]).toBeCloseTo(0, 9);
    expect(ys[0]).toBeCloseTo(-(500 / leadMs) * layout.leadPx, 9);
    renderer.frame(2000, engine);
    expect(visibleLines(renderer.view).length).toBe(2);
    renderer.destroy();
  });

  it('frame() allocates no new pooled objects once warm', () => {
    const notes: Chart['notes'] = [];
    for (let i = 0; i < 200; i++) notes.push({ t: 500 + i * 100, k: i % 2 ? 'k' : 'd', big: i % 7 === 0 });
    const { renderer, engine } = make('landscape', notes);
    const world = byLabel(renderer.view, 'world');
    const noteLayer = world.children[3] as Container;
    const lineLayer = world.children[1] as Container;
    renderer.frame(0, engine);
    const before = noteLayer.children.length + lineLayer.children.length;
    for (let t = 0; t < 20000; t += 16) renderer.frame(t, engine);
    expect(noteLayer.children.length + lineLayer.children.length).toBe(before);
    renderer.destroy();
  });

  it('draws roll and spinner bodies spanning [t, end], flashes them on ticks, and counts a spinner down', () => {
    const c = chart([{ t: 9000, k: 'd', big: false }]);
    c.rolls.push({ t: 1000, end: 1500, big: false });
    c.spinners.push({ t: 2000, end: 2400, hits: 3 });
    const engine = new FakeEngine(c);
    const layout = computeLayout('portrait');
    const leadMs = 750;
    const renderer = createTrackRenderer({ chart: c, theme: DARK, layout, leadMs, reducedMotion: false });
    const world = byLabel(renderer.view, 'world');
    const noteLayer = world.children[3] as Container; // bg, lines, gate, notes (then the mask)
    // Bodies are inserted at index 0 in chart order, so the spinner ends up first.
    const [spinnerBody, rollBody] = noteLayer.children.slice(0, 2) as [Graphics, Graphics];

    renderer.frame(0, engine); // both still beyond the spawn edge
    expect(rollBody.visible).toBe(false);
    expect(spinnerBody.visible).toBe(false);

    renderer.frame(800, engine); // roll starts 200 ms ahead: on screen, its near end at p = 200/750 × leadPx
    expect(rollBody.visible).toBe(true);
    expect(rollBody.y).toBeCloseTo(-(200 / leadMs) * layout.leadPx, 9);
    expect(rollBody.tint).toBe(hexToNumber(DARK.raised));

    renderer.apply([{ type: 'roll-tick', index: 0, key: 'DL' }], 1100);
    renderer.frame(1100, engine);
    expect(rollBody.tint).toBe(hexToNumber(DARK.textDim));
    renderer.frame(1100 + MOTION.cellDecay + 1, engine);
    expect(rollBody.tint).toBe(hexToNumber(DARK.raised));

    const label = hudTexts(renderer.view).find((t) => t.text === '3');
    expect(label).toBeDefined();
    renderer.apply([{ type: 'spinner-tick', index: 0, key: 'KL', remaining: 2 }], 2100);
    expect(label!.text).toBe('2');
    renderer.apply([{ type: 'spinner-tick', index: 0, key: 'DL', remaining: 0 }], 2200);
    expect(label!.text).toBe('✓');
    renderer.frame(2200, engine);
    expect(spinnerBody.visible).toBe(true);
    expect(label!.visible).toBe(true);

    renderer.frame(4000, engine); // long gone
    expect(rollBody.visible).toBe(false);
    expect(spinnerBody.visible).toBe(false);
    renderer.destroy();
  });

  it('setLayout rebuilds geometry for the other orientation; setLeadMs rescales', () => {
    const { renderer, engine, leadMs } = make('portrait', [{ t: 1000, k: 'k', big: true }]);
    renderer.frame(500, engine);
    const L = computeLayout('landscape');
    renderer.setLayout(L);
    const world = byLabel(renderer.view, 'world');
    expect(world.rotation).toBeCloseTo(Math.PI / 2, 12);
    renderer.frame(500, engine);
    const big = visibleNotes(renderer.view)[0] as Container;
    expect(big.y).toBeCloseTo(-((1000 - 500) / leadMs) * L.leadPx, 9);
    expect(big.x).toBeCloseTo(L.W / 2, 9);
    renderer.setLeadMs(leadMs * 2);
    renderer.frame(500, engine);
    expect((visibleNotes(renderer.view)[0] as Container).y).toBeCloseTo(-((1000 - 500) / (leadMs * 2)) * L.leadPx, 9);
    renderer.destroy();
  });
});
