/**
 * Backend contract (PLAN §12). Only LocalBackend exists for now.
 * Records are keyed by chartHash, never by songId alone.
 */
import type { PlayResult } from '../core/types.ts';

export interface Backend {
  submitScore(result: PlayResult): Promise<void>;
  /** Newest first. */
  getScores(chartHash: string, limit?: number): Promise<PlayResult[]>;
  /** Highest score for the chart, or null. */
  getBest(chartHash: string): Promise<PlayResult | null>;
}
