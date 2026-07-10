// entities.test.ts — pure kind-39823 decode helpers (Phase 89, Plan 01).
//
// Proves the helpers extracted from napplets/feed-builder/src/lib/filters.ts are
// behavior-identical and pure (no SDK/DOM coupling): they round-trip the three
// encoded-entity flavours, preserve the longest-prefix-first decode ordering
// (nfilters NOT mis-decoded as nfilter — the documented trap), and that
// parseEntityEvent returns a SavedEntity for a well-formed kind-39823 event and
// null (never throws) on malformed input.

import { describe, it, expect } from 'vitest';
import type { Filter } from 'nostr-tools/filter';
import type { NostrEvent } from '@hyprgate/types';
import {
  encodeNfeed,
  encodeNfilter,
  encodeNfilters,
} from '@sandwichfarm/encoded-entities';
import {
  KIND_FILTER_FEED,
  chooseType,
  decodeEntity,
  parseEntityEvent,
  type SavedEntity,
} from './entities.js';

const PUBKEY = 'a'.repeat(64);

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'event-id',
    kind: KIND_FILTER_FEED,
    pubkey: PUBKEY,
    created_at: 1700000000,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}

describe('chooseType', () => {
  it('picks nfeed when relays are present', () => {
    expect(chooseType([{ kinds: [1] }], ['wss://relay.example'])).toBe('nfeed');
  });
  it('picks nfilters when >1 filter and no relays', () => {
    expect(chooseType([{ kinds: [1] }, { kinds: [6] }], [])).toBe('nfilters');
  });
  it('picks nfilter for a single filter and no relays', () => {
    expect(chooseType([{ kinds: [1] }], [])).toBe('nfilter');
  });
});

describe('decodeEntity', () => {
  it('decodes an nfeed, preserving relays', () => {
    const filters: Filter[] = [{ kinds: [1], authors: [PUBKEY] }];
    const relays = ['wss://relay.one', 'wss://relay.two'];
    const encoded = encodeNfeed({ filters, relays });
    const decoded = decodeEntity(encoded);
    expect(decoded.type).toBe('nfeed');
    expect(decoded.filters).toEqual(filters);
    expect(decoded.relays).toEqual(relays);
  });

  it('decodes an nfilters with empty relays', () => {
    const filters: Filter[] = [{ kinds: [1] }, { kinds: [6] }];
    const encoded = encodeNfilters(filters);
    const decoded = decodeEntity(encoded);
    expect(decoded.type).toBe('nfilters');
    expect(decoded.filters).toEqual(filters);
    expect(decoded.relays).toEqual([]);
  });

  it('decodes an nfilter into a single-filter array with empty relays', () => {
    const filter: Filter = { kinds: [1], '#t': ['nostr'] };
    const encoded = encodeNfilter(filter);
    const decoded = decodeEntity(encoded);
    expect(decoded.type).toBe('nfilter');
    expect(decoded.filters).toEqual([filter]);
    expect(decoded.relays).toEqual([]);
  });

  it('does NOT mis-decode an nfilters value as nfilter (prefix trap)', () => {
    // `nfilter` is a prefix of `nfilters` — the longer form must win.
    const encoded = encodeNfilters([{ kinds: [1] }, { kinds: [7] }]);
    expect(encoded.startsWith('nfilters1')).toBe(true);
    const decoded = decodeEntity(encoded);
    expect(decoded.type).toBe('nfilters');
    expect(decoded.filters).toHaveLength(2);
  });

  it('throws on an unknown entity prefix', () => {
    expect(() => decodeEntity('npub1whatever')).toThrow();
  });
});

describe('parseEntityEvent', () => {
  it('parses a well-formed kind-39823 event into a SavedEntity with address', () => {
    const filter: Filter = { kinds: [1] };
    const encoded = encodeNfilter(filter);
    const event = makeEvent({
      content: encoded,
      tags: [['d', 'morning-reads'], ['title', 'morning-reads'], ['t', 'nfilter']],
    });
    const parsed = parseEntityEvent(event) as SavedEntity;
    expect(parsed).not.toBeNull();
    expect(parsed.identifier).toBe('morning-reads');
    expect(parsed.type).toBe('nfilter');
    expect(parsed.filters).toEqual([filter]);
    expect(parsed.relays).toEqual([]);
    expect(parsed.pubkey).toBe(PUBKEY);
    expect(parsed.createdAt).toBe(1700000000);
    expect(parsed.address).toBe(`${KIND_FILTER_FEED}:${PUBKEY}:morning-reads`);
  });

  it('preserves relays from an nfeed event', () => {
    const filters: Filter[] = [{ kinds: [1] }];
    const relays = ['wss://relay.pin'];
    const encoded = encodeNfeed({ filters, relays });
    const event = makeEvent({ content: encoded, tags: [['d', 'pinned']] });
    const parsed = parseEntityEvent(event) as SavedEntity;
    expect(parsed.type).toBe('nfeed');
    expect(parsed.relays).toEqual(relays);
  });

  it('returns null (no throw) on a missing d tag', () => {
    const encoded = encodeNfilter({ kinds: [1] });
    const event = makeEvent({ content: encoded, tags: [['title', 'no-d-tag']] });
    expect(parseEntityEvent(event)).toBeNull();
  });

  it('returns null (no throw) on undecodable content', () => {
    const event = makeEvent({ content: 'not-an-encoded-entity', tags: [['d', 'bad']] });
    expect(parseEntityEvent(event)).toBeNull();
  });
});
