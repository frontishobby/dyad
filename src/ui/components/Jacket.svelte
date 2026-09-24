<script lang="ts">
  /**
   * Song jacket: an AVIF <img> loaded lazily over a raised brick placeholder.
   * The placeholder stays when there is no source or the image fails.
   * `fill` makes it square to its container; otherwise `size` px.
   */
  let {
    src,
    alt,
    size = 160,
    fill = false,
  }: { src: string | null; alt: string; size?: number; fill?: boolean } = $props();

  let failedSrc = $state<string | null>(null);
  const showImage = $derived(src !== null && src !== '' && failedSrc !== src);
</script>

{#if showImage && src}
  <span class="jacket" class:fill style:--size="{size}px">
    <img
      {src}
      {alt}
      width={fill ? undefined : size}
      height={fill ? undefined : size}
      loading="lazy"
      decoding="async"
      onerror={() => (failedSrc = src)}
    />
  </span>
{:else}
  <span class="jacket" class:fill style:--size="{size}px" role="img" aria-label={alt}></span>
{/if}

<style>
  .jacket {
    display: block;
    width: var(--size);
    height: var(--size);
    border-radius: calc(var(--size) / 8);
    background: var(--raised);
    overflow: hidden;
    flex: none;
  }

  .jacket.fill {
    width: 100%;
    height: auto;
    aspect-ratio: 1 / 1;
    border-radius: 12.5%;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
