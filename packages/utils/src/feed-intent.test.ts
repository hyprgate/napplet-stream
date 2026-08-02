import { describe, expect, it } from 'vitest';
import {
  createFeedIntentRequest,
  createProfileIntentRequest,
  MAX_FEED_FILTERS,
  MAX_FEED_RELAYS,
  nfeedToFeedPayload,
  validateFeedIntentPayload,
  type SavedEntityInput,
} from './feed-intent.js';
import type { IntentRequest as PublicIntentRequest } from '@napplet/nap/intent';

function nfeedEntity(over: Partial<SavedEntityInput> = {}): SavedEntityInput {
  return {
    type: 'nfeed',
    identifier: 'my-feed',
    filters: [{ kinds: [1], authors: ['a'.repeat(64)] }],
    relays: ['wss://relay.one', 'wss://relay.two'],
    ...over,
  };
}

describe('nfeedToFeedPayload', () => {
  it('maps an nfeed (relays present) to a relay-origin pin payload', () => {
    const payload = nfeedToFeedPayload(nfeedEntity());
    expect(payload.origin).toBe('relay');
    expect(payload.relays).toEqual(['wss://relay.one', 'wss://relay.two']);
    expect(payload.filters).toEqual([{ kinds: [1], authors: ['a'.repeat(64)] }]);
    expect(payload.title).toBe('my-feed');
  });

  it('maps an nfilters (no relays) to an outbox-origin discovery payload', () => {
    const payload = nfeedToFeedPayload(
      nfeedEntity({ type: 'nfilters', relays: [], filters: [{ kinds: [1] }, { kinds: [6] }] }),
    );
    expect(payload.origin).toBe('outbox');
    expect(payload.relays).toBeUndefined();
    expect(payload.filters).toEqual([{ kinds: [1] }, { kinds: [6] }]);
    expect(payload.title).toBe('my-feed');
  });

  it('maps an nfilter (single filter, no relays) to an outbox-origin payload', () => {
    const payload = nfeedToFeedPayload(
      nfeedEntity({ type: 'nfilter', relays: [], filters: [{ '#t': ['nostr'] }] }),
    );
    expect(payload.origin).toBe('outbox');
    expect(payload.relays).toBeUndefined();
    expect(payload.filters).toEqual([{ '#t': ['nostr'] }]);
  });

  it('maps an nfeed with no relay list to outbox instead of an invalid relay payload', () => {
    const payload = nfeedToFeedPayload(nfeedEntity({ relays: [] }));
    expect(payload.origin).toBe('outbox');
    expect(payload.relays).toBeUndefined();
    expect(payload.filters).toEqual([{ kinds: [1], authors: ['a'.repeat(64)] }]);
  });

  it('carries the saved entity address for targeted live refresh', () => {
    const payload = nfeedToFeedPayload(
      nfeedEntity({ address: `39823:${'a'.repeat(64)}:my-feed` } as Partial<SavedEntityInput>),
    );
    expect(payload.savedEntityAddress).toBe(`39823:${'a'.repeat(64)}:my-feed`);
  });

  it('strips `limit` from carried filters (runtime owns paging)', () => {
    const payload = nfeedToFeedPayload(
      nfeedEntity({ filters: [{ kinds: [1], limit: 500 }] }),
    );
    expect(payload.filters).toEqual([{ kinds: [1] }]);
  });

  it('returns structured-clone-safe filters from proxy-like saved entities', () => {
    const filters = new Proxy([{ kinds: new Proxy([1], {}) }], {});
    const payload = nfeedToFeedPayload(nfeedEntity({ filters: filters as SavedEntityInput['filters'] }));

    expect(() => structuredClone(payload)).not.toThrow();
    expect(payload.filters).toEqual([{ kinds: [1] }]);
  });
});

describe('canonical feed and profile intent requests', () => {
  it('builds a typed profile request without inventing an action', () => {
    const request = createProfileIntentRequest(
      { pubkey: 'a'.repeat(64) },
      { convention: 'napplet:document/open', behavior: { newWindow: true } },
    );

    expect(request).toEqual({
      archetype: 'profile',
      convention: 'napplet:document/open',
      payload: { pubkey: 'a'.repeat(64) },
      behavior: { newWindow: true },
    });
    expect(request).not.toHaveProperty('action');

    const publicRequest: PublicIntentRequest = request!;
    expect(publicRequest.archetype).toBe('profile');
  });

  it('builds a feed request from the existing validated payload and only includes requested dimensions', () => {
    const request = createFeedIntentRequest(
      { filters: [{ kinds: [1] }], origin: 'outbox' },
      { action: 'refresh', handler: 'feed-handler' },
    );

    expect(request).toEqual({
      archetype: 'feed',
      action: 'refresh',
      handler: 'feed-handler',
      payload: { filters: [{ kinds: [1] }], origin: 'outbox' },
    });
  });

  it('rejects malformed request identity, selectors, and payloads', () => {
    expect(createProfileIntentRequest({ pubkey: 'A'.repeat(64) })).toBeNull();
    expect(createProfileIntentRequest({ pubkey: 'a'.repeat(64) }, { convention: 'profile:open' })).toBeNull();
    expect(createFeedIntentRequest({ filters: [], origin: 'outbox' })).toBeNull();
    expect(createFeedIntentRequest({ filters: [{ kinds: [1] }], origin: 'outbox' }, { action: '' })).toBeNull();
  });
});

