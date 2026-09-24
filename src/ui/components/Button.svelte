<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /** Brick button (DESIGN §2). primary = amber action, secondary = raised. */
  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary';
    size?: 'md' | 'sm';
    children: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    type = 'button',
    class: className = '',
    children,
    ...rest
  }: Props = $props();

  const classes = $derived(['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className].filter(Boolean).join(' '));
</script>

<button {type} class={classes} {...rest}>{@render children()}</button>
