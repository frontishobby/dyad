/**
 * Chart hashing (PLAN §4). Records and replays are keyed by this hash, never
 * by songId. The canonical body has fixed key order and excludes meta, so the
 * converter (Node) and the app (browser) agree byte for byte.
 */
import type { ChartBody } from './types.ts';

export function canonicalChartBody(body: ChartBody): string {
  const canonical = {
    timing: body.timing.map((p) => ({ t: p.t, beatLength: p.beatLength, meter: p.meter })),
    notes: body.notes.map((n) => ({ t: n.t, k: n.k, big: n.big })),
    rolls: body.rolls.map((r) => ({ t: r.t, end: r.end, big: r.big })),
    spinners: body.spinners.map((s) => ({ t: s.t, end: s.end, hits: s.hits })),
  };
  return JSON.stringify(canonical);
}

export async function chartHash(body: ChartBody): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalChartBody(body));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
