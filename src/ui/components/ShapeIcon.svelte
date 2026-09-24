<script lang="ts">
  import type { NoteKind } from '../../core/types.ts';

  /**
   * Note silhouette for guidance (DESIGN §2): 'd' = straight brick, 'k' = chevron
   * bent toward the spawn side (up). Guidance is shape-based; the words don/kat
   * are development vocabulary only.
   */
  let { kind, width = 40 }: { kind: NoteKind; width?: number } = $props();
  const height = $derived(Math.round(width * 0.5));
</script>

{#if kind === 'k'}
  <svg class="shape kat" {width} {height} viewBox="0 0 40 20" aria-hidden="true">
    <path d="M2 12 L20 4 L38 12 L38 18 L20 10 L2 18 Z" stroke-linejoin="round" stroke-width="2" />
  </svg>
{:else}
  <svg class="shape don" {width} {height} viewBox="0 0 40 20" aria-hidden="true">
    <rect x="2" y="6" width="36" height="8" rx="1" />
  </svg>
{/if}

<style>
  .shape {
    display: inline-block;
    vertical-align: middle;
  }
  .kat path {
    fill: var(--kat);
    stroke: var(--kat);
  }
  .don rect {
    fill: var(--don);
  }
</style>
