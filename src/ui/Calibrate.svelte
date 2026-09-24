<script lang="ts">
  /**
   * Calibration (PLAN §7 "보정"): two offsets, both measured against the audio
   * clock, exactly like play.
   *
   *  1. 화면과 소리 — a 100 BPM metronome scheduled ahead on the audio clock and
   *     a bar that flashes when ctx.currentTime crosses a beat (drawn by rAF).
   *     The slider shifts the visual until flash and click coincide → audioOffset.
   *  2. 입력 — tap any key along with 16 beats. Each tap's event.timeStamp is
   *     converted with getOutputTimestamp() (per-frame pair as fallback);
   *     inputOffset = median(hitMs − nearest beat).
   */
  import { onMount } from 'svelte';
  import { settings } from '../app/settings.svelte.ts';
  import { screen } from '../app/screen.svelte.ts';
  import { createHitSounds, getAudioContext, resumeAudio } from '../audio/index.ts';
  import type { HitSounds } from '../audio/types.ts';
  import { createGamepadSource, createKeyboardSource, createPointerSource } from '../input/index.ts';
  import type { GamepadSource, InputEvent, InputSource } from '../input/types.ts';
  import { TYPE } from '../design/tokens.ts';
  import {
    CALIBRATION_BPM,
    FLASH_MS,
    TAP_TARGET,
    beatPhaseMs,
    createClickSink,
    createMetronome,
    eventContextTime,
    median,
    nearestBeatMs,
    type ClickSink,
    type ClockPair,
    type Metronome,
  } from './play/metronome.ts';

  interface Props {
    returnTo: 'title' | 'settings';
  }

  let { returnTo }: Props = $props();

  const OFFSET_MIN = -200;
  const OFFSET_MAX = 200;
  /** Half-width of the tap scatter axis, ms. */
  const SCATTER_RANGE_MS = 150;
  const METRONOME_VOLUME = 0.8;

  const typeVars =
    `--fs-caption:${TYPE.size.caption}px;--fs-body:${TYPE.size.body}px;--fs-title:${TYPE.size.title}px;` +
    `--fs-combo:${TYPE.size.combo}px;--fs-judgement:${TYPE.size.judgement}px`;

  // ─── reactive state ─────────────────────────────────────────────────────

  let step = $state<1 | 2>(1);
  let running = $state(false);
  let starting = $state(false);
  let audioOffset = $state(clampOffset(settings.value.audioOffset));
  let flashing = $state(false);
  let taps = $state<number[]>([]);
  let tapDown = $state(false);
  let error = $state('');
  let pad = $state<HTMLDivElement | undefined>(undefined);

  const recent = $derived(taps.slice(-TAP_TARGET));
  const inputOffset = $derived(recent.length > 0 ? Math.round(median(recent)) : Number.NaN);
  const canSave = $derived(recent.length >= TAP_TARGET);

  // ─── audio / input collaborators (plain, never $state) ──────────────────

  let ctx: AudioContext | undefined;
  let sink: ClickSink | undefined;
  let metronome: Metronome | undefined;
  let hitSounds: HitSounds | undefined;
  let keyboard: InputSource | undefined;
  let gamepad: GamepadSource | undefined;
  let raf = 0;
  let disposed = false;
  /** Fallback (performance.now(), currentTime) pair, refreshed every frame like SongPlayer.syncClock(). */
  const clock: ClockPair = { performanceTime: 0, contextTime: 0 };

  onMount(() => () => {
    disposed = true;
    if (raf !== 0) cancelAnimationFrame(raf);
    metronome?.stop();
    keyboard?.stop();
    gamepad?.stop();
    sink?.destroy();
  });

  // The tap pad exists only in step 2; the pointer source follows it.
  $effect(() => {
    const el = pad;
    if (step !== 2 || !running || !el) return;
    const source = createPointerSource({
      element: el,
      toLogical: (clientX, clientY) => {
        const r = el.getBoundingClientRect();
        return { x: clientX - r.left, y: clientY - r.top };
      },
      zones: () => ({ DL: { x: 0, y: 0, w: el.clientWidth, h: el.clientHeight } }),
    });
    source.start(onInput);
    return () => source.stop();
  });

  // ─── metronome ──────────────────────────────────────────────────────────

  async function begin(): Promise<void> {
    if (running || starting) return;
    starting = true;
    error = '';
    try {
      await resumeAudio();
      if (disposed) return;
      const c = getAudioContext();
      ctx = c;
      sink = createClickSink(c, METRONOME_VOLUME);
      metronome = createMetronome({ sink, bpm: CALIBRATION_BPM });
      hitSounds = createHitSounds();
      void hitSounds
        .load(c)
        .then(() => hitSounds?.setVolume(settings.value.hitSoundVolume))
        .catch(() => undefined);
      keyboard = createKeyboardSource(settings.value.bindings);
      keyboard.start(onInput);
      gamepad = createGamepadSource();
      gamepad.start(onInput);
      syncClock();
      metronome.start();
      running = true;
      raf = requestAnimationFrame(frame);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      starting = false;
    }
  }

  function syncClock(): void {
    if (!ctx) return;
    clock.performanceTime = performance.now();
    clock.contextTime = ctx.currentTime;
  }

  /** Render only: reads the audio clock and decides whether the bar is lit. */
  function frame(): void {
    raf = 0;
    if (disposed || !metronome || !ctx) return;
    syncClock();
    gamepad?.poll();
    const ms = metronome.msAt(ctx.currentTime) - audioOffset;
    const on = ms >= 0 && beatPhaseMs(ms, metronome.beatMs) < FLASH_MS;
    if (on !== flashing) flashing = on;
    raf = requestAnimationFrame(frame);
  }

  /** Judged synchronously inside the DOM event, like play. */
  function onInput(e: InputEvent): void {
    if (!e.down) {
      tapDown = false;
      return;
    }
    tapDown = true;
    if (step !== 2 || !metronome || !ctx || !metronome.running) return;
    const contextTime = eventContextTime(ctx, e.timeStamp, clock);
    const ms = metronome.msAt(contextTime) - audioOffset;
    if (ms < 0) return;
    const delta = ms - nearestBeatMs(ms, metronome.beatMs);
    taps.push(delta);
    hitSounds?.play('d');
  }

  // ─── navigation ─────────────────────────────────────────────────────────

  function clampOffset(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.round(Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, v)));
  }

  function nudge(delta: number): void {
    audioOffset = clampOffset(audioOffset + delta);
  }

  function next(): void {
    settings.update({ audioOffset: clampOffset(audioOffset) });
    step = 2;
  }

  function resetTaps(): void {
    taps = [];
  }

  function save(): void {
    if (!canSave || !Number.isFinite(inputOffset)) return;
    settings.update({ audioOffset: clampOffset(audioOffset), inputOffset, calibrated: true });
    screen.go({ name: returnTo });
  }

  function skip(): void {
    settings.update({ calibrated: true });
    screen.go({ name: returnTo });
  }

  function formatMs(ms: number): string {
    const sign = ms > 0 ? '+' : ms < 0 ? '−' : '';
    return `${sign}${Math.abs(ms)} ms`;
  }

  /** Position on the scatter axis, 0..100 %. */
  function scatterPct(ms: number): number {
    const clamped = Math.min(SCATTER_RANGE_MS, Math.max(-SCATTER_RANGE_MS, ms));
    return 50 + (clamped / SCATTER_RANGE_MS) * 50;
  }
