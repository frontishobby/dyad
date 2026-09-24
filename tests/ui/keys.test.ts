import { describe, expect, it } from 'vitest';
import { prettyBindings, prettyKeyCode } from '../../src/ui/play/keys.ts';

describe('prettyKeyCode', () => {
  it('shortens letters, digits and the numpad', () => {
    expect(prettyKeyCode('KeyR')).toBe('R');
    expect(prettyKeyCode('Digit4')).toBe('4');
    expect(prettyKeyCode('Numpad7')).toBe('7');
    expect(prettyKeyCode('F5')).toBe('F5');
  });

  it('names punctuation and modifiers', () => {
    expect(prettyKeyCode('Semicolon')).toBe(';');
    expect(prettyKeyCode('ShiftLeft')).toBe('Shift');
    expect(prettyKeyCode('ArrowLeft')).toBe('←');
    expect(prettyKeyCode('Space')).toBe('Space');
  });

  it('passes unknown codes and blanks through', () => {
    expect(prettyKeyCode('Lang1')).toBe('Lang1');
    expect(prettyKeyCode('')).toBe('');
  });

  it('labels every pad key', () => {
    expect(prettyBindings({ KL: 'KeyR', KR: 'KeyU', DL: 'KeyF', DR: 'KeyJ' })).toEqual({
      KL: 'R',
      KR: 'U',
      DL: 'F',
      DR: 'J',
    });
  });
});
