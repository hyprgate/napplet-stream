import { describe, expect, it } from 'vitest';
import { formatAge, formatUntil, playbackLabel, shortNpub } from './stream-format.js';

describe('stream-format', () => {
  it('counts back from now', () => {
    expect(formatAge(1000, 1010)).toBe('just now');
    expect(formatAge(1000, 1000 + 1_200)).toBe('20m ago');
    expect(formatAge(1000, 1000 + 10_800)).toBe('3h ago');
    expect(formatAge(1000, 1000 + 172_800)).toBe('2d ago');
  });

  it('counts forward to a start time', () => {
    expect(formatUntil(1030, 1000)).toBe('soon');
    expect(formatUntil(1000 + 1_200, 1000)).toBe('in 20m');
    expect(formatUntil(1000 + 7_200, 1000)).toBe('in 2h');
    expect(formatUntil(1000 + 172_800, 1000)).toBe('in 2d');
  });

  it('keeps both ends of a real npub and passes through what it can not encode', () => {
    expect(shortNpub('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')).toBe('npub10xlxvlh…pkge6d');
    expect(shortNpub('nope')).toBe('nope');
  });

  it('names playback states and failures', () => {
    expect(playbackLabel('playing', false)).toBe('Now playing');
    expect(playbackLabel('paused', false)).toBe('Paused');
    expect(playbackLabel(null, true)).toBe("Can't play this one");
  });
});
