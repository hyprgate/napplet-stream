import { describe, expect, it } from 'vitest';
import { pubkeyColorStyle, pubkeyReadableColor } from './pubkey-color.js';

describe('pubkey color utilities', () => {
  it('derives a normalized readable hsl color from a hex pubkey', () => {
    expect(pubkeyReadableColor(`${'0'.repeat(32)}${'f'.repeat(32)}`)).toMatch(/^hsl\(\d{1,3} 72% 66%\)$/);
  });

  it('uses both the start and end of the pubkey so mined prefixes still diverge', () => {
    const prefix = '0'.repeat(48);
    const first = pubkeyReadableColor(`${prefix}${'1'.repeat(16)}`);
    const second = pubkeyReadableColor(`${prefix}${'2'.repeat(16)}`);

    expect(first).not.toBe(second);
  });

  it('clamps custom saturation and lightness to the readable range', () => {
    expect(pubkeyReadableColor('a'.repeat(64), { saturation: 10, lightness: 90 })).toMatch(/^hsl\(\d{1,3} 52% 74%\)$/);
  });

  it('returns a stable fallback for invalid pubkeys', () => {
    expect(pubkeyReadableColor('not-a-pubkey')).toBe('hsl(180 60% 68%)');
    expect(pubkeyColorStyle('not-a-pubkey')).toBe('color: hsl(180 60% 68%)');
  });
});
