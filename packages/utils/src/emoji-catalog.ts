import {
  EMOJI_CATALOG,
  EMOJI_CATALOG_SOURCE_DATE,
  EMOJI_CATALOG_VERSION,
} from './emoji-catalog.generated.js';

export { EMOJI_CATALOG, EMOJI_CATALOG_SOURCE_DATE, EMOJI_CATALOG_VERSION };

export interface EmojiCatalogEntry {
  emoji: string;
  name: string;
  group: string;
  subgroup: string;
}

export interface EmojiFilterOptions {
  group?: string;
  limit?: number;
}

export interface EmojiFilterResult {
  entry: EmojiCatalogEntry;
  score: number;
}

export type EmojiConfidence = 'high' | 'low';

export interface EmojiSearchResult {
  entry: EmojiCatalogEntry;
  score: number;
  /** 'high' = every query word matches a whole word in the emoji's name. */
  confidence: EmojiConfidence;
}

const DEFAULT_LIMIT = 96;

export const EMOJI_GROUPS: readonly string[] = Object.freeze(
  Array.from(new Set(EMOJI_CATALOG.map((entry) => entry.group))),
);

export function getEmojiCatalogByGroup(group: string): EmojiCatalogEntry[] {
  return EMOJI_CATALOG.filter((entry) => entry.group === group);
}

export function normalizeEmojiQuery(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[_:,-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Common abbreviations users type that don't appear verbatim in emoji names.
 * Expanded token-wise so "usa flag" ranks the United States flag, not every flag.
 */
const QUERY_ALIASES: Record<string, string> = {
  usa: 'united states',
  us: 'united states',
  america: 'united states',
  american: 'united states',
  uk: 'united kingdom',
  uae: 'united arab emirates',
  eu: 'european union',
  '100': 'hundred',
  rip: 'skull',
};

export function expandEmojiQueryAliases(normalized: string): string {
  return normalized
    .split(' ')
    .map((token) => QUERY_ALIASES[token] ?? token)
    .join(' ');
}

export function filterEmojiCatalog(query: string, options: EmojiFilterOptions = {}): EmojiCatalogEntry[] {
  return searchEmojiCatalog(query, options).map((result) => result.entry);
}

/** Like {@link filterEmojiCatalog} but returns score and confidence per result. */
export function searchEmojiCatalog(query: string, options: EmojiFilterOptions = {}): EmojiSearchResult[] {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const source = options.group
    ? EMOJI_CATALOG.filter((entry) => entry.group === options.group)
    : EMOJI_CATALOG;
  const normalized = expandEmojiQueryAliases(normalizeEmojiQuery(query));

  if (!normalized) {
    return source.slice(0, limit).map((entry) => ({ entry, score: 0, confidence: 'low' as const }));
  }
  const tokens = normalized.split(' ').filter(Boolean);

  // Two tiers: substring/word matches are the real results. Loose subsequence
  // matches are only a fallback for when nothing matches literally (typos like
  // "rdhrt" → red heart), so they never flood a query that has real hits.
  const literal: (EmojiSearchResult & { index: number })[] = [];
  const fuzzy: (EmojiSearchResult & { index: number })[] = [];

  source.forEach((entry, index) => {
    const literalScore = scoreLiteral(entry, tokens, normalized);
    if (literalScore > 0) {
      const name = normalizeEmojiQuery(entry.name);
      const confidence: EmojiConfidence =
        entry.emoji === normalized || allTokensWholeWord(name, tokens) ? 'high' : 'low';
      literal.push({ entry, index, score: literalScore, confidence });
      return;
    }
    const fuzzyScore = scoreFuzzy(entry, tokens);
    if (fuzzyScore > 0) fuzzy.push({ entry, index, score: fuzzyScore, confidence: 'low' });
  });

  const pool = literal.length > 0 ? literal : fuzzy;
  return pool
    .sort((a, b) =>
      Number(b.confidence === 'high') - Number(a.confidence === 'high')
      || b.score - a.score
      || a.index - b.index)
    .slice(0, limit)
    .map(({ entry, score, confidence }) => ({ entry, score, confidence }));
}

/** Whether every token appears as a complete word in the name. */
function allTokensWholeWord(name: string, tokens: string[]): boolean {
  return tokens.every((token) => {
    let from = 0;
    for (;;) {
      const index = name.indexOf(token, from);
      if (index < 0) return false;
      const atStart = index === 0 || name[index - 1] === ' ';
      const end = index + token.length;
      const atEnd = end === name.length || name[end] === ' ';
      if (atStart && atEnd) return true;
      from = index + 1;
    }
  });
}

/** Score by substring/word matches across name (strongest), subgroup, group. 0 = no literal match. */
function scoreLiteral(entry: EmojiCatalogEntry, tokens: string[], normalizedQuery: string): number {
  if (entry.emoji === normalizedQuery) return 100000;

  const name = normalizeEmojiQuery(entry.name);
  const group = normalizeEmojiQuery(entry.group);
  const subgroup = normalizeEmojiQuery(entry.subgroup);

  let score = 0;
  for (const token of tokens) {
    const inName = wordScore(name, token, 300);
    if (inName > 0) {
      score += inName;
      continue;
    }
    if (subgroup.includes(token)) {
      score += 80;
      continue;
    }
    if (group.includes(token)) {
      score += 50;
      continue;
    }
    return 0; // every token must match somewhere literally
  }

  if (name === normalizedQuery) score += 1000;
  else if (name.startsWith(normalizedQuery)) score += 400;
  else if (name.includes(normalizedQuery)) score += 200;
  return score;
}

/** Position-weighted substring score with word-boundary bonuses. */
function wordScore(haystack: string, token: string, base: number): number {
  const index = haystack.indexOf(token);
  if (index < 0) return 0;
  // Coarse position bonus: earlier is better, but near-identical positions tie
  // so equally-strong matches fall back to catalog order.
  let score = base - Math.min(Math.floor(index / 8), 10) * 4;
  const atWordStart = index === 0 || haystack[index - 1] === ' ';
  const end = index + token.length;
  const atWordEnd = end === haystack.length || haystack[end] === ' ';
  if (atWordStart) score += 140;
  if (atWordStart && atWordEnd) score += 140; // whole-word match
  return score;
}

/** Weak subsequence fallback over the full haystack — every token must subsequence-match. */
function scoreFuzzy(entry: EmojiCatalogEntry, tokens: string[]): number {
  const haystack = `${normalizeEmojiQuery(entry.name)} ${normalizeEmojiQuery(entry.group)} ${normalizeEmojiQuery(entry.subgroup)}`;
  let score = 0;
  for (const token of tokens) {
    const tokenScore = subsequenceScore(haystack, token);
    if (tokenScore === 0) return 0;
    score += tokenScore;
  }
  return score;
}

function subsequenceScore(haystack: string, needle: string): number {
  let cursor = 0;
  let first = -1;
  let last = -1;
  let gaps = 0;

  for (const char of needle) {
    const index = haystack.indexOf(char, cursor);
    if (index < 0) return 0;
    if (first < 0) first = index;
    if (last >= 0) gaps += index - last - 1;
    last = index;
    cursor = index + 1;
  }

  return Math.max(1, 120 - Math.min(first, 60) - Math.min(gaps, 90));
}
