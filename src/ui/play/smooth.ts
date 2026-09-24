/**
 * Render clock smoothing (PLAN §7). The audio clock (`AudioContext.currentTime`)
 * advances in output quanta, not continuously: read once per animation frame
 * it jumps by an uneven 11–17 ms, and notes drawn straight from it judder.
 * The renderer therefore draws from a clock that advances by the frame's
 * real elapsed time and is pulled toward the audio clock a little each frame;
 * a large error (pause, tab switch, seek) snaps instead of easing.
 *
 * Judgement never touches this: the engine ticks on the raw audio clock.
 */
export interface RenderClock {
  /** Song ms to draw for a frame at `frameTimeMs` (performance clock), given the audio clock's reading. */
  next(measuredMs: number, frameTimeMs: number): number;
  /** Forget the history (the loop calls it on start, so a pause never eases). */
  reset(): void;
}

/** Fraction of the remaining error removed per frame: ±3 ms of quantum jitter vanishes, drift is gone within ~20 frames. */
export const SMOOTH_GAIN = 0.15;
/** Errors beyond this are not eased but snapped. */
export const SMOOTH_SNAP_MS = 60;

export function createSmoothClock(gain = SMOOTH_GAIN, snapMs = SMOOTH_SNAP_MS): RenderClock {
  let render = Number.NaN;
  let lastFrame = Number.NaN;
  return {
    next(measuredMs, frameTimeMs) {
      if (!Number.isFinite(measuredMs)) return measuredMs;
      if (Number.isNaN(render) || !Number.isFinite(frameTimeMs) || !Number.isFinite(lastFrame)) {
        render = measuredMs;
      } else {
        const predicted = render + (frameTimeMs - lastFrame);
        const error = measuredMs - predicted;
        render = Math.abs(error) > snapMs ? measuredMs : predicted + error * gain;
      }
      lastFrame = frameTimeMs;
      return render;
    },
    reset() {
      render = Number.NaN;
      lastFrame = Number.NaN;
    },
  };
}
