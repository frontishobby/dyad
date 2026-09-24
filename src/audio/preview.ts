/**
 * Song-select preview (PLAN §5). Plays a slice of a song's WebM on the shared
 * AudioContext with a fade in, looping the slice with a fade at each seam,
 * and cross-fades out when the selection changes or the screen leaves.
 *
 * Decoded buffers are cached per URL for the session so browsing back and
 * forth does not re-decode. Nothing here creates an <audio> element.
 */
import { getAudioContext } from './context.ts';

/** Preview slice length and fades, ms. */
export const PREVIEW_LENGTH_MS = 14_000;
export const PREVIEW_FADE_MS = 400;
/** Master gain for previews (the song player itself plays at 1). */
export const PREVIEW_GAIN = 0.55;

export interface PreviewPlayer {
  /** Fade in a preview of `url` from `startMs`. A pending or playing preview fades out first. */
  play(url: string, startMs: number): void;
  /** Fade out whatever is playing. */
  stop(): void;
  /** stop(), then forget the decoded buffers. */
  destroy(): void;
}

export function createPreviewPlayer(ctx: AudioContext = getAudioContext(), fetchFn: typeof fetch = fetch): PreviewPlayer {
  const buffers = new Map<string, Promise<AudioBuffer>>();
  let current: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Bumped on every play()/stop() so a decode that lands late is ignored. */
  let generation = 0;

  function decode(url: string): Promise<AudioBuffer> {
    let pending = buffers.get(url);
    if (!pending) {
      pending = fetchFn(url)
        .then((res) => {
          if (!res.ok) throw new Error(`preview: HTTP ${res.status} for ${url}`);
          return res.arrayBuffer();
        })
        .then((bytes) => ctx.decodeAudioData(bytes));
      pending.catch(() => buffers.delete(url));
      buffers.set(url, pending);
    }
    return pending;
  }

  function fadeOutCurrent(): void {
    const playing = current;
    current = null;
    if (!playing) return;
    const now = ctx.currentTime;
    const fade = PREVIEW_FADE_MS / 1000;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0, now + fade);
    try {
      playing.source.stop(now + fade + 0.05);
    } catch {
      // Already stopped.
    }
  }

  return {
    play(url, startMs) {
      const gen = ++generation;
      fadeOutCurrent();
      void decode(url)
        .then((buffer) => {
          if (gen !== generation) return;
          const start = Math.max(0, Math.min(startMs / 1000, Math.max(0, buffer.duration - 1)));
          const end = Math.min(buffer.duration, start + PREVIEW_LENGTH_MS / 1000);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.loopStart = start;
          source.loopEnd = end;
          const gain = ctx.createGain();
          const now = ctx.currentTime;
          const fade = PREVIEW_FADE_MS / 1000;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(PREVIEW_GAIN, now + fade);
          source.connect(gain).connect(ctx.destination);
          source.start(now, start);
          current = { source, gain };
        })
        .catch((err: unknown) => {
          console.warn('dyad: preview failed', err);
        });
    },
    stop() {
      generation++;
      fadeOutCurrent();
    },
    destroy() {
      generation++;
      fadeOutCurrent();
      buffers.clear();
    },
  };
}
