import { describe, expect, it } from 'vitest';
import {
  EMOJI_CATALOG,
  EMOJI_CATALOG_VERSION,
  EMOJI_GROUPS,
  filterEmojiCatalog,
  getEmojiCatalogByGroup,
  normalizeEmojiQuery,
} from './emoji-catalog';

describe('emoji catalog', () => {
  it('ships the Unicode Emoji 17 catalog with grouped entries', () => {
    expect(EMOJI_CATALOG_VERSION).toBe('17.0');
    expect(EMOJI_CATALOG.length).toBeGreaterThan(3900);
    expect(EMOJI_GROUPS).toContain('Smileys & Emotion');
    expect(getEmojiCatalogByGroup('Flags').some((entry) => entry.name === 'flag: Japan')).toBe(true);
  });

  it('normalizes punctuation, underscores, and spacing for search', () => {
    expect(normalizeEmojiQuery('  Face_with:TEARS--of   JOY  ')).toBe('face with tears of joy');
  });

  it('finds emojis by exact words regardless of ordering', () => {
    const results = filterEmojiCatalog('tears joy', { limit: 5 });
    expect(results[0]).toMatchObject({ emoji: '😂', name: 'face with tears of joy' });
  });

  it('finds emojis by fuzzy subsequence', () => {
    const results = filterEmojiCatalog('rdhrt', { limit: 5 });
    expect(results.some((entry) => entry.emoji === '❤️')).toBe(true);
  });

  it('can scope results to one group', () => {
    const results = filterEmojiCatalog('Japan', { group: 'Flags', limit: 3 });
    expect(results[0]).toMatchObject({ emoji: '🇯🇵', group: 'Flags' });
    expect(results.every((entry) => entry.group === 'Flags')).toBe(true);
  });

  it('ranks the US flag first for "usa flag" without flooding with other flags', () => {
    const results = filterEmojiCatalog('usa flag', { limit: 20 });
    expect(results[0]).toMatchObject({ emoji: '🇺🇸' });
    expect(results.some((entry) => entry.emoji === '🇫🇷')).toBe(false);
    expect(results.some((entry) => entry.emoji === '🇯🇵')).toBe(false);
  });

  it('resolves symbol aliases like "100" → hundred points', () => {
    const results = filterEmojiCatalog('100', { limit: 10 });
    expect(results.some((entry) => entry.emoji === '💯')).toBe(true);
  });

  it('maps "rip" to skull emoji instead of a fuzzy flood', () => {
    const results = filterEmojiCatalog('rip', { limit: 200 });
    expect(results.some((entry) => entry.emoji === '💀')).toBe(true);
    expect(results.length).toBeLessThan(20);
  });

  it('keeps literal matches tight: "fire" returns only fire-named emoji', () => {
    const results = filterEmojiCatalog('fire', { limit: 50 });
    expect(results.some((entry) => entry.emoji === '🔥')).toBe(true);
    expect(results.every((entry) => /fire/.test(entry.name.toLowerCase()))).toBe(true);
  });
});
