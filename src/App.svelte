<script lang="ts">
  /**
   * App root.
   *
   * Landscape (keyboard / gamepad): the WHOLE app lives in a fixed 1280×720
   * frame, centred in the window, scaled down when the window is smaller and
   * never scaled up; outside it is `void` letterbox (PLAN §3, like ennea).
   * Portrait touch: no frame, the app fills the screen (dynamic resolution).
   */
  import { onMount } from 'svelte';
  import { setMasterVolume } from './audio/context.ts';
  import './app/i18n.svelte.ts';
  import { settings } from './app/settings.svelte.ts';
  import { screen } from './app/screen.svelte.ts';
  import { theme } from './app/theme.svelte.ts';
  import { LAYOUT } from './design/tokens.ts';
  import Boot from './ui/Boot.svelte';
  import Calibrate from './ui/Calibrate.svelte';
  import Credits from './ui/Credits.svelte';
  import Play from './ui/Play.svelte';
  import Result from './ui/Result.svelte';
  import SettingsScreen from './ui/Settings.svelte';
  import Title from './ui/Title.svelte';
  import { COARSE_POINTER_QUERY, PORTRAIT_QUERY, decideOrientation } from './ui/play/orientation.ts';

  const FRAME_W = LAYOUT.landscape.width;
  const FRAME_H = LAYOUT.landscape.height;

  // Importing theme.svelte.ts injects the tokens into <html>; reading it here
  // keeps the root in step with the current theme name.
  const current = $derived(screen.current);

  let frameEl = $state<HTMLDivElement>();
  let shellEl = $state<HTMLDivElement>();

  // Each screen mounts fresh, but the scroller does not: opening credits from the
  // bottom of settings would land scrolled past its header.
  $effect(() => {
    void current;
    frameEl?.scrollTo(0, 0);
    shellEl?.scrollTo(0, 0);
  });

  // Only stores the value (and retunes live master gains); never creates the AudioContext.
  $effect.pre(() => setMasterVolume(settings.value.masterVolume));

  let viewportW = $state(typeof window === 'undefined' ? FRAME_W : window.innerWidth);
  let viewportH = $state(typeof window === 'undefined' ? FRAME_H : window.innerHeight);
  let portraitMedia = $state(false);
  let coarsePointer = $state(false);

  /** Fixed frame unless this is a portrait touch device. Re-evaluated on media changes, never mid-play. */
  const framed = $derived(decideOrientation(portraitMedia, coarsePointer) === 'landscape');
  const scale = $derived(Math.min(viewportW / FRAME_W, viewportH / FRAME_H, 1));

  onMount(() => {
    const queries = [window.matchMedia(PORTRAIT_QUERY), window.matchMedia(COARSE_POINTER_QUERY)] as const;
    const read = (): void => {
      portraitMedia = queries[0].matches;
      coarsePointer = queries[1].matches;
    };
    read();
    for (const q of queries) q.addEventListener('change', read);
    return () => {
      for (const q of queries) q.removeEventListener('change', read);
    };
  });
</script>

<svelte:window bind:innerWidth={viewportW} bind:innerHeight={viewportH} />

{#snippet screens()}
  {#key current}
    {#if current.name === 'boot'}
      <Boot />
    {:else if current.name === 'title'}
      <Title />
    {:else if current.name === 'settings'}
      <SettingsScreen />
    {:else if current.name === 'credits'}
      <Credits />
    {:else if current.name === 'calibrate'}
      <Calibrate returnTo={current.returnTo} />
    {:else if current.name === 'play'}
      <Play song={current.song} chart={current.chart} auto={current.auto ?? false} />
    {:else if current.name === 'result'}
      <Result
        song={current.song}
        chart={current.chart}
        result={current.result}
        best={current.best}
        isNewBest={current.isNewBest}
      />
    {/if}
  {/key}
{/snippet}

{#if framed}
  <div
    bind:this={frameEl}
    class="frame"
    data-theme={theme.value.name}
    style:width="{FRAME_W}px"
    style:height="{FRAME_H}px"
    style:transform="translate(-50%, -50%) scale({scale})"
  >
    {@render screens()}
  </div>
{:else}
  <div bind:this={shellEl} class="shell" data-theme={theme.value.name}>
    {@render screens()}
  </div>
{/if}

<style>
  /* The 1280×720 stage. A transform makes it the containing block for the
     play screen's fixed overlay, so play fits the frame, not the window. */
  .frame {
    position: fixed;
    left: 50%;
    top: 50%;
    transform-origin: center;
    overflow: auto;
    background: var(--ground);
    color: var(--text);
  }

  /* Portrait: a column as tall as the viewport whose one screen stretches to fill it
     (a percentage min-height would not resolve against #app's min-height). The shell
     is the scroller: if the page scrolled instead, a tall screen would run past the
     shell's ground into the void behind it. */
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Installed on a phone the page runs under the status bar and the home
       indicator (viewport-fit=cover): keep every screen inside the safe area.
       The play screen handles its own insets. */
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px)
      env(safe-area-inset-left, 0px);
    background: var(--ground);
  }
  /* Screens fill the shell (100 % resolves against its definite height); a taller
     one (settings, result) overflows it and the shell scrolls. Screens carry
     margin-inline: auto for max-width centring, which in a flex column stops
     them stretching sideways, so the width is explicit. */
  .shell > :global(*) {
    flex: 1 0 auto;
    width: 100%;
  }
  /* Percentage heights inside the frame resolve against its fixed height. */
  .frame > :global(*) {
    min-height: 100%;
  }
  /* Both scrollers still scroll, but never show a bar: a screen that exactly fills
     them overflows by the screen-in rise for 260 ms, which flashed one in and out,
     and a tall settings screen should not carry a desktop gutter. */
  .frame,
  .shell {
    scrollbar-width: none;
  }
  .frame::-webkit-scrollbar,
  .shell::-webkit-scrollbar {
    display: none;
  }
</style>
