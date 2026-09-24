<script lang="ts">
  /**
   * Play HUD (DESIGN §3, §4, §5): a DOM overlay over layout.info, drawn in
   * logical px and scaled by the parent with the stage. The loop writes into
   * its $state through frame() / noteEvents(); nothing here reads the clock.
   */
  import { onDestroy } from 'svelte';
  import type { EngineEvent, EngineState, Judgement } from '../core/types.ts';
  import type { Layout } from '../render/types.ts';
  import { MOTION, TYPE } from '../design/tokens.ts';
  import {
    JUDGEMENT_HOLD_MS,
    crossedMilestone,
    formatScore,
    judgementAnchor,
    judgementTone,
    judgementWord,
    latestJudgement,
    progressRatio,
  } from './play/hud.ts';

  interface Props {
    title: string;
    difficulty: string;
    layout: Layout;
    /** Decoded song length; the progress bar is songMs / durationMs. */
    durationMs: number;
    /** Small jacket (DESIGN §4). Omitted: no image slot. */
    jacketUrl?: string;
    /** When given, a pause button is shown at the top-right (portrait). */
    onpause?: () => void;
    /**
     * Draw the judgement word here. Off by default: the track renderer draws
     * it in Pixi next to the gate, and two words would show.
     */
    showJudgement?: boolean;
  }

  let { title, difficulty, layout, durationMs, jacketUrl, onpause, showJudgement = false }: Props = $props();

  let score = $state(0);
  let combo = $state(0);
  let progress = $state(0);
  /** Bumped on every combo gain; re-keys the combo element so its CSS animation restarts. */
  let pulseKey = $state(0);
  /** The last gain crossed a 50 milestone: the bigger bump (DESIGN §5). */
  let milestone = $state(false);
  let judgement = $state<Judgement | null>(null);
  let jacketFailed = $state(false);

  let judgementTimer: ReturnType<typeof setTimeout> | undefined;

  const portrait = $derived(layout.orientation === 'portrait');
  // The portrait info strip is too narrow for a 64px score beside a title (DESIGN §4 mock uses ~44).
  const scoreSize = $derived(portrait ? TYPE.size.judgement : TYPE.size.score);
  const comboSize = $derived(portrait ? TYPE.size.title : TYPE.size.combo);
  const anchor = $derived(judgementAnchor(layout));
  const scoreText = $derived(formatScore(score));

  /** Called once per animation frame by the play loop. Primitive writes only; unchanged values are skipped. */
  export function frame(songMs: number, state: Readonly<EngineState>): void {
    if (state.score !== score) score = state.score;
    const c = state.combo;
    if (c !== combo) {
      if (c > combo) {
        milestone = crossedMilestone(combo, c);
        pulseKey++;
      }
      combo = c;
    }
    const p = progressRatio(songMs, durationMs);
    if (p !== progress) progress = p;
  }

  /** Called synchronously from the press handler (and for timed-out misses from the loop). */
  export function noteEvents(events: readonly EngineEvent[]): void {
    if (!showJudgement) return;
    const j = latestJudgement(events);
    if (j === null) return;
    judgement = j;
    if (judgementTimer !== undefined) clearTimeout(judgementTimer);
    judgementTimer = setTimeout(() => {
      judgementTimer = undefined;
      judgement = null;
    }, JUDGEMENT_HOLD_MS);
  }

  onDestroy(() => {
    if (judgementTimer !== undefined) clearTimeout(judgementTimer);
  });
</script>

<div
  class="hud"
  class:portrait
  style:left="{layout.info.x}px"
  style:top="{layout.info.y}px"
  style:width="{layout.info.w}px"
  style:height="{layout.info.h}px"
  style:--combo-pulse-ms="{MOTION.comboPulse}ms"
  style:--combo-milestone-ms="{MOTION.comboMilestone}ms"
  style:--fs-title="{TYPE.size.title}px"
  style:--fs-caption="{TYPE.size.caption}px"
  style:--fs-score="{scoreSize}px"
  style:--fs-combo="{comboSize}px"
