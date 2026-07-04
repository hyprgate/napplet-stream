import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { hasNsfwTag } from './nsfw.js';

function withTags(tags: string[][]): Pick<NostrEvent, 'tags'> {
  return { tags };
}

describe('hasNsfwTag', () => {
  it('detects a plain nsfw hashtag', () => {
    expect(hasNsfwTag(withTags([['t', 'nsfw']]))).toBe(true);
  });

  it('is case-insensitive and tolerates a leading #', () => {
    expect(hasNsfwTag(withTags([['t', 'NSFW']]))).toBe(true);
    expect(hasNsfwTag(withTags([['t', '#Nsfw']]))).toBe(true);
    expect(hasNsfwTag(withTags([['t', '  nsfw  ']]))).toBe(true);
  });

  it('ignores non-hashtag tags with an nsfw value', () => {
    expect(hasNsfwTag(withTags([['client', 'nsfw']]))).toBe(false);
  });

  it('returns false when there is no nsfw hashtag', () => {
    expect(hasNsfwTag(withTags([['t', 'art'], ['t', 'bitcoin']]))).toBe(false);
    expect(hasNsfwTag(withTags([]))).toBe(false);
  });
});
