<script lang="ts">
  import { tierLabel } from '../../app/format.ts';
  import type { Tier } from '../../app/types.ts';

  /**
   * Difficulty tier tile (DESIGN §4): the tier name and its 1–10 level.
   * Selected = periwinkle (the selection role), available = raised brick,
   * absent = dashed outline and disabled. Without `onclick` it is display only.
   */
  let {
    tier,
    level,
    on = false,
    absent = false,
    compact = false,
    onclick,
  }: {
    tier: Tier;
    level: number | null;
    on?: boolean;
    absent?: boolean;
    compact?: boolean;
    onclick?: () => void;
  } = $props();

  const label = $derived(tierLabel(tier));
  const description = $derived(absent ? `${label}: 이 곡에는 없음` : `${label}, 레벨 ${level ?? '—'}`);
</script>

<button
  type="button"
  class="tile"
  class:on
  class:absent
  class:compact
  class:static={!onclick}
  disabled={absent || !onclick}
  aria-pressed={onclick ? on : undefined}
  aria-label={description}
  {onclick}
>
  <span class="level">{absent ? '—' : level ?? '—'}</span>
  <span class="name">{label}</span>
</button>

<style>
  .tile {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 2px;
    width: 76px;
    height: 76px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--raised);
    color: var(--text);
    cursor: pointer;
    transition:
      background-color 120ms ease-out,
      border-color 120ms ease-out,
      color 120ms ease-out,
      transform 80ms ease-out;
  }

  .tile:hover:not(:disabled) {
    border-color: var(--text-faint);
  }

  .tile:active:not(:disabled) {
    transform: scale(0.94);
  }

  .tile.compact {
    width: 56px;
    height: 56px;
    border-radius: 7px;
  }

  .tile.static {
    cursor: default;
  }

  .level {
    font-family: var(--font-display, sans-serif);
    font-weight: 700;
    font-size: 26px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .compact .level {
    font-size: 20px;
  }

  .name {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .compact .name {
    font-size: 10px;
  }

  .tile.on {
    background: var(--kat);
    border-color: var(--kat);
    color: var(--on-kat);
    animation: tile-on 220ms cubic-bezier(0.2, 0.9, 0.3, 1.3);
  }

  @keyframes tile-on {
    from {
      transform: scale(1.1);
    }
    to {
      transform: none;
    }
  }

  .tile.on .name {
    color: var(--on-kat);
    opacity: 0.75;
  }

  .tile.absent {
    background: none;
    border-style: dashed;
    color: var(--text-faint);
    cursor: default;
  }

  .tile.absent .name {
    color: var(--text-faint);
  }

  .tile:focus-visible {
    outline: 2px solid var(--kat);
    outline-offset: 2px;
  }
</style>
