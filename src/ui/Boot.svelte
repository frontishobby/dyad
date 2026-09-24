<script lang="ts">
  import { getAudioContext, probeWebmOpus, resumeAudio } from '../audio/index.ts';
  import { screen } from '../app/screen.svelte.ts';
  import Button from './components/Button.svelte';
  import ShapeIcon from './components/ShapeIcon.svelte';

  /**
   * Boot: the one user gesture that unlocks audio (PLAN §5). The probe decode
   * decides whether this browser can play the game's webm/Opus at all.
   *
   * The one orchestrated entrance in the app (DESIGN §5): the two shapes land,
   * the wordmark rises, the button follows.
   */
  type Phase = 'idle' | 'checking' | 'unsupported';
  let phase = $state<Phase>('idle');

  async function start(): Promise<void> {
    if (phase === 'checking') return;
    phase = 'checking';
    let ok = false;
    try {
      await resumeAudio();
      ok = await probeWebmOpus(getAudioContext());
    } catch (err) {
      console.warn('dyad: audio probe failed', err);
      ok = false;
    }
    if (!ok) {
      phase = 'unsupported';
      return;
    }
    // Calibration is opened from Settings only (PLAN §9); never forced on entry.
    screen.go({ name: 'title' });
  }

  // Keyboard players: Enter starts without a Tab first.
  $effect(() => {
    const id = phase === 'unsupported' ? 'boot-retry' : phase === 'idle' ? 'boot-start' : null;
    if (id) document.getElementById(id)?.focus();
  });
</script>

<main class="boot">
  <div class="mark" aria-hidden="true">
    <span class="shape kat"><ShapeIcon kind="k" width={88} /></span>
    <span class="shape don"><ShapeIcon kind="d" width={88} /></span>
  </div>
  <h1 class="wordmark">DYAD</h1>

  {#if phase === 'unsupported'}
    <div class="notice" role="alert">
      <p>이 브라우저에서는 곡을 재생할 수 없습니다.</p>
      <p class="dim">iOS 18.4 이상, 또는 최신 Chrome, Firefox, Edge로 업데이트한 뒤 다시 열어 주세요.</p>
      <div class="actions">
        <Button id="boot-retry" variant="primary" onclick={start}>다시 시도</Button>
      </div>
    </div>
  {:else}
    <div class="actions">
      <Button id="boot-start" variant="primary" onclick={start} disabled={phase === 'checking'}>시작</Button>
    </div>
  {/if}
</main>

<style>
  .boot {
    /* Fill whatever holds the app: the 1280×720 frame in landscape, the viewport in portrait. */
    min-height: 100%;
    max-width: 1280px;
    margin-inline: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 40px;
  }

  /* The two shapes stacked as they sit on the track: chevron on the spawn side, brick near. */
  .mark {
    display: grid;
    gap: 6px;
    width: 88px;
    margin-bottom: -16px;
  }

  .shape {
    display: block;
    line-height: 0;
    animation:
      land 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both,
      breathe 4s 1.2s ease-in-out infinite;
  }

  .shape.don {
    animation-delay: 140ms, 1.4s;
  }

  @keyframes land {
    from {
      opacity: 0;
      transform: translateY(-24px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes breathe {
    0%,
    100% {
      transform: none;
    }
    50% {
      transform: translateY(-4px);
    }
  }

  .wordmark {
    font-size: clamp(56px, 14vw, 96px);
    animation: rise 520ms 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .actions,
  .notice {
    animation: rise 420ms 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .notice {
    display: grid;
    gap: 8px;
    max-width: 48ch;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  }

  .notice .actions {
    margin-top: 16px;
    animation: none;
  }
</style>
