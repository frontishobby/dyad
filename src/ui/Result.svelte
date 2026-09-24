<script lang="ts">
  import { onMount } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { Tween } from 'svelte/motion';
  import { formatAccuracy, formatScore } from '../app/format.ts';
  import { screen } from '../app/screen.svelte.ts';
  import { songUrl } from '../app/songs.ts';
  import type { SongChartRef, SongMeta } from '../app/types.ts';
  import type { PlayResult } from '../core/types.ts';
  import { MOTION } from '../design/tokens.ts';
  import Button from './components/Button.svelte';
  import Jacket from './components/Jacket.svelte';
  import Score from './components/Score.svelte';
  import TierTile from './components/TierTile.svelte';
  import { REDUCED_MOTION_QUERY, mediaMatches } from './play/orientation.ts';

  let {
    song,
    chart,
    result,
    best,
    isNewBest,
  }: {
    song: SongMeta;
    chart: SongChartRef;
    result: PlayResult;
    best: PlayResult | null;
    isNewBest: boolean;
  } = $props();

  const reducedMotion = mediaMatches(REDUCED_MOTION_QUERY);

  const total = $derived(result.counts.great + result.counts.ok + result.counts.miss);

  /** Judgement = brightness (DESIGN §1): Great text, OK text-dim, Miss text-faint. */
  const bars = $derived(
    [
      { label: 'Great', count: result.counts.great, tone: 'text' },
      { label: 'OK', count: result.counts.ok, tone: 'dim' },
      { label: 'Miss', count: result.counts.miss, tone: 'faint' },
    ].map((b) => ({ ...b, pct: total > 0 ? (b.count / total) * 100 : 0 })),
  );

  const accuracy = $derived(formatAccuracy(result.accuracy));

  /** The record to compare against, when it is not this very play. */
  const otherBest = $derived(best && best.createdAt !== result.createdAt ? best : null);
  const otherLabel = $derived(isNewBest ? '이전 기록' : '최고 기록');

  /**
   * The reveal (DESIGN §5): the score counts up from 0, the bars grow into
   * place one after another, and the new-best mark lands once the count ends.
   */
  const countUp = new Tween(0, { duration: reducedMotion ? 0 : MOTION.countUp, easing: cubicOut });
  let revealed = $state(reducedMotion);

  onMount(() => {
    void countUp.set(result.score);
    if (reducedMotion) return;
    const handle = requestAnimationFrame(() => (revealed = true));
    return () => cancelAnimationFrame(handle);
  });

  $effect(() => {
    document.getElementById('result-retry')?.focus();
  });
</script>

<main class="screen result" style:--count-ms="{reducedMotion ? 0 : MOTION.countUp}ms">
  <header class="head">
    <Jacket src={songUrl(song, song.jacketSm)} alt="" size={96} />
    <div class="meta">
      <h1 class="title">{song.title}</h1>
      {#if song.artist}<p class="dim caption">{song.artist}</p>{/if}
      <div class="diff">
        <TierTile tier={chart.tier} level={chart.level} on compact />
        <span class="dim caption">{chart.name}</span>
      </div>
    </div>
  </header>

  <section class="score-block" aria-label="점수">
    <div class="score-line">
      <span aria-label="점수 {formatScore(result.score)}">
        <Score value={Math.round(countUp.current)} size="score" />
      </span>
      {#if isNewBest}
        <span class="new-best">신기록</span>
      {/if}
    </div>
    <p class="accuracy display rise" style:--i="1" aria-label="정확도 {accuracy}">{accuracy}</p>
    {#if otherBest}
      <p class="dim caption rise" style:--i="2">{otherLabel} {formatScore(otherBest.score)}</p>
    {/if}
  </section>

  <section class="bars" aria-label="판정 분포">
    {#each bars as bar, i (bar.label)}
      <div class="bar">
        <span class="bar-label {bar.tone}">{bar.label}</span>
        <span class="track">
          <span class="fill {bar.tone}" style:width="{revealed ? bar.pct : 0}%" style:--i={i}></span>
        </span>
        <span class="count {bar.tone}">{bar.count}</span>
      </div>
    {/each}
  </section>

  <dl class="stats">
    <div class="rise" style:--i="3">
      <dt class="dim caption">최대 콤보</dt>
      <dd class="combo">{result.maxCombo}</dd>
    </div>
    <div class="rise" style:--i="4">
      <dt class="dim caption">드럼롤</dt>
      <dd>{result.rollTicks}</dd>
    </div>
    <div class="rise" style:--i="5">
      <dt class="dim caption">스피너</dt>
      <dd>{result.spinnerTicks}</dd>
    </div>
  </dl>

  <footer class="actions rise" style:--i="6">
    <Button id="result-retry" variant="primary" onclick={() => screen.go({ name: 'play', song, chart })}>다시</Button>
    <Button id="result-select" onclick={() => screen.go({ name: 'title' })}>곡 선택</Button>
  </footer>
</main>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .meta {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .title {
    font-size: 20px;
    font-weight: 500;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .diff {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
  }

  .score-block {
    display: grid;
    gap: 12px;
  }

  .score-line {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 16px;
  }

  /* The only place two colours meet (DESIGN §5): accuracy in amber ink, new best in periwinkle ink. */
  .new-best {
    font-family: var(--font-display, sans-serif);
    font-weight: 500;
    font-size: 20px;
    color: var(--kat-ink);
    /* Lands when the count-up ends. */
    animation: pop-in 360ms var(--count-ms) cubic-bezier(0.2, 0.9, 0.3, 1.4) both;
  }

  @keyframes pop-in {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .accuracy {
    font-weight: 500;
    font-size: 28px;
    color: var(--don-ink);
  }

  /* Everything under the score rises in, one row after another. */
  .rise {
    animation: rise-in 360ms calc(120ms + var(--i, 0) * 70ms) cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .bars {
    display: grid;
    gap: 8px;
    max-width: 640px;
  }

  .bar {
    display: grid;
    grid-template-columns: 56px 1fr 5ch;
    align-items: center;
    gap: 12px;
  }

  .bar-label {
    font-family: var(--font-display, sans-serif);
    font-weight: 500;
    font-size: 14px;
  }

  .track {
    display: block;
    height: 8px;
    background: var(--surface);
    border-radius: 1px;
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 1px;
    /* Grows from 0 on mount, Great first. */
    transition: width 700ms calc(200ms + var(--i, 0) * 90ms) cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .count {
    text-align: right;
  }

  .text {
    color: var(--text);
  }

  .fill.text {
    background: var(--text);
  }

  .fill.dim {
    background: var(--text-dim);
  }

  .fill.faint {
    background: var(--text-faint);
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 40px;
  }

  .stats div {
    display: grid;
    gap: 2px;
  }

  dd {
    font-size: 20px;
  }

  .combo {
    font-family: var(--font-display, sans-serif);
    font-weight: 500;
    font-size: 28px;
    line-height: 1.2;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
</style>
