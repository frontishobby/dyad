/**
 * Audio module (PLAN §5, §7): shared AudioContext, song player / song clock,
 * synthesised hit sounds and the webm/Opus decode probe.
 */
export { getAudioContext, resumeAudio } from './context.ts';
export { createSongPlayer } from './player.ts';
export { createHitSounds } from './hitsounds.ts';
export { probeWebmOpus } from './probe.ts';
export * from './types.ts';
