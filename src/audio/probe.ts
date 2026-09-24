/**
 * Format probe (PLAN §5). canPlayType() is not trusted (Safari 15 answered
 * differently for <audio> and Web Audio), so the only check is a real decode
 * of a one-second probe.webm at app start. A false result means the UI shows
 * the "update your browser" notice; the game never tries another format.
 */
import type { ProbeWebmOpus } from './types.ts';

export const PROBE_FILE = 'probe.webm';

/**
 * Vite's BASE_URL with a guaranteed trailing slash. Read defensively so the
 * module also loads where import.meta.env does not exist (Node tests).
 */
export function baseUrl(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: unknown } }).env;
  const base = env?.BASE_URL;
  if (typeof base !== 'string' || base === '') return '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export async function probeWebmOpus(ctx: AudioContext, url: string = baseUrl() + PROBE_FILE): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const bytes = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(bytes);
    return decoded.length > 0;
  } catch {
    return false;
  }
}

// Keep the implementation assignable to the contract's function type.
const _contract: ProbeWebmOpus = probeWebmOpus;
void _contract;
