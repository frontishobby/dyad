import { describe, expect, it } from 'vitest';
import {
  formatBpm, formatDuration, tierFromName, tierLabel,
  formatAccuracy,
  formatHiSpeed,
  formatOffset,
  formatScore,
  groupDigits,
  prettyKeyCode,
} from '../../src/app/format.ts';

describe('formatScore', () => {
  it('groups digits without locale', () => {
    expect(groupDigits(0)).toBe('0');
    expect(groupDigits(999)).toBe('999');
    expect(groupDigits(1000)).toBe('1,000');
    expect(groupDigits(987650)).toBe('987,650');
    expect(groupDigits(1_000_000)).toBe('1,000,000');
    expect(groupDigits(-1234)).toBe('-1,234');
  });

  it('clamps to 0..1,000,000 and rounds', () => {
    expect(formatScore(987650.4)).toBe('987,650');
    expect(formatScore(-5)).toBe('0');
    expect(formatScore(2_000_000)).toBe('1,000,000');
    expect(formatScore(Number.NaN)).toBe('0');
  });
});

describe('formatAccuracy', () => {
  it('shows two decimals of a percentage', () => {
    expect(formatAccuracy(1)).toBe('100.00%');
    expect(formatAccuracy(0.98123)).toBe('98.12%');
    expect(formatAccuracy(0)).toBe('0.00%');
    expect(formatAccuracy(Number.NaN)).toBe('0.00%');
  });
});

describe('small formatters', () => {
  it('formats hi-speed and offsets', () => {
    expect(formatHiSpeed(1)).toBe('1.0×');
    expect(formatHiSpeed(2.5)).toBe('2.5×');
    expect(formatOffset(12)).toBe('+12 ms');
    expect(formatOffset(-3)).toBe('-3 ms');
    expect(formatOffset(0)).toBe('0 ms');
  });
});

describe('tier helpers', () => {
  it('tierLabel gives the tile text', () => {
    expect(tierLabel('easy')).toBe('EASY');
    expect(tierLabel('normal')).toBe('NORMAL');
    expect(tierLabel('hard')).toBe('HARD');
  });

  it('tierFromName maps legacy osu names, defaulting to hard', () => {
    expect(tierFromName('Kantan')).toBe('easy');
    expect(tierFromName('easy')).toBe('easy');
    expect(tierFromName('Futsuu')).toBe('normal');
    expect(tierFromName(' Normal ')).toBe('normal');
    expect(tierFromName('Muzukashii')).toBe('hard');
    expect(tierFromName('Oni')).toBe('hard');
    expect(tierFromName('Inner Oni')).toBe('hard');
    expect(tierFromName('')).toBe('hard');
  });

  it('formatDuration is m:ss', () => {
    expect(formatDuration(72800)).toBe('1:13');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59499)).toBe('0:59');
    expect(formatDuration(59500)).toBe('1:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('formatBpm collapses a constant tempo and shows a range otherwise', () => {
    expect(formatBpm([150, 150])).toBe('150');
    expect(formatBpm([140, 180])).toBe('140–180');
    expect(formatBpm([174.5, 174.5])).toBe('174.5');
    expect(formatBpm([0, 0])).toBe('0');
  });
})

describe('prettyKeyCode', () => {
  it('shortens common codes', () => {
    expect(prettyKeyCode('KeyR')).toBe('R');
    expect(prettyKeyCode('Digit1')).toBe('1');
    expect(prettyKeyCode('Numpad5')).toBe('Num 5');
    expect(prettyKeyCode('Space')).toBe('Space');
    expect(prettyKeyCode('ArrowLeft')).toBe('←');
    expect(prettyKeyCode('Semicolon')).toBe(';');
    expect(prettyKeyCode('F3')).toBe('F3');
    expect(prettyKeyCode('ShiftLeft')).toBe('Shift (왼쪽)');
  });

  it('sentence-cases unknown camel-case codes', () => {
    expect(prettyKeyCode('LaunchApplication1')).toBe('Launch application1');
    expect(prettyKeyCode('')).toBe('—');
  });
});
