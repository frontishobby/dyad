<script module lang="ts">
  /** Selection survives play → result → back here (module scope outlives the component). */
  let lastHash: string | null = null;
</script>

<script lang="ts">
  /**
   * Song select (DESIGN §4): a carousel. One jacket in the centre, neighbours
   * scaled down to the sides, a spring between slots. Below it the title,
   * BPM and length, the EASY / NORMAL / HARD tiles and the best record.
   *
   * Browsing: ← → (songs), ↑ ↓ (tier), Enter (play), wheel, and on touch a
   * horizontal swipe. Tapping a side jacket moves to it; the centre one plays.
   */
  import { onMount } from 'svelte';
  import { Spring } from 'svelte/motion';
  import { backend } from '../app/backend.ts';
  import {
    createWheelStepper,
    jacketSize as jacketSizeFor,
    nearestChart,
    place,
    shortest,
    stepIndex,
    stepTier,
    swipeDirection,
  } from '../app/carousel.ts';
  import { clearBadge, formatBpm, formatDuration } from '../app/format.ts';
  import { screen } from '../app/screen.svelte.ts';
  import { loadSongIndex, songUrl } from '../app/songs.ts';
  import { TIERS, type SongChartRef, type SongMeta, type Tier } from '../app/types.ts';
  import type { PlayResult } from '../core/types.ts';
  import Button from './components/Button.svelte';
  import Jacket from './components/Jacket.svelte';
  import Score from './components/Score.svelte';
  import TierTile from './components/TierTile.svelte';

  type Status = 'loading' | 'ready' | 'error';

  let status = $state<Status>('loading');
  let songs = $state.raw<SongMeta[]>([]);
  /** chartHash → best record (null when none). Filled after the index. */
  let bests = $state.raw<Record<string, PlayResult | null>>({});

  let index = $state(0);
  /** The player's tier preference; each song lands on its nearest available chart. */
  let tier = $state<Tier>('normal');

  let viewportW = $state(typeof window === 'undefined' ? 1280 : window.innerWidth);
  const finePointer = $derived(typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Continuous carousel position in slots; `index` is the integer it settles on. */
  const pos = new Spring(0, { stiffness: 0.12, damping: 0.75, precision: 0.001 });

  const song = $derived(songs[index]);
  const chart = $derived(song ? nearestChart(song.charts, tier) : null);
  const best = $derived(chart ? (bests[chart.hash] ?? null) : null);
  const jacketPx = $derived(jacketSizeFor(viewportW));
  const ratio = $derived(jacketPx / 340);
  /** How far the spring still has to travel, in slots. */
  const slide = $derived(pos.target - pos.current);

  function restoreSelection(list: readonly SongMeta[]): void {
    for (let si = 0; si < list.length; si++) {
      const found = list[si]?.charts.find((c) => c.hash === lastHash);
      if (found) {
        index = si;
        tier = found.tier;
        pos.set(si, { instant: true });
        return;
      }
    }
    index = 0;
    pos.set(0, { instant: true });
  }

  async function loadBests(list: readonly SongMeta[]): Promise<void> {
    const entries = await Promise.all(
      list.flatMap((s) => s.charts.map(async (c) => [c.hash, await backend.getBest(c.hash)] as const)),
    );
    bests = Object.fromEntries(entries);
  }

  async function load(): Promise<void> {
    status = 'loading';
    try {
      const idx = await loadSongIndex();
      const list = idx.songs.filter((s) => s.charts.length > 0);
      songs = list;
      restoreSelection(list);
      status = 'ready';
      await loadBests(list);
    } catch (err) {
      console.error('dyad: song index failed', err);
      status = 'error';
    }
  }

  onMount(() => {
    void load();
  });

  // ─── browsing ────────────────────────────────────────────────────────────

  function move(delta: number): void {
    if (songs.length === 0) return;
    const next = stepIndex(index, delta, songs.length);
    const travelled = shortest(next - index, songs.length);
    index = next;
    void pos.set(pos.target + travelled, { instant: reducedMotion });
  }

  function jumpTo(target: number): void {
    move(shortest(target - index, songs.length));
  }

  function changeTier(delta: number): void {
    if (!song) return;
    const next = stepTier(song.charts, chart, delta);
    if (next) tier = next.tier;
  }

  function play(): void {
    if (!song || !chart) return;
    lastHash = chart.hash;
    screen.go({ name: 'play', song, chart });
  }

  function isEditable(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function onKeydown(e: KeyboardEvent): void {
    if (status !== 'ready' || e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
    switch (e.key) {
      case 'ArrowRight':
        move(1);
        break;
      case 'ArrowLeft':
        move(-1);
        break;
      case 'ArrowUp':
        changeTier(1);
        break;
      case 'ArrowDown':
        changeTier(-1);
        break;
      case 'Enter':
        // A focused button already handles Enter as a click.
        if (e.target instanceof HTMLButtonElement) return;
        play();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  const wheelStep = createWheelStepper((dir) => move(dir));

  /** The page must not scroll under the carousel, so the listener cannot be passive. */
  function browseOnWheel(node: HTMLElement): { destroy(): void } {
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      wheelStep(e.deltaX, e.deltaY);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', onWheel) };
  }

  // Swipe: one slot per horizontal drag past the threshold. A swipe that ends
  // on a jacket also fires its click, so the click is swallowed once.
  let dragStartX: number | null = null;
  let dragPointer: number | null = null;
  let swallowClick = false;

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragStartX = e.clientX;
    dragPointer = e.pointerId;
    swallowClick = false;
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragPointer !== e.pointerId || dragStartX === null) return;
    const dir = swipeDirection(e.clientX - dragStartX);
    dragStartX = null;
    dragPointer = null;
    if (dir !== 0) {
      swallowClick = true;
      move(dir);
    }
  }

  function onPointerCancel(): void {
    dragStartX = null;
    dragPointer = null;
  }

  function onJacketClick(i: number): void {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (i === index) play();
    else jumpTo(i);
  }

  function tileFor(t: Tier): SongChartRef | undefined {
    return song?.charts.find((c) => c.tier === t);
  }
</script>

<svelte:window onkeydown={onKeydown} bind:innerWidth={viewportW} />

<main class="screen select">
  <header class="head">
    <h1 class="wordmark">DYAD</h1>
    {#if status === 'ready' && songs.length > 0}
      <span class="count dim caption" aria-live="polite">{index + 1} / {songs.length}</span>
    {/if}
    <Button id="title-settings" onclick={() => screen.go({ name: 'settings' })}>설정</Button>
  </header>

  {#if status === 'loading'}
    <p class="dim state" aria-live="polite">곡 목록을 불러오는 중…</p>
  {:else if status === 'error'}
    <div class="state" role="alert">
      <p>곡 목록을 불러오지 못했습니다.</p>
      <p class="dim">연결을 확인한 뒤 다시 시도해 주세요.</p>
      <div><Button id="title-retry" variant="primary" onclick={load}>다시 시도</Button></div>
    </div>
  {:else if songs.length === 0}
    <p class="dim state">아직 곡이 없습니다.</p>
  {:else if song && chart}
    <div
      class="carousel"
      style:height="{jacketPx}px"
      use:browseOnWheel
      onpointerdown={onPointerDown}
      onpointerup={onPointerUp}
      onpointercancel={onPointerCancel}
      role="listbox"
      aria-label="곡"
      tabindex="-1"
    >
      {#each songs as entry, i (entry.id)}
        {@const p = place(shortest(i - index, songs.length) + slide, ratio)}
        <button
          type="button"
          class="jacket"
          class:active={i === index}
          style:width="{jacketPx}px"
          style:height="{jacketPx}px"
          style:transform="translate(-50%, -50%) translateX({p.x}px) scale({p.scale})"
          style:opacity={p.opacity}
          style:z-index={p.z}
          style:pointer-events={p.opacity < 0.2 ? 'none' : 'auto'}
          tabindex={Math.abs(shortest(i - index, songs.length)) > 2 ? -1 : 0}
          role="option"
          aria-selected={i === index}
          aria-label={i === index ? `${entry.title} 시작` : `${entry.title} 선택`}
          onclick={() => onJacketClick(i)}
        >
          <Jacket src={songUrl(entry, entry.jacket)} alt="" fill />
        </button>
      {/each}
    </div>

    {#key song.id}
      <div class="titles swap" aria-live="polite">
        <h2 class="song-title">{song.title}</h2>
        {#if song.artist}<p class="dim">{song.artist}</p>{/if}
      </div>
    {/key}

    <div class="band swap">
      <dl class="facts">
        <div>
          <dt class="dim caption">BPM</dt>
          <dd class="num">{formatBpm(chart.bpm)}</dd>
        </div>
        <div>
          <dt class="dim caption">길이</dt>
          <dd class="num">{formatDuration(song.durationMs)}</dd>
        </div>
      </dl>

      <div class="tiers-column">
        <div class="tiers" role="group" aria-label="난이도">
          {#each TIERS as t (t)}
            {@const available = tileFor(t)}
            <TierTile
              tier={t}
              level={available?.level ?? null}
              on={available !== undefined && available.hash === chart.hash}
              absent={available === undefined}
              onclick={available ? () => (tier = t) : undefined}
            />
          {/each}
        </div>
        <p class="dim caption notes num">{chart.notes} notes</p>
      </div>

      <div class="record">
        <span class="dim caption">{best ? '최고 기록' : '기록 없음'}</span>
        <div class="record-line">
          <Score value={best?.score ?? null} size="combo" />
          {#if best}
            {@const badge = clearBadge(best.counts)}
            {#if badge}
              <span class="badge" class:all-great={badge === 'ALL GREAT'}>{badge}</span>
            {/if}
          {/if}
        </div>
      </div>
    </div>

    <footer class="hints dim caption">
      {#if finePointer}
        <span><kbd>←</kbd><kbd>→</kbd> 곡</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> 난이도</span>
        <span><kbd>Enter</kbd> 시작</span>
      {:else}
        <span>옆으로 넘겨 곡을 고르고, 가운데 자켓을 눌러 시작합니다</span>
      {/if}
    </footer>
  {/if}
</main>

<style>
  .select {
    display: grid;
    grid-template-rows: auto auto auto auto auto;
    align-content: start;
    gap: 16px;
    min-height: 100%;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .wordmark {
    font-size: 28px;
    margin-right: auto;
  }

  .count {
    font-variant-numeric: tabular-nums;
  }

  .state {
    display: grid;
    gap: 8px;
  }

  .state > div {
    margin-top: 8px;
  }

  /* ── carousel ─────────────────────────────────────────────────────────── */

  .carousel {
    position: relative;
    width: 100%;
    /* Clip only sideways: the side jackets run off the edges, but the centre
       jacket's outline and glow must not be cut at the top and bottom. */
    overflow-x: clip;
    overflow-y: visible;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }

  .jacket {
    position: absolute;
    left: 50%;
    top: 50%;
    padding: 0;
    border: 0;
    background: var(--raised);
    border-radius: 12.5%;
    overflow: hidden;
    transform-origin: center;
    will-change: transform, opacity;
    cursor: pointer;
  }

  .jacket:focus-visible {
    outline: 2px solid var(--kat);
    outline-offset: 2px;
  }

  /* Only the centre jacket carries the periwinkle outline (DESIGN §4), and a glow beneath it. */
  .jacket {
    transition: box-shadow 240ms ease-out;
  }

  .jacket.active {
    outline: 2px solid var(--kat);
    outline-offset: 0;
    box-shadow: 0 20px 56px color-mix(in srgb, var(--kat) 30%, transparent);
  }

  /* The text under the carousel swaps with a short rise when the song changes. */
  .swap {
    animation: swap-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  @keyframes swap-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* ── title ────────────────────────────────────────────────────────────── */

  .titles {
    text-align: center;
    display: grid;
    gap: 4px;
  }

  .song-title {
    font-family: var(--font-display, sans-serif);
    font-weight: 700;
    font-size: 40px;
    line-height: 1.1;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }

  @media (max-width: 599px) {
    .song-title {
      font-size: 28px;
    }
  }

  /* ── band: two facts, three tiers, one record ─────────────────────────── */

  /* Three columns with the tiers dead centre: the side columns share the
     leftover width equally, so the middle stays under the jacket whether or
     not a record is shown. */
  .band {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: start;
    column-gap: 40px;
  }

  .facts {
    display: flex;
    gap: 24px;
    justify-self: end;
  }

  @media (max-width: 599px) {
    .band {
      grid-template-columns: 1fr;
      row-gap: 20px;
      justify-items: center;
    }
    .facts,
    .record {
      justify-self: center;
    }
  }

  .facts div {
    display: grid;
    gap: 2px;
    text-align: center;
  }

  .num {
    font-family: var(--font-display, sans-serif);
    font-weight: 500;
    font-size: 20px;
    font-variant-numeric: tabular-nums;
  }

  .tiers-column {
    display: grid;
    justify-items: center;
    gap: 8px;
  }

  .tiers {
    display: flex;
    gap: 12px;
  }

  .notes {
    font-family: var(--font-body, sans-serif);
    font-weight: 500;
  }

  /* Same shape as the facts: caption above, value below, both centred on each other. */
  .record {
    display: grid;
    justify-items: center;
    justify-self: start;
    gap: 2px;
    text-align: center;
  }
  .record :global(.score) {
    min-width: 0;
  }

  .record-line {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  /* Clear badge beside the best score: ALL GREAT bright, NO MISS dim. */
  .badge {
    font-family: var(--font-display, sans-serif);
    font-weight: 500;
    font-size: 14px;
    letter-spacing: 0.02em;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .badge.all-great {
    color: var(--text);
  }

  /* ── footer ───────────────────────────────────────────────────────────── */

  .hints {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 20px;
  }

  .hints span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  kbd {
    display: inline-block;
    min-width: 20px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--raised);
    color: var(--text);
    font-family: var(--font-body, sans-serif);
    font-size: 12px;
    text-align: center;
  }
</style>