describe('validateFeedIntentPayload', () => {
  it('accepts a well-formed outbox payload', () => {
    const out = validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'outbox' });
    expect(out).toEqual({ filters: [{ kinds: [1] }], origin: 'outbox' });
  });

  it('accepts a well-formed relay payload and preserves the relay list', () => {
    const out = validateFeedIntentPayload({
      filters: [{ kinds: [1] }],
      origin: 'relay',
      relays: ['wss://a', 'ws://b'],
      title: 'pinned',
    });
    expect(out).toEqual({
      filters: [{ kinds: [1] }],
      origin: 'relay',
      relays: ['wss://a', 'ws://b'],
      title: 'pinned',
    });
  });

  it('rejects a non-object', () => {
    expect(validateFeedIntentPayload(null)).toBeNull();
    expect(validateFeedIntentPayload('x')).toBeNull();
    expect(validateFeedIntentPayload(42)).toBeNull();
  });

  it('rejects filters that are not a non-empty array', () => {
    expect(validateFeedIntentPayload({ filters: [], origin: 'outbox' })).toBeNull();
    expect(validateFeedIntentPayload({ filters: 'nope', origin: 'outbox' })).toBeNull();
    expect(validateFeedIntentPayload({ origin: 'outbox' })).toBeNull();
  });

  it('rejects a non-object filter element', () => {
    expect(validateFeedIntentPayload({ filters: [null], origin: 'outbox' })).toBeNull();
    expect(validateFeedIntentPayload({ filters: ['x'], origin: 'outbox' })).toBeNull();
  });

  it('rejects an origin that is not in the enum', () => {
    expect(validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'pool' })).toBeNull();
    expect(validateFeedIntentPayload({ filters: [{ kinds: [1] }] })).toBeNull();
  });

  it('rejects a relay origin with missing or empty relays', () => {
    expect(validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'relay' })).toBeNull();
    expect(validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'relay', relays: [] })).toBeNull();
  });

  it('rejects a relay URL that is not a ws/wss scheme', () => {
    expect(
      validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'relay', relays: ['https://a'] }),
    ).toBeNull();
    expect(
      validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'relay', relays: ['wss://a', 'nope'] }),
    ).toBeNull();
  });

  it('rejects an oversized filter count (DoS cap)', () => {
    const filters = Array.from({ length: MAX_FEED_FILTERS + 1 }, () => ({ kinds: [1] }));
    expect(validateFeedIntentPayload({ filters, origin: 'outbox' })).toBeNull();
  });

  it('rejects an oversized relay count (DoS cap)', () => {
    const relays = Array.from({ length: MAX_FEED_RELAYS + 1 }, (_, i) => `wss://r${i}`);
    expect(validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'relay', relays })).toBeNull();
  });

  it('strips `limit` from validated filters (page size is a runtime concern)', () => {
    const out = validateFeedIntentPayload({ filters: [{ kinds: [1], limit: 100 }], origin: 'outbox' });
    expect(out).toEqual({ filters: [{ kinds: [1] }], origin: 'outbox' });
  });

  it('returns a structured-clone-safe payload from proxy-like filters', () => {
    const filter = new Proxy({ kinds: new Proxy([1], {}), limit: 100 }, {});
    const out = validateFeedIntentPayload({ filters: [filter], origin: 'outbox' });

    expect(out).toEqual({ filters: [{ kinds: [1] }], origin: 'outbox' });
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('drops relays for an outbox origin (relay set is meaningless without a pin)', () => {
    const out = validateFeedIntentPayload({
      filters: [{ kinds: [1] }],
      origin: 'outbox',
      relays: ['wss://a'],
    });
    expect(out).toEqual({ filters: [{ kinds: [1] }], origin: 'outbox' });
  });

  it('preserves savedEntityAddress when it is a string', () => {
    const out = validateFeedIntentPayload({
      filters: [{ kinds: [1] }],
      origin: 'outbox',
      savedEntityAddress: `39823:${'a'.repeat(64)}:my-feed`,
    });
    expect(out).toEqual({
      filters: [{ kinds: [1] }],
      origin: 'outbox',
      savedEntityAddress: `39823:${'a'.repeat(64)}:my-feed`,
    });
  });

  it('rejects a non-string savedEntityAddress', () => {
    expect(
      validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'outbox', savedEntityAddress: 39823 }),
    ).toBeNull();
  });

  it('rejects a non-string title', () => {
    expect(
      validateFeedIntentPayload({ filters: [{ kinds: [1] }], origin: 'outbox', title: 5 }),
    ).toBeNull();
  });
});
