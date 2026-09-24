/**
 * Shared AudioContext (PLAN §5, §7).
 *
 * One context for the whole app: the song player, the hit sounds and the
 * format probe all hang off it so their clocks agree. It is created lazily
 * (constructing one before a user gesture leaves it suspended and logs a
 * warning) and unlocked by resumeAudio(), which must be called from inside a
 * user-gesture handler. Nothing here ever creates an <audio> element.
 */

let shared: AudioContext | null = null;
/** True once the context has actually been observed running after an unlock attempt. */
let unlocked = false;

/**
 * Lazy singleton with `latencyHint: 'interactive'` (smallest output buffer the
 * platform allows, which is what a rhythm game wants). A context that was
 * closed by someone is replaced on the next call.
 */
export function getAudioContext(): AudioContext {
  if (shared === null || shared.state === 'closed') {
    const Ctor = globalThis.AudioContext;
    if (typeof Ctor !== 'function') {
      throw new Error('Web Audio is not available in this environment');
    }
    shared = new Ctor({ latencyHint: 'interactive' });
    unlocked = false;
  }
  return shared;
}

/**
 * Unlock and resume the shared context. Call this synchronously from a user
 * gesture (pointerdown / keydown / click): both the silent-buffer trick and the
 * resume() call have to originate inside the gesture's task.
 *
 * iOS only treats the context as unlocked once a source node has been started
 * inside a gesture, so a one-frame silent buffer is played before resuming.
 * That is retried on later calls until the context is seen running, so a call
 * that happened outside a gesture (e.g. at boot) does not spend the trick.
 */
export async function resumeAudio(): Promise<void> {
  const ctx = getAudioContext();
  if (!unlocked) {
    const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = silent;
    source.connect(ctx.destination);
    source.start(0);
  }
  if (ctx.state !== 'running') {
    await ctx.resume();
  }
  if (ctx.state === 'running') {
    unlocked = true;
  }
}
