// napplets/stream/src/lib/stream-store.test.ts
// TDD: RED phase — tests written before implementation

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from 'nostr-tools/core';
import { parseKind30311, createStreamStore } from './stream-store';

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeTags(map: Record<string, string>, extra?: string[][]): string[][] {
  const tags: string[][] = Object.entries(map).map(([k, v]) => [k, v]);
  if (extra) tags.push(...extra);
  return tags;
}

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    kind: 30311,
    id: 'abc123',
    pubkey: 'host-pubkey-hex',
    created_at: 1700000000,
    content: '',
    sig: 'sig',
    tags: makeTags({
      'd': 'unique-stream-id',
      'title': 'Test Stream',
      'status': 'live',
      'streaming': 'https://example.com/live.m3u8',
      'current_participants': '42',
      'image': 'https://example.com/thumb.jpg',
      'summary': 'A test stream',
      'service': 'zap.stream',
    }, [
      ['p', 'host-pubkey-hex', '', 'host'],
      ['t', 'coding'],
      ['t', 'nostr'],
    ]),
    ...overrides,
  };
}

// ─── parseKind30311 ───────────────────────────────────────────────────────────

describe('parseKind30311', () => {
  it('Test 1: extracts all fields from a valid kind 30311 event', () => {
    const event = makeEvent();
    const result = parseKind30311(event);

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Test Stream');
    expect(result!.streamUrl).toBe('https://example.com/live.m3u8');
    expect(result!.status).toBe('live');
    expect(result!.hostPubkey).toBe('host-pubkey-hex');
    expect(result!.viewerCount).toBe(42);
    expect(result!.image).toBe('https://example.com/thumb.jpg');
    expect(result!.summary).toBe('A test stream');
    expect(result!.service).toBe('zap.stream');
    expect(result!.tags).toEqual(['coding', 'nostr']);
    expect(result!.event).toBe(event);
  });

  it('Test 2: returns null for event with kind !== 30311', () => {
    const event = makeEvent({ kind: 1 });
    expect(parseKind30311(event)).toBeNull();
  });

  it('Test 3: uses "stream" tag as fallback when "streaming" tag is missing', () => {
    const event = makeEvent({
      tags: makeTags({
        'd': 'id',
        'title': 'Fallback Stream',
        'status': 'live',
        'stream': 'https://fallback.com/stream.m3u8',
      }),
    });
    const result = parseKind30311(event);
    expect(result).not.toBeNull();
    expect(result!.streamUrl).toBe('https://fallback.com/stream.m3u8');
  });

  it('Test 4: tries "recording" then "url" as further fallbacks', () => {
    const eventWithRecording = makeEvent({
      tags: makeTags({
        'd': 'id',
        'title': 'Recording Stream',
        'status': 'live',
        'recording': 'https://recording.com/vod.m3u8',
      }),
    });
    const result1 = parseKind30311(eventWithRecording);
    expect(result1!.streamUrl).toBe('https://recording.com/vod.m3u8');

    const eventWithUrl = makeEvent({
      tags: makeTags({
        'd': 'id',
        'title': 'URL Stream',
        'status': 'live',
        'url': 'https://url.com/stream.m3u8',
      }),
    });
    const result2 = parseKind30311(eventWithUrl);
    expect(result2!.streamUrl).toBe('https://url.com/stream.m3u8');
  });

  it('Test 5: returns null for event with status !== "live"', () => {
    const offlineEvent = makeEvent({
      tags: makeTags({
        'd': 'id',
        'title': 'Offline Stream',
        'status': 'offline',
        'streaming': 'https://example.com/live.m3u8',
      }),
    });
    expect(parseKind30311(offlineEvent)).toBeNull();

    const scheduledEvent = makeEvent({
      tags: makeTags({
        'd': 'id',
        'title': 'Scheduled Stream',
        'status': 'scheduled',
        'streaming': 'https://example.com/live.m3u8',
      }),
    });
    expect(parseKind30311(scheduledEvent)).toBeNull();
  });

  it('Test 6: uses "d" tag as fallback title when "title" tag is missing', () => {
    const event = makeEvent({
      tags: makeTags({
        'd': 'my-stream-id',
        'status': 'live',
        'streaming': 'https://example.com/live.m3u8',
      }),
    });
    const result = parseKind30311(event);
    expect(result!.title).toBe('my-stream-id');
  });

  it('Test 9: streamAddr is the NIP-53 addressable coordinate "30311:<hostPubkey>:<d-tag>"', () => {
    // This is required for kind 1311 chat subscription '#a' filter.
    // The event id (hash) must NOT be used as streamAddr.
    const event = makeEvent();
    const result = parseKind30311(event);
    expect(result).not.toBeNull();
    // hostPubkey comes from the p tag with role=host; d-tag is 'unique-stream-id'
    expect(result!.streamAddr).toBe('30311:host-pubkey-hex:unique-stream-id');
    // Confirm it is NOT the event id
    expect(result!.streamAddr).not.toBe(event.id);
  });

  it('Test 10: streamAddr uses event.pubkey when no host p tag is present', () => {
    const event = makeEvent({
      pubkey: 'event-pubkey-hex',
      tags: makeTags({
        'd': 'my-d-tag',
        'status': 'live',
        'streaming': 'https://example.com/live.m3u8',
      }),
    });
    const result = parseKind30311(event);
    expect(result!.streamAddr).toBe('30311:event-pubkey-hex:my-d-tag');
  });

  it('Test 11: chatRelays extracted from "relays" tag', () => {
    // NIP-53: ["relays", "wss://one.com", "wss://two.com"]
    const event = makeEvent({
      tags: [
        ['d', 'stream-id'],
        ['title', 'Relay Stream'],
        ['status', 'live'],
        ['streaming', 'https://example.com/live.m3u8'],
        ['p', 'host-pubkey-hex', '', 'host'],
        ['relays', 'wss://relay.zap.stream', 'wss://relay2.zap.stream'],
      ],
    });
    const result = parseKind30311(event);
    expect(result).not.toBeNull();
    expect(result!.chatRelays).toEqual(['wss://relay.zap.stream', 'wss://relay2.zap.stream']);
  });

  it('Test 12: chatRelays is empty array when no "relays" tag', () => {
    const event = makeEvent(); // makeEvent has no relays tag
    const result = parseKind30311(event);
    expect(result).not.toBeNull();
    expect(result!.chatRelays).toEqual([]);
  });
});

