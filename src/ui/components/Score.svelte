<script lang="ts">
  import { formatScore } from '../../app/format.ts';

  /**
   * Score in a fixed-width box, right aligned (DESIGN §3: 7 digits, leading
   * space instead of zeros). null renders blank but keeps the width.
   */
  let {
    value,
    size = 'body',
  }: { value: number | null | undefined; size?: 'caption' | 'body' | 'combo' | 'score' } = $props();

  const text = $derived(value === null || value === undefined ? '' : formatScore(value));
</script>

<span class="score size-{size}">{text || ' '}</span>

<style>
  /* Widest score "1,000,000" measures 4.78em in IBM Plex Sans KR and 6.02em
     in Unbounded (tabular figures); the boxes hold that with a hair to spare. */
  .score {
    display: inline-block;
    min-width: 4.85em;
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: pre;
  }

  .size-caption {
    font-size: 14px;
  }

  .size-combo {
    min-width: 6.1em;
    font-family: var(--font-display, sans-serif);
    font-weight: 500;
    font-size: 28px;
    line-height: 1;
  }

  /* DESIGN §3: score 64 px Unbounded 700. Shrinks on narrow phones so the
     box plus the new-best mark fits a 390 px viewport. */
  .size-score {
    min-width: 6.1em;
    font-family: var(--font-display, sans-serif);
    font-weight: 700;
    font-size: clamp(32px, 11vw, 64px);
    line-height: 1;
    letter-spacing: -0.01em;
  }
</style>
