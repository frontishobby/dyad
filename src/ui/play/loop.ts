/**
 * The frame loop (PLAN §7): render on requestAnimationFrame, read the song
 * clock from the player, and let the engine settle misses. Presses never go
 * through here — see press.ts.
 *
 * Per frame, in this order:
 *   player.syncClock()          refresh the fallback (performance, ctx) pair
 *   gamepad.poll()              polled input: edges are judged now, before tick
 *   engine.tick(songMs - lag)   misses, partner-window expiry, spinner ends (lag: see tickLagMs)
 *   renderer.apply(events)      only when tick produced events
 *   hud.noteEvents(events)      so a timed-out Miss shows a word too
 *   renderer.frame(renderMs)    draw (renderMs: songMs smoothed by renderClock, see smooth.ts)
 *   hud.frame(renderMs, state)  score / combo / progress
 *   stage.render()
 *
 * Collaborators are interfaces so the ordering is testable with fakes.
 */
import type { Engine, EngineEvent, EngineState } from '../../core/types.ts';
import type { RenderClock } from './smooth.ts';

export interface LoopPlayer {
  syncClock(): void;
  songMs(): number;
}

export interface LoopGamepad {
  poll(): void;
}

export interface LoopRenderer {
  apply(events: readonly EngineEvent[], songMs: number): void;
  frame(songMs: number, engine: Engine): void;
}

export interface LoopHud {
  frame(songMs: number, state: Readonly<EngineState>): void;
  noteEvents(events: readonly EngineEvent[]): void;
}

export interface LoopStage {
  render(): void;
}

export interface FrameScheduler {
  /** `cb` receives the frame's timestamp on the performance clock (rAF's argument). */
  request(cb: (frameTimeMs?: number) => void): number;
  cancel(handle: number): void;
}

export interface LoopCollaborators {
  player: LoopPlayer;
  gamepad?: LoopGamepad | null;
  engine: Engine;
  renderer: LoopRenderer;
  hud: LoopHud;
  stage: LoopStage;
  /** Called once, from inside the frame in which engine.state.finished became true. */
  onFinished?: () => void;
  /** Defaults to requestAnimationFrame / cancelAnimationFrame. */
  scheduler?: FrameScheduler;
  /**
   * How far (ms) the clock handed to engine.tick() trails player.songMs().
   * A press is judged at hitMs = songMs(event) − inputOffset − event latency,
   * i.e. in the past; a tick that runs AHEAD of that clock could time out a
   * note the press was about to hit, and the press would then fall through to
   * the next note. Lagging the tick clock by inputOffset + one frame keeps the
   * live state a pure function of the input log (see src/core/engine.ts).
   * Rendering and the HUD keep the plain clock. Read per frame; default 0.
   */
  tickLagMs?: () => number;
  /**
   * Smooths the clock handed to the renderer and HUD (never to the engine).
   * Reset on start(). Absent: they get the raw audio clock.
   */
  renderClock?: RenderClock;
}

function defaultScheduler(): FrameScheduler {
  return {
    request: (cb) => requestAnimationFrame((t) => cb(t)),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}

export class PlayLoop {
  readonly #c: LoopCollaborators;
  readonly #scheduler: FrameScheduler;
  #running = false;
  #handle: number | null = null;
  #frames = 0;
  #finishedNotified = false;

  constructor(collaborators: LoopCollaborators) {
    this.#c = collaborators;
    this.#scheduler = collaborators.scheduler ?? defaultScheduler();
  }

  get running(): boolean {
    return this.#running;
  }

  /** Frames stepped so far (diagnostics). */
  get frames(): number {
    return this.#frames;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#c.renderClock?.reset();
    this.#schedule();
  }

  stop(): void {
    this.#running = false;
    if (this.#handle !== null) {
      this.#scheduler.cancel(this.#handle);
      this.#handle = null;
    }
  }

  /** One frame. Public so tests (and a paused redraw) can drive it by hand. */
  step(frameTimeMs: number = performance.now()): void {
    const { player, gamepad, engine, renderer, hud, stage, renderClock } = this.#c;
    player.syncClock();
    if (gamepad) gamepad.poll();
    const songMs = player.songMs();
    const lag = this.#c.tickLagMs?.() ?? 0;
    const events = engine.tick(Number.isFinite(lag) && lag > 0 ? songMs - lag : songMs);
    const renderMs = renderClock ? renderClock.next(songMs, frameTimeMs) : songMs;
    if (events.length > 0) {
      renderer.apply(events, renderMs);
      hud.noteEvents(events);
    }
    renderer.frame(renderMs, engine);
    hud.frame(renderMs, engine.state);
    stage.render();
    this.#frames++;
    if (!this.#finishedNotified && engine.state.finished) {
      this.#finishedNotified = true;
      this.#c.onFinished?.();
    }
  }

  #schedule(): void {
    this.#handle = this.#scheduler.request(this.#onFrame);
  }

  readonly #onFrame = (frameTimeMs?: number): void => {
    this.#handle = null;
    if (!this.#running) return;
    this.step(frameTimeMs);
    if (this.#running) this.#schedule();
  };
}
