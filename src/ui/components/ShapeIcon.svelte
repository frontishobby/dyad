<script lang="ts">
  import type { NoteKind } from '../../core/types.ts';

  /**
   * Note icon for guidance (DESIGN §2): a disc in the type colour, amber for
   * 'd' and periwinkle for 'k'. Guidance is colour-based; the words don/kat
   * are development vocabulary only.
   */
  let { kind, width = 40 }: { kind: NoteKind; width?: number } = $props();
  const height = $derived(Math.round(width * 0.5));
</script>

<svg class="shape {kind === 'k' ? 'kat' : 'don'}" {width} {height} viewBox="0 0 40 20" aria-hidden="true">
  <circle cx="20" cy="10" r="9" />
</svg>

<style>
  .shape {
    display: inline-block;
    vertical-align: middle;
  }
  .kat circle {
    fill: var(--kat);
  }
  .don circle {
    fill: var(--don);
  }
</style>
