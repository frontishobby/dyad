/**
 * PlayResult assembly (PLAN §12). Pure: everything comes from the engine's
 * final state and log plus the offsets that were in force. Records are keyed
 * by chartHash, never by songId alone.
 */
import type { EngineState, InputLogEntry, Offsets, PlayResult } from '../../core/types.ts';

export interface PlayResultInput {
  chartHash: string;
  songId: string;
  state: Readonly<EngineState>;
  log: readonly InputLogEntry[];
  offsets: Offsets;
  /** Unix ms. */
  createdAt: number;
}

export function buildPlayResult(input: PlayResultInput): PlayResult {
  const { state } = input;
  return {
    chartHash: input.chartHash,
    songId: input.songId,
    score: state.score,
    accuracy: state.accuracy,
    maxCombo: state.maxCombo,
    counts: { great: state.counts.great, ok: state.counts.ok, miss: state.counts.miss },
    rollTicks: state.rollTicks,
    spinnerTicks: state.spinnerTicks,
    offsets: { audio: input.offsets.audio, input: input.offsets.input },
    replay: input.log.map((entry): InputLogEntry => [entry[0], entry[1]]),
    createdAt: input.createdAt,
  };
}

/** A first record is always a best; otherwise strictly higher score wins. */
export function isNewBest(result: PlayResult, best: PlayResult | null): boolean {
  return best === null || result.score > best.score;
}