>
  <div class="row">
    {#if jacketUrl && !jacketFailed}
      <img class="jacket" src={jacketUrl} alt="" decoding="async" onerror={() => (jacketFailed = true)} />
    {/if}
    <div class="titles">
      <div class="title">{title}</div>
      <div class="difficulty">{difficulty}</div>
    </div>
    <div class="numbers">
      <div class="score">{scoreText}</div>
      {#key pulseKey}
        <div class="combo" class:pulse={pulseKey > 0 && !milestone} class:milestone={pulseKey > 0 && milestone}>
          {combo > 0 ? combo : ''}
        </div>
      {/key}
    </div>
    {#if onpause}
      <button class="pause" type="button" aria-label="일시정지" onclick={onpause}>
        <i></i><i></i>
      </button>
    {/if}
  </div>
  <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="1" aria-valuenow={progress}>
    <i style:transform="scaleX({progress})"></i>
  </div>
</div>

{#if showJudgement && judgement}
  <div
    class="judgement {judgementTone(judgement)}"
    style:left="{anchor.x}px"
    style:top="{anchor.y}px"
    style:--fs-judgement="{TYPE.size.judgement}px"
    aria-live="off"
  >
    {judgementWord(judgement)}
  </div>
{/if}

<style>
  .hud {
    position: absolute;
    box-sizing: border-box;
    padding: 20px 32px 0;
    color: var(--text);
    font-family: var(--font-body);
    pointer-events: none;
  }
  .hud.portrait {
    padding-top: 28px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .jacket {
    flex: none;
    width: 96px;
    height: 96px;
    border-radius: 12px; /* 96 / 8 */
    background: var(--raised);
    object-fit: cover;
  }
  /* Portrait: the info strip is 112 px, so the jacket must fit under the 28 px padding and over the progress bar. */
  .hud.portrait .jacket {
    width: 64px;
    height: 64px;
    border-radius: 8px; /* 64 / 8 */
  }
  .hud.portrait .titles {
    padding-top: 4px;
  }
  /* Landscape: the band sits low (DESIGN §4), so the jacket gets the room above it. */
  .hud:not(.portrait) .jacket {
    width: 240px;
    height: 240px;
    border-radius: 30px; /* 240 / 8 */
  }
  .hud:not(.portrait) .titles {
    padding-top: 24px;
  }
  .hud:not(.portrait) .title {
    font-size: 28px;
    white-space: normal;
    overflow-wrap: anywhere;
    line-height: 1.2;
  }
  .hud:not(.portrait) .difficulty {
    margin-top: 6px;
  }
  .titles {
    flex: 1 1 auto;
    min-width: 0;
    padding-top: 14px;
    line-height: 1.3;
  }
  .title {
    font-size: var(--fs-title);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .difficulty {
    font-size: var(--fs-caption);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .numbers {
    flex: none;
    text-align: right;
    font-family: var(--font-display);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: pre;
  }
  .score {
    font-size: var(--fs-score);
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .combo {
    margin-top: 6px;
    min-height: var(--fs-combo);
    font-size: var(--fs-combo);
    font-weight: 500;
    color: var(--text-dim);
  }
  /* Every gain bumps the number a little; a 50 milestone bumps it big and bright. */
  .combo {
    transform-origin: 100% 50%;
  }
  .combo.pulse {
    animation: combo-bump var(--combo-pulse-ms) cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .combo.milestone {
    animation: combo-milestone var(--combo-milestone-ms) cubic-bezier(0.2, 0.9, 0.3, 1);
  }
  @keyframes combo-bump {
    from {
      transform: scale(1.12);
    }
    to {
      transform: scale(1);
    }
  }
  @keyframes combo-milestone {
    0% {
      transform: scale(1.45);
      color: var(--text);
    }
    60% {
      color: var(--text);
    }
    100% {
      transform: scale(1);
      color: var(--text-dim);
    }
  }
  .progress i {
    transition: transform 120ms linear;
  }
  .pause {
    flex: none;
    width: 44px;
    height: 44px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 6px; /* 44 / 8 */
    background: var(--raised);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    cursor: pointer;
    pointer-events: auto;
    touch-action: manipulation;
  }
  .pause i {
    display: block;
    width: 5px;
    height: 16px;
    border-radius: 1px;
    background: var(--text-dim);
  }
  .pause:focus-visible {
    outline: 2px solid var(--kat);
    outline-offset: 2px;
  }
  .progress {
    position: absolute;
    left: 32px;
    right: 32px;
    bottom: 12px;
    height: 4px;
    background: var(--line);
    overflow: hidden;
  }
  .progress i {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--kat);
    transform-origin: 0 50%;
    transform: scaleX(0);
  }
  .judgement {
    position: absolute;
    transform: translateX(-50%);
    font-family: var(--font-display);
    font-size: var(--fs-judgement);
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
  }
  .judgement.text {
    color: var(--text);
  }
  .judgement.text-dim {
    color: var(--text-dim);
  }
  .judgement.text-faint {
    color: var(--text-faint);
  }
</style>
