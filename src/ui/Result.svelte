<script lang="ts">
  import { onMount } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { Tween } from 'svelte/motion';
  import { formatAccuracy, formatScore } from '../app/format.ts';
  import { screen } from '../app/screen.svelte.ts';
  import { loadChart, songUrl } from '../app/songs.ts';
  import type { SongChartRef, SongMeta } from '../app/types.ts';
  import { defaultConfig } from '../core/index.ts';
  import { judgementTimeline, type TimelinePoint } from '../core/timeline.ts';
  import type { PlayResult } from '../core/types.ts';
  import { MOTION } from '../design/tokens.ts';
  import Button from './components/Button.svelte';
  import Jacket from './components/Jacket.svelte';
  import Score from './components/Score.svelte';
  import TierTile from './components/TierTile.svelte';
  import { GRAPH_H, GRAPH_W, STRIP_H, STRIP_TOP, accuracyPath, judgementTicks, yAt } from './play/graph.ts';
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

  /**
   * Accuracy over the song: the replay run through the engine again (the
   * same pure function that produced the score), one point per note.
   * null until the chart has loaded; [] when it cannot.
   */
  let timeline = $state.raw<TimelinePoint[] | null>(null);
  const linePath = $derived(timeline ? accuracyPath(timeline, song.durationMs) : '');
  const ticks = $derived(timeline ? judgementTicks(timeline, song.durationMs) : []);
  const gridLines = [1, 0.75, 0.5, 0.25];

  onMount(() => {
    void countUp.set(result.score);
    loadChart(song, chart)
      .then((data) => {
        timeline = judgementTimeline(data, defaultConfig(data.meta.od), result.replay);
      })
      .catch((err: unknown) => {
        console.warn('dyad: result graph unavailable', err);
        timeline = [];
      });
    if (reducedMotion) return;
    const handle = requestAnimationFrame(() => (revealed = true));
    return () => cancelAnimationFrame(handle);
  });

  $effect(() => {
    document.getElementById('result-retry')?.focus();
  });
</script>

<main class="screen result" style:--count-ms="{reducedMotion ? 0 : MOTION.countUp}ms">
  <!-- Wide (the 1280 frame): the jacket fills the left column; title, tier and
       the numbers run down the right; the accuracy graph spans the bottom.
       Narrow (portrait shell): small jacket beside the title, then everything
       stacked. Decided by the screen's own width, not the window's. -->
  <div class="layout">
    <div class="jacket-box">
      <Jacket src={songUrl(song, song.jacket)} alt="" fill />
    </div>

    <header class="meta">
      <TierTile tier={chart.tier} level={chart.level} on compact />
      <div class="names">
        <h1 class="title">{song.title}</h1>
        <p class="dim caption">
          {#if song.artist}{song.artist} · {/if}{chart.name}
        </p>
      </div>
    </header>

    <div class="body">
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
    </div>

    <section class="graph rise" style:--i="4" aria-label="곡 진행에 따른 정확도">
      <div class="graph-head">
        <span class="dim caption">정확도</span>
        <span class="dim caption">곡 진행</span>
      </div>
      <div class="plot" class:ready={timeline !== null && timeline.length > 0}>
        <svg viewBox="0 0 {GRAPH_W} {GRAPH_H}" preserveAspectRatio="none" aria-hidden="true">
          {#each gridLines as g (g)}
            <line class="grid" x1="0" x2={GRAPH_W} y1={yAt(g)} y2={yAt(g)} />
          {/each}
          {#if linePath}
            <polyline class="line" points={linePath} />
          {/if}
          {#each ticks as tick, i (i)}
            <rect class="tick {tick.judgement}" x={tick.x - 1} y={STRIP_TOP} width="2" height={STRIP_H} />
          {/each}
        </svg>
        <span class="axis top">100%</span>
        <span class="axis mid">50%</span>
        {#if timeline === null}
          <span class="dim caption state">불러오는 중…</span>
        {:else if timeline.length === 0}
          <span class="dim caption state">그래프를 만들 수 없습니다</span>
        {/if}
      </div>
    </section>
  </div>
</main>

<style>
  /* The screen measures itself: the 1280 frame is wide, the portrait shell is not.
     A container query only reaches descendants, so the grid lives one level down. */
  .result {
    container-type: inline-size;
  }

  /* Narrow: small jacket beside the title, then the numbers, then the graph. */
  .layout {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    grid-template-areas:
      'jacket meta'
      'body body'
      'graph graph';
    gap: 24px 16px;
    align-content: start;
  }

  .jacket-box {
    grid-area: jacket;
    align-self: start;
  }

  .meta {
    grid-area: meta;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .names {
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

  .body {
    grid-area: body;
    display: grid;
    gap: 24px;
    align-content: start;
    min-width: 0;
  }

  .graph {
    grid-area: graph;
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  /* Wide: jacket left (both rows), title and numbers right, graph across the bottom. */
  @container (min-width: 880px) {
    .layout {
      grid-template-columns: 400px minmax(0, 1fr);
      grid-template-rows: auto 1fr auto;
      grid-template-areas:
        'jacket meta'
        'jacket body'
        'graph graph';
      column-gap: 56px;
      row-gap: 20px;
    }

    .meta {
      gap: 16px;
    }

    .title {
      font-size: 28px;
      line-height: 1.2;
    }

    .body {
      gap: 20px;
    }
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

  /* ── accuracy graph ───────────────────────────────────────────────────── */

  .graph-head {
    display: flex;
    justify-content: space-between;
  }

  .plot {
    position: relative;
    height: 140px;
    background: var(--surface);
    border-radius: 6px;
    overflow: hidden;
  }

  .plot svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .grid {
    stroke: var(--line);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  /* The running accuracy in amber ink, like the accuracy number. */
  .line {
    fill: none;
    stroke: var(--don-ink);
    stroke-width: 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    opacity: 0;
    transition: opacity 400ms ease-out;
  }

  .plot.ready .line {
    opacity: 1;
  }

  .tick.great {
    fill: var(--text);
  }

  .tick.ok {
    fill: var(--text-dim);
  }

  .tick.miss {
    fill: var(--text-faint);
  }

  .axis {
    position: absolute;
    left: 8px;
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1;
    pointer-events: none;
  }

  .axis.top {
    top: 4px;
  }

  /* 50 % sits at half of the line band, which is 76 % of the plot height. */
  .axis.mid {
    top: calc(38% - 6px);
  }

  .state {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
  }
</style>
