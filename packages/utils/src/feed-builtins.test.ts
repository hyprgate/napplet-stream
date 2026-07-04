// feed-builtins.test.ts — built-in feed payload synthesis (Phase 89, Plan 01).
//
// Proves buildBuiltinFeedPayload returns the FeedIntentPayload shapes used by
// the shell chrome, including the degenerate-but-valid empty-follows case, and
// that every synthesized payload passes validateFeedIntentPayload (caps respected).

import { describe, it, expect } from 'vitest';
import { buildBuiltinFeedPayload } from './feed-builtins.js';
import { validateFeedIntentPayload } from './feed-intent.js';

describe('buildBuiltinFeedPayload — shell chrome payload shapes', () => {
  it('Following → {filters:[{kinds:[1],authors}],origin:outbox,title:Following}', () => {
    expect(buildBuiltinFeedPayload({ kind: 'following', follows: ['a', 'b'] })).toEqual({
      filters: [{ kinds: [1], authors: ['a', 'b'] }],
      origin: 'outbox',
      title: 'Following',
    });
  });

  it('Following with empty follows is degenerate-but-valid and cannot normalize to Global', () => {
    const payload = buildBuiltinFeedPayload({ kind: 'following', follows: [] });
    expect(payload).toEqual({
      filters: [{ kinds: [1], authors: ['0'.repeat(64)] }],
      origin: 'outbox',
      title: 'Following',
    });
    expect(payload.filters).not.toEqual(buildBuiltinFeedPayload({ kind: 'global' }).filters);
  });

  it('Global → {filters:[{kinds:[1]}],origin:outbox,title:Global}', () => {
    expect(buildBuiltinFeedPayload({ kind: 'global' })).toEqual({
      filters: [{ kinds: [1] }],
      origin: 'outbox',
      title: 'Global',
    });
  });

  it('#tag → {filters:[{kinds:[1],#t:[tag]}],origin:outbox,title:#tag}', () => {
    expect(buildBuiltinFeedPayload({ kind: 'tag', tag: 'nostr' })).toEqual({
      filters: [{ kinds: [1], '#t': ['nostr'] }],
      origin: 'outbox',
      title: '#nostr',
    });
  });
});

describe('buildBuiltinFeedPayload — validates non-null', () => {
  it('Following (non-empty) round-trips through validateFeedIntentPayload', () => {
    const payload = buildBuiltinFeedPayload({ kind: 'following', follows: ['a'.repeat(64)] });
    expect(validateFeedIntentPayload(payload)).not.toBeNull();
  });

  it('Following (empty follows) round-trips through validateFeedIntentPayload', () => {
    const payload = buildBuiltinFeedPayload({ kind: 'following', follows: [] });
    expect(validateFeedIntentPayload(payload)).not.toBeNull();
  });

  it('Global round-trips through validateFeedIntentPayload', () => {
    expect(validateFeedIntentPayload(buildBuiltinFeedPayload({ kind: 'global' }))).not.toBeNull();
  });

  it('#tag round-trips through validateFeedIntentPayload', () => {
    const payload = buildBuiltinFeedPayload({ kind: 'tag', tag: 'nostr' });
    expect(validateFeedIntentPayload(payload)).not.toBeNull();
  });
});