</script>

<main class="calibrate" style={typeVars}>
  <header>
    <h1 class="display">보정</h1>
    <p class="dim">{step} / 2 · {step === 1 ? '화면과 소리' : '입력'}</p>
  </header>

  <div class="flash" class:on={flashing} aria-hidden="true"></div>

  {#if step === 1}
    <p>
      메트로놈 소리가 날 때 위 막대가 빛나도록 슬라이더를 맞추세요. 빛이 소리보다 먼저면 오른쪽으로, 늦으면
      왼쪽으로.
    </p>
    {#if !running}
      <div class="actions">
        <button class="btn primary" type="button" onclick={() => void begin()} disabled={starting}>시작</button>
        <button class="btn" type="button" onclick={skip}>건너뛰기</button>
      </div>
    {:else}
      <div class="slider">
        <button class="btn small" type="button" onclick={() => nudge(-1)} aria-label="1 ms 줄이기">−</button>
        <input
          type="range"
          min={OFFSET_MIN}
          max={OFFSET_MAX}
          step="1"
          bind:value={audioOffset}
          aria-label="화면 오프셋"
        />
        <button class="btn small" type="button" onclick={() => nudge(1)} aria-label="1 ms 늘리기">+</button>
        <output class="num">{formatMs(audioOffset)}</output>
      </div>
      <div class="actions">
        <button class="btn primary" type="button" onclick={next}>다음</button>
        <button class="btn" type="button" onclick={skip}>건너뛰기</button>
      </div>
    {/if}
  {:else}
    <p>박자에 맞춰 아무 키나 {TAP_TARGET}번 누르세요. 터치는 아래 패드를 두드리세요.</p>
    <div class="pad" class:down={tapDown} bind:this={pad}>
      <span class="faint">여기를 두드리세요</span>
    </div>
    <div class="readout">
      <div>
        <span class="dim">입력</span>
        <span class="num big">{recent.length} / {TAP_TARGET}</span>
      </div>
      <div>
        <span class="dim">입력 오프셋</span>
        <span class="num big">{Number.isNaN(inputOffset) ? '—' : formatMs(inputOffset)}</span>
      </div>
    </div>
    <div class="scatter" aria-hidden="true">
      <i class="zero"></i>
      {#each recent as d, i (i)}
        <i class="dot" style:left="{scatterPct(d)}%"></i>
      {/each}
      {#if !Number.isNaN(inputOffset)}
        <i class="med" style:left="{scatterPct(inputOffset)}%"></i>
      {/if}
    </div>
    <div class="actions">
      <button class="btn primary" type="button" onclick={save} disabled={!canSave}>저장</button>
      <button class="btn" type="button" onclick={resetTaps} disabled={taps.length === 0}>다시</button>
      <button class="btn" type="button" onclick={skip}>건너뛰기</button>
    </div>
  {/if}

  {#if error}
    <p class="dim" role="alert">{error}</p>
  {/if}
</main>

<style>
  .calibrate {
    box-sizing: border-box;
    max-width: 640px;
    min-height: 100%;
    margin: 0 auto;
    padding: 32px 24px 64px;
    display: grid;
    align-content: start;
    gap: 24px;
    font: 400 var(--fs-body) / 1.6 var(--font-body);
    color: var(--text);
    user-select: none;
    -webkit-user-select: none;
  }
  header {
    display: grid;
    gap: 4px;
  }
  .display {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 500;
    font-size: var(--fs-combo);
    line-height: 1;
  }
  p {
    margin: 0;
    max-width: 62ch;
  }
  .dim {
    color: var(--text-dim);
  }
  .faint {
    color: var(--text-faint);
  }
  .flash {
    height: 96px;
    border-radius: 12px; /* 96 / 8 */
    background: var(--raised);
    border: 1px solid var(--line);
  }
  .flash.on {
    background: var(--flash);
    border-color: var(--flash);
  }
  .slider {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 12px;
  }
  input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--kat);
  }
  input[type='range']:focus-visible {
    outline: 2px solid var(--kat);
    outline-offset: 4px;
  }
  .num {
    font-family: var(--font-display);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    min-width: 6ch;
    text-align: right;
  }
  .num.big {
    font-size: var(--fs-combo);
    line-height: 1;
    text-align: left;
  }
  .pad {
    height: 200px;
    border-radius: 25px; /* 200 / 8 */
    background: var(--raised);
    display: grid;
    place-items: center;
    touch-action: none;
    -webkit-touch-callout: none;
    cursor: pointer;
  }
  .pad.down {
    background: color-mix(in srgb, var(--don) 40%, var(--raised));
  }
  .readout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .readout > div {
    display: grid;
    gap: 6px;
    font-size: var(--fs-caption);
  }
  .scatter {
    position: relative;
    height: 24px;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .scatter i {
    position: absolute;
    top: 0;
    bottom: 0;
    display: block;
    transform: translateX(-50%);
  }
  .scatter .zero {
    left: 50%;
    width: 1px;
    background: var(--text-faint);
  }
  .scatter .dot {
    width: 3px;
    background: var(--kat);
    opacity: 0.7;
  }
  .scatter .med {
    width: 3px;
    background: var(--don);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .btn {
    font: 500 var(--fs-body) var(--font-body);
    padding: 12px 20px;
    border: 0;
    border-radius: 6px;
    background: var(--raised);
    color: var(--text);
    cursor: pointer;
    touch-action: manipulation;
  }
  .btn.primary {
    background: var(--don);
    color: var(--on-don);
  }
  .btn.small {
    padding: 8px 14px;
    font-variant-numeric: tabular-nums;
  }
  .btn:disabled {
    color: var(--text-faint);
    background: var(--surface);
    cursor: default;
  }
  .btn.primary:disabled {
    background: var(--raised);
  }
  .btn:focus-visible {
    outline: 2px solid var(--kat);
    outline-offset: 2px;
  }
</style>
