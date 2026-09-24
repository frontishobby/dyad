<script lang="ts">
  /**
   * Play screen — where PLAN §7 and §13 are enforced.
   *
   * - Judgement runs on the audio clock: presses are judged synchronously inside
   *   the DOM event via createPressHandler() (event.timeStamp → SongPlayer.hitMs()).
   * - Rendering runs on requestAnimationFrame via PlayLoop, which only ever
   *   reads player.songMs().
   * - Pause is ctx.suspend()/resume() through the player; the song clock is
   *   never touched.
   * - The orientation is decided once on entry and locked for the whole play.
   */
  import { onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { SongChartRef, SongMeta } from '../app/types.ts';
  import { settings } from '../app/settings.svelte.ts';
  import { screen } from '../app/screen.svelte.ts';
  import { theme } from '../app/theme.svelte.ts';
  import { loadChart, songUrl } from '../app/songs.ts';
  import type { Chart, Engine, EngineEvent, EngineState, PlayResult } from '../core/types.ts';
  import { createEngine, defaultConfig } from '../core/index.ts';
  import type { HitSounds, SongPlayer } from '../audio/types.ts';
  import { createHitSounds, createSongPlayer, resumeAudio } from '../audio/index.ts';
  import type { GamepadSource, InputSource } from '../input/types.ts';
  import { createGamepadSource, createKeyboardSource, createPointerSource } from '../input/index.ts';
  import type { Layout, Orientation, Stage, TrackRenderer } from '../render/types.ts';
  import { computeLayout, createStage, createTrackRenderer, defaultLeadMs, defaultLogical } from '../render/index.ts';
  import { backend } from '../app/backend.ts';
  import { TYPE, playGround, type Theme } from '../design/tokens.ts';
  import { tierLabel } from '../app/format.ts';
  import Hud from './Hud.svelte';
  import ShapeIcon from './components/ShapeIcon.svelte';
  import { computeFill, computeFit, type Fit } from './play/fit.ts';
  import { prettyBindings } from './play/keys.ts';
  import { PlayLoop } from './play/loop.ts';
  import { createSmoothClock } from './play/smooth.ts';
  import {
    REDUCED_MOTION_QUERY,
    decideOrientation,
    lockTypeFor,
    mediaMatches,
    readOrientationSignals,
  } from './play/orientation.ts';
  import { buildAutoSchedule, createAutoPilot } from './play/autopilot.ts';
  import { createPressHandler } from './play/press.ts';
  import { buildPlayResult, isNewBest } from './play/result.ts';

  interface Props {
    song: SongMeta;
    chart: SongChartRef;
    /** Scripted perfect play: nothing is judged from real input and nothing is recorded. */
    auto?: boolean;
  }

  let { song, chart: chartRef, auto = false }: Props = $props();

  type HudInstance = ReturnType<typeof Hud>;

  type Phase =
    | 'loading'
    | 'error'
    /** Loaded and drawn; waiting for a gesture to unlock audio. */
    | 'ready'
    | 'playing'
    | 'paused'
    /** Resume count-in; the context is still suspended so the clock is frozen. */
    | 'countin'
    /** Last effects play out before the result screen. */
    | 'finishing';

  /** Count-in shown before the clock restarts after a pause. */
  const RESUME_COUNT_IN_MS = 1000;
  /** Landscape: the key guide (which key is which) stays this long after the first start. */
  const KEY_GUIDE_MS = 3000;
  /** Silence before the song so the first notes are seen coming (PLAN §7). */
  const LEAD_IN_MS = 3000;
  /** Effects (last hit vanish, cell decay) get this long before leaving. */
  const END_GRACE_MS = 600;
  /** When the audio ends with notes still pending, they are settled with a tick this far ahead. */
  const SETTLE_MS = 10_000;
  /**
   * One frame of input-event latency. The tick clock trails the render clock
   * by inputOffset + this, so a frame can never time out a note that a press
   * already in flight (judged at songMs − inputOffset − latency) is about to
   * hit. See PlayLoop.tickLagMs and the header of src/core/engine.ts.
   */
  const TICK_LAG_FRAME_MS = 16;

  // ─── decided once on entry ──────────────────────────────────────────────

  const orientation: Orientation = (() => {
    const s = readOrientationSignals();
    return decideOrientation(s.portraitMedia, s.coarsePointer);
  })();
  /** Landscape: fixed 1280×720. Portrait: 720 wide, height from the stage once it exists. */
  const logical = defaultLogical(orientation);
  /** HUD line under the title: the tier, plus the chart's own name when it says more. */
  const difficultyText = (() => {
    const label = tierLabel(chartRef.tier);
    const name = chartRef.name.trim();
    const base = name && name.toLowerCase() !== chartRef.tier ? `${label} · ${name}` : label;
    return auto ? `${base} · AUTO` : base;
  })();
  /** Theme is locked for the play (DESIGN §6: no theme switch mid-play). */
  const baseTheme: Theme = theme.value;
  const reducedMotion = mediaMatches(REDUCED_MOTION_QUERY);
  const typeVars =
    `--fs-caption:${TYPE.size.caption}px;--fs-body:${TYPE.size.body}px;--fs-title:${TYPE.size.title}px;` +
    `--fs-combo:${TYPE.size.combo}px;--fs-judgement:${TYPE.size.judgement}px;--fs-score:${TYPE.size.score}px`;
  /** Ground tinted by the jacket (DESIGN §1). Only the ground: notes, gate and text keep the theme's colours. */
  const ground = $derived(playGround(baseTheme, song.palette));
  /**
   * The stage paints its canvas opaque in theme.ground, so the tint travels
   * inside the Theme handed to the stage and the renderer. The letterbox
   * around the box stays `void`.
   */
  const playTheme = $derived<Theme>({ ...baseTheme, ground });
  const jacketUrl = $derived(song.jacket ? songUrl(song, song.jacket) : undefined);

  // ─── reactive view state ────────────────────────────────────────────────

  let phase = $state<Phase>('loading');
  /** Landscape key guide, shown once at the first start and then gone. */
  let keyGuide = $state(false);
  let keyGuideTimer: ReturnType<typeof setTimeout> | undefined;
  const keyNames = prettyBindings(settings.value.bindings);
  let errorMessage = $state('');
  let fit = $state.raw<Fit>({ w: 0, h: 0, scale: 0, x: 0, y: 0 });
  /** Set once the stage exists; mounts the HUD. */
  let view = $state.raw<{ layout: Layout; durationMs: number } | null>(null);

  // ─── collaborators (plain objects on the hot path, never $state) ────────

  let outer: HTMLDivElement;
  let stageHost: HTMLDivElement;
  /** bind:this target; raw so the per-frame read is a plain signal get, no proxy. */
  let hud = $state.raw<HudInstance | undefined>(undefined);

  let chart: Chart | undefined;
  let player: SongPlayer | undefined;
  let hitSounds: HitSounds | undefined;
  let stage: Stage | undefined;
  let renderer: TrackRenderer | undefined;
  let engine: Engine | undefined;
  let loop: PlayLoop | undefined;
  let keyboard: InputSource | undefined;
  let pointer: InputSource | undefined;
  let gamepad: GamepadSource | undefined;
  let unsubEnded: (() => void) | undefined;
  let unsubResize: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let countInTimer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;

  let disposed = false;
  /** True only while presses are judged (PLAN §7). */
  let playing = false;
  let fullscreenRequested = false;
  let orientationLocked = false;

  /** The HUD mounts after the loop is built, so the loop talks to it through this. */
  const hudSink = {
    frame(songMs: number, state: Readonly<EngineState>): void {
      hud?.frame(songMs, state);
    },
    noteEvents(events: readonly EngineEvent[]): void {
      hud?.noteEvents(events);
    },
  };

  // ─── lifecycle ──────────────────────────────────────────────────────────

  onMount(() => {
    measure();
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(outer);
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    void enterImmersive();
    void setup();
    return teardown;
  });

  async function setup(): Promise<void> {
    // The song-select tap is still a fresh activation: unlock the context now.
    void resumeAudio().catch(() => undefined);

    let p: SongPlayer | undefined;
    try {
      p = createSongPlayer();
      const hs = createHitSounds();
      const [loadedChart] = await Promise.all([
        loadChart(song, chartRef),
        p.load([songUrl(song, song.audio)]),
        hs.load(p.ctx),
      ]);
      if (disposed) {
        p.destroy();
        return;
      }
      chart = loadedChart;
      player = p;
      hitSounds = hs;
    } catch (err) {
      p?.destroy();
      if (!disposed) fail(err);
      return;
    }
    hitSounds.setVolume(settings.value.hitSoundVolume);

    try {
      // The stage host must already have its fitted size.
      await tick();
      if (disposed) return;
      const s = await createStage(stageHost, orientation, playTheme);
      if (disposed) {
        s.destroy();
        return;
      }
      stage = s;
    } catch (err) {
      if (!disposed) fail(err);
      return;
    }

    // Portrait: the stage decided the logical height from the viewport; the
    // layout follows it, and again whenever the viewport changes.
    let layout = computeLayout(orientation, stage.logical);
    unsubResize = stage.onResize((next) => {
      if (disposed || !renderer) return;
      layout = computeLayout(orientation, next);
      renderer.setLayout(layout);
      view = { layout, durationMs: player?.durationMs ?? 0 };
      if (!loop?.running) {
        renderer.frame(player?.songMs() ?? 0, engine as Engine);
        stage?.render();
      }
    });

    renderer = createTrackRenderer({
      chart,
      theme: playTheme,
      layout,
      leadMs: defaultLeadMs(orientation, settings.value.hiSpeed),
      reducedMotion,
    });
    stage.stage.addChild(renderer.view);
    engine = createEngine(chart, defaultConfig(chart.meta.od));

    // THE handler: judged synchronously inside the DOM event, never in rAF.
    const handler = createPressHandler({
      player,
      engine,
      renderer,
      hitSounds,
      hud: hudSink,
      inputOffset: () => settings.value.inputOffset,
      // Autoplay: real presses only light the ring; the script does the hitting.
      isPlaying: () => playing && !auto,
    });
    keyboard = createKeyboardSource(settings.value.bindings);
    keyboard.start(handler);
    if (orientation === 'portrait') {
      const st = stage;
      pointer = createPointerSource({
        element: st.canvas,
        toLogical: (x, y) => st.toLogical(x, y),
        zones: () => layout.touchZones ?? {},
      });
      pointer.start(handler);
    }
    gamepad = createGamepadSource();
    gamepad.start(handler);
    // Autoplay stands in the gamepad's slot of the loop: its presses land before each frame's tick.
    const pilot = auto
      ? createAutoPilot(buildAutoSchedule(chart), { engine, renderer, hitSounds, hud: hudSink })
      : null;
    const songPlayer = player;

    unsubEnded = player.onEnded(() => finish('ended'));
    loop = new PlayLoop({
      player,
      gamepad: pilot ? { poll: () => pilot.poll(songPlayer.songMs()) } : gamepad,
      engine,
      renderer,
      hud: hudSink,
      stage,
      onFinished: () => finish('chart'),
      tickLagMs: () => Math.max(0, settings.value.inputOffset + TICK_LAG_FRAME_MS),
      renderClock: createSmoothClock(),
    });

    view = { layout, durationMs: player.durationMs };
    phase = 'ready';
    // First paint before the clock starts: track, gate and the first notes.
    renderer.frame(player.songMs(), engine);
    stage.render();

    if (player.ctx.state === 'running') start();
    // Otherwise the "시작" button (a gesture) resumes the context.
  }

  function fail(err: unknown): void {
    errorMessage = err instanceof Error ? err.message : String(err);
    phase = 'error';
  }

  function teardown(): void {
    disposed = true;
    playing = false;
    cancelCountIn();
    if (graceTimer !== undefined) {
      clearTimeout(graceTimer);
      graceTimer = undefined;
    }
    if (keyGuideTimer !== undefined) {
      clearTimeout(keyGuideTimer);
      keyGuideTimer = undefined;
    }
    loop?.stop();
    safely(() => keyboard?.stop());
    safely(() => pointer?.stop());
    safely(() => gamepad?.stop());
    unsubEnded?.();
    unsubEnded = undefined;
    unsubResize?.();
    unsubResize = undefined;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    safely(() => player?.stop());
    safely(() => player?.destroy());
    safely(() => renderer?.destroy());
    safely(() => stage?.destroy());
    void leaveImmersive();
  }

  function safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.warn('dyad: cleanup step failed', err);
    }
  }

  // ─── fit / immersive ────────────────────────────────────────────────────

  function measure(): void {
    // Layout size, not getBoundingClientRect(): inside the app's scaled
    // 1280×720 frame the visual rect is already scaled, and fitting to it
    // would scale the stage twice.
    const w = outer.clientWidth;
    const h = outer.clientHeight;
    const next = orientation === 'portrait' ? computeFill(w, h, logical.w) : computeFit(w, h, logical.w, logical.h);
    if (next.w !== fit.w || next.h !== fit.h || next.scale !== fit.scale) fit = next;
  }

  function onResize(): void {
    if (disposed) return;
    measure();
    void refit();
  }

  async function refit(): Promise<void> {
    await tick();
    if (disposed || !stage) return;
    stage.fit();
    if (!loop?.running) stage.render();
  }

  async function enterImmersive(): Promise<void> {
    // Landscape plays inside the app's 1280×720 frame; only portrait touch goes fullscreen.
    if (orientation !== 'portrait') return;
    const root = document.documentElement;
    if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
      try {
        await root.requestFullscreen({ navigationUI: 'hide' });
        fullscreenRequested = true;
      } catch {
        // Denied, no activation, or unsupported (iOS Safari): play in the page.
      }
    }
    if (disposed) return;
    const so = window.screen.orientation;
    if (so && typeof so.lock === 'function') {
      try {
        await so.lock(lockTypeFor(orientation));
        orientationLocked = true;
      } catch {
        // Needs fullscreen or unsupported; the orientation decision stays locked in software.
      }
    }
  }

  async function leaveImmersive(): Promise<void> {
    if (orientationLocked) {
      orientationLocked = false;
      try {
        window.screen.orientation.unlock();
      } catch {
        // Nothing to undo.
      }
    }
    if (fullscreenRequested) {
      fullscreenRequested = false;
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          // Already left.
        }
      }
    }
  }

  // ─── play control ───────────────────────────────────────────────────────

  function start(): void {
    if (phase !== 'ready' || !player || !loop) return;
    player.start({ audio: settings.value.audioOffset + song.audioOffset, leadInMs: LEAD_IN_MS });
    playing = true;
    phase = 'playing';
    loop.start();
    if (orientation === 'landscape') {
      keyGuide = true;
      keyGuideTimer = setTimeout(() => {
        keyGuideTimer = undefined;
        keyGuide = false;
      }, KEY_GUIDE_MS);
    }
  }

  async function startFromGesture(): Promise<void> {
    try {
      await resumeAudio();
    } catch {
      // start() below still works; the context resumes when the platform allows.
    }
    if (!disposed) start();
  }

  async function pause(): Promise<void> {
    if (phase === 'countin') {
      cancelCountIn();
      phase = 'paused';
      return;
    }
    if (phase !== 'playing' || !player || !loop) return;
    phase = 'paused';
    playing = false;
    loop.stop();
    try {
      await player.pause();
    } catch {
      // suspend() failed; the loop is stopped and presses are not judged either way.
    }
  }

  function resume(): void {
    if (phase !== 'paused') return;
    phase = 'countin';
    countInTimer = setTimeout(() => {
      countInTimer = undefined;
      void finishCountIn();
    }, RESUME_COUNT_IN_MS);
  }

  async function finishCountIn(): Promise<void> {
    if (!player || !loop) return;
    try {
      await player.resume();
    } catch {
      if (!disposed) phase = 'paused';
      return;
    }
    if (disposed) return;
    if (phase !== 'countin') {
      // Paused again while the context was resuming: freeze the clock back.
      try {
        await player.pause();
      } catch {
        // See pause().
      }
      return;
    }
    if (player.ctx.state !== 'running') {
      // iOS keeps a context "interrupted" until a gesture: back to the pause veil.
      try {
        await player.pause();
      } catch {
        // See pause().
      }
      phase = 'paused';
      return;
    }
    playing = true;
    phase = 'playing';
    loop.start();
  }

  function cancelCountIn(): void {
    if (countInTimer !== undefined) {
      clearTimeout(countInTimer);
      countInTimer = undefined;
    }
  }

  function exit(): void {
    screen.go({ name: 'title' });
  }

  // ─── end of play ────────────────────────────────────────────────────────

  function finish(reason: 'chart' | 'ended'): void {
    if (disposed || phase === 'finishing' || !engine || !player || !renderer) return;
    playing = false;
    if (reason === 'ended' && !engine.state.finished) {
      // The buffer ran out with notes still pending: settle them so the result is final.
      const songMs = player.songMs();
      const events = engine.tick(songMs + SETTLE_MS);
      if (events.length > 0) {
        renderer.apply(events, songMs);
        hudSink.noteEvents(events);
      }
    }
    cancelCountIn();
    phase = 'finishing';
    // The loop keeps drawing during the grace so the last effects play out.
    graceTimer = setTimeout(() => {
      graceTimer = undefined;
      void conclude();
    }, END_GRACE_MS);
  }

  async function conclude(): Promise<void> {
    if (disposed || !engine || !player || !chart) return;
    loop?.stop();
    unsubEnded?.();
    unsubEnded = undefined;
    safely(() => player?.stop());

    const result = buildPlayResult({
      chartHash: chart.hash,
      songId: song.id,
      state: engine.state,
      log: engine.log,
      offsets: { audio: settings.value.audioOffset, input: settings.value.inputOffset },
      createdAt: Date.now(),
    });

    // `best` is the record that stood BEFORE this play (read before submit), so
    // isNewBest() compares against it and Result can show "이전 기록".
    let best: PlayResult | null = null;
    try {
      best = await backend.getBest(chart.hash);
    } catch (err) {
      console.warn('dyad: could not read the best record', err);
    }
    if (!auto) {
      try {
        await backend.submitScore(result);
      } catch (err) {
        console.warn('dyad: could not save the record', err);
      }
    }
    if (disposed) return;
    screen.go({ name: 'result', song, chart: chartRef, result, best, isNewBest: !auto && isNewBest(result, best) });
  }

  // ─── document events ────────────────────────────────────────────────────

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code !== 'Escape' || e.repeat) return;
    e.preventDefault();
    switch (phase) {
      case 'playing':
      case 'countin':
        void pause();
        break;
      case 'paused':
        resume();
        break;
      case 'loading':
      case 'ready':
      case 'error':
        exit();
        break;
      default:
        break;
    }
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden' && (phase === 'playing' || phase === 'countin')) void pause();
  }

  function onFullscreenChange(): void {
    // Browsers swallow the Escape that leaves fullscreen; treat leaving as a pause.
    if (fullscreenRequested && !document.fullscreenElement && (phase === 'playing' || phase === 'countin')) {
      void pause();
    }
  }
