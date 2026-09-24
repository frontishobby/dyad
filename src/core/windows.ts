/**
 * Judgement windows (PLAN §2): fixed for every chart.
 *
 *   Great  |hitMs − t| ≤ 30 ms
 *   OK     |hitMs − t| ≤ 50 ms
 *   Miss   otherwise — a press outside ±50 ms does not touch the note; the
 *          note is missed once the song clock passes t + 50 ms unhit.
 *
 * The chart's OverallDifficulty is kept in chart.meta for display only.
 */
import type { EngineConfig, JudgeWindows } from './types.ts';

/** Second hand of a big note must land within this many ms of the first (PLAN §2). */
export const DEFAULT_BIG_WINDOW_MS = 30;

/** Half-widths in ms. miss = ok: there is no "too early but consumed" band. */
export const JUDGE_WINDOWS: Readonly<JudgeWindows> = Object.freeze({ great: 30, ok: 50, miss: 50 });

/** The fixed windows as a fresh object. `od` is accepted for callers that still pass it and ignored. */
export function windowsFromOD(od?: number): JudgeWindows {
  void od;
  return { ...JUDGE_WINDOWS };
}

/** Engine config: the fixed windows and the 30 ms partner window. `od` is ignored (kept for call sites). */
export function defaultConfig(od?: number): EngineConfig {
  void od;
  return { windows: windowsFromOD(), bigWindowMs: DEFAULT_BIG_WINDOW_MS };
}