// ─── createStreamStore ────────────────────────────────────────────────────────

describe('createStreamStore', () => {
  it('Test 7: starts with empty streams Map and loading=true', () => {
    const store = createStreamStore();
    expect(store.streams.size).toBe(0);
    expect(store.loading).toBe(true);
  });

  it('Test 8: addStream adds a stream, getStreams returns array', () => {
    const store = createStreamStore();
    const stream = parseKind30311(makeEvent())!;
    store.addStream(stream);
    expect(store.streams.size).toBe(1);
    const streams = store.getStreams();
    expect(Array.isArray(streams)).toBe(true);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toBe(stream);
  });

  it('addStream uses stream.id as key (deduplicates)', () => {
    const store = createStreamStore();
    const stream = parseKind30311(makeEvent())!;
    store.addStream(stream);
    store.addStream(stream); // same id
    expect(store.streams.size).toBe(1);
  });

  it('addStream keeps different streams from the same publisher pubkey', () => {
    const store = createStreamStore();
    const firstStream = parseKind30311(makeEvent({
      id: 'first-event',
      pubkey: 'same-publisher',
      created_at: 1700000000,
      tags: makeTags({
        'd': 'first-stream-id',
        'title': 'First Stream',
        'status': 'live',
        'streaming': 'https://example.com/first.m3u8',
      }),
    }))!;
    const secondStream = parseKind30311(makeEvent({
      id: 'second-event',
      pubkey: 'same-publisher',
      created_at: 1700000060,
      tags: makeTags({
        'd': 'second-stream-id',
        'title': 'Second Stream',
        'status': 'live',
        'streaming': 'https://example.com/second.m3u8',
      }),
    }))!;

    store.addStream(firstStream);
    store.addStream(secondStream);

    expect(store.getStreams()).toEqual([secondStream, firstStream]);
    expect(store.streams.has(firstStream.id)).toBe(true);
    expect(store.streams.has(secondStream.id)).toBe(true);
  });

  it('addStream ignores older refreshes for the same stream address', () => {
    const store = createStreamStore();
    const newest = parseKind30311(makeEvent({
      id: 'newest-event',
      pubkey: 'same-publisher',
      created_at: 1700000060,
      tags: makeTags({
        'd': 'same-stream-id',
        'title': 'Newest Stream',
        'status': 'live',
        'streaming': 'https://example.com/newest.m3u8',
      }),
    }))!;
    const stale = parseKind30311(makeEvent({
      id: 'stale-event',
      pubkey: 'same-publisher',
      created_at: 1700000000,
      tags: makeTags({
        'd': 'same-stream-id',
        'title': 'Stale Stream',
        'status': 'live',
        'streaming': 'https://example.com/stale.m3u8',
      }),
    }))!;

    store.addStream(newest);
    store.addStream(stale);

    expect(store.getStreams()).toEqual([newest]);
    expect(store.streams.has(stale.id)).toBe(false);
  });

  it('removeStream removes a stream by id', () => {
    const store = createStreamStore();
    const stream = parseKind30311(makeEvent())!;
    store.addStream(stream);
    store.removeStream(stream.id);
    expect(store.streams.size).toBe(0);
  });

  it('setLoading updates the loading flag', () => {
    const store = createStreamStore();
    store.setLoading(false);
    expect(store.loading).toBe(false);
  });

  it('clear removes all streams', () => {
    const store = createStreamStore();
    const stream = parseKind30311(makeEvent())!;
    store.addStream(stream);
    store.clear();
    expect(store.streams.size).toBe(0);
  });
});