</script>

<div class="play" class:portrait={orientation === 'portrait'} style:--play-ground={ground} style={typeVars}>
  <div class="area" bind:this={outer}>
  <div class="box" style:width="{fit.w}px" style:height="{fit.h}px">
    <div class="stage" bind:this={stageHost}></div>
    {#if view}
      <div
        class="logical"
        style:width="{view.layout.logical.w}px"
        style:height="{view.layout.logical.h}px"
        style:transform="scale({fit.scale})"
      >
        <Hud
          bind:this={hud}
          title={song.title}
          difficulty={difficultyText}
          layout={view.layout}
          durationMs={view.durationMs}
          {jacketUrl}
          onpause={orientation === 'portrait' ? () => void pause() : undefined}
        />
        {#if orientation === 'landscape'}
          <div class="key-guide" class:shown={keyGuide} aria-hidden={!keyGuide}>
            <div class="pad">
              <span class="kind"><ShapeIcon kind="k" width={44} /></span>
              <kbd>{keyNames.KL}</kbd>
              <kbd>{keyNames.KR}</kbd>
              <span class="kind"><ShapeIcon kind="d" width={44} /></span>
              <kbd>{keyNames.DL}</kbd>
              <kbd>{keyNames.DR}</kbd>
            </div>
          </div>
        {/if}
        {#if phase === 'ready'}
          <div class="veil" out:fade={{ duration: reducedMotion ? 0 : 220 }}>
            <button class="btn primary" type="button" onclick={() => void startFromGesture()}>시작</button>
          </div>
        {:else if phase === 'paused'}
          <div class="veil" role="dialog" aria-label="일시정지" in:fade={{ duration: reducedMotion ? 0 : 140 }}>
            <h2 class="display">일시정지</h2>
            <div class="actions">
              <button class="btn primary" type="button" onclick={resume}>재개</button>
              <button class="btn" type="button" onclick={exit}>나가기</button>
            </div>
          </div>
        {:else if phase === 'countin'}
          <div class="veil countin" aria-live="polite">
            <div class="display num">1</div>
            <i class="drain" style:--count-in="{RESUME_COUNT_IN_MS}ms"></i>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  </div>

  {#if phase === 'loading'}
    <p class="line">불러오는 중…</p>
  {:else if phase === 'error'}
    <div class="line stack">
      <p>불러오지 못했습니다</p>
      <p class="dim">{errorMessage}</p>
      <button class="btn" type="button" onclick={exit}>돌아가기</button>
    </div>
  {/if}
</div>

<style>
  .play {
    position: fixed;
    inset: 0;
    display: grid;
    /* One definite track, so .area's 100% height resolves and the box centres. */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    background: var(--void);
    color: var(--text);
    font-family: var(--font-body);
    font-size: var(--fs-body);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  /* The measured area: the whole viewport, inside the phone's safe-area insets in portrait. */
  .area {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .play.portrait {
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px)
      env(safe-area-inset-left, 0px);
    box-sizing: border-box;
  }
  .box {
    position: relative;
    background: var(--play-ground);
    overflow: hidden;
  }
  .stage {
    position: absolute;
    inset: 0;
  }
  .stage :global(canvas) {
    display: block;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .logical {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    pointer-events: none;
    z-index: 1;
  }
  /* Landscape key guide: the 2×2 pad with its keys, in the band under the track, gone after a few seconds. */
  .key-guide {
    position: absolute;
    left: 50%;
    top: 150px;
    transform: translateX(-50%);
    opacity: 0;
    transition: opacity 300ms ease;
  }
  .key-guide.shown {
    opacity: 1;
  }
  .pad {
    display: grid;
    grid-template-columns: auto 56px 56px;
    gap: 8px 10px;
    align-items: center;
  }
  .kind {
    display: grid;
    justify-items: end;
    padding-right: 4px;
  }
  .pad kbd {
    display: grid;
    place-items: center;
    height: 40px;
    border-radius: 5px;
    background: var(--raised);
    color: var(--text);
    font: 500 16px var(--font-body);
  }
  .veil {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 32px;
    background: color-mix(in srgb, var(--ground) 82%, transparent);
    pointer-events: auto;
  }
  .display {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 500;
    font-size: var(--fs-combo);
    line-height: 1;
  }
  .num {
    font-size: var(--fs-score);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  .countin {
    gap: 24px;
  }
  .drain {
    display: block;
    width: 160px;
    height: 4px;
    background: var(--kat);
    transform-origin: 0 50%;
    animation: drain var(--count-in) linear forwards;
  }
  @keyframes drain {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .drain {
      animation: none;
      transform: scaleX(1);
    }
  }
  .actions {
    display: flex;
    gap: 16px;
  }
  .btn {
    font: 500 var(--fs-body) var(--font-body);
    padding: 12px 24px;
    border: 0;
    border-radius: 6px;
    background: var(--raised);
    color: var(--text);
    cursor: pointer;
    pointer-events: auto;
    touch-action: manipulation;
  }
  .btn.primary {
    background: var(--don);
    color: var(--on-don);
  }
  .btn:focus-visible {
    outline: 2px solid var(--kat);
    outline-offset: 2px;
  }
  .line {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    margin: 0;
    color: var(--text-dim);
  }
  .stack {
    gap: 16px;
    color: var(--text);
    text-align: center;
    padding: 0 24px;
  }
  .stack p {
    margin: 0;
  }
  .dim {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--fs-caption);
    max-width: 48ch;
    word-break: break-word;
  }
</style>
