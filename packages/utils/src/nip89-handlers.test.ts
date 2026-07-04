import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  dedupeNip89Handlers,
  formatNip89HandlerLink,
  nip89HandlerFromEvent,
  nip89RecommendationRefsForKind,
} from './nip89-handlers';
import type { NostrEvent } from '@hyprgate/types';

const PUBKEY = 'a'.repeat(64);
const TARGET: NostrEvent = {
  id: 'b'.repeat(64),
  pubkey: 'c'.repeat(64),
  created_at: 1,
  kind: 1063,
  tags: [],
  content: '{"raw":true}',
  sig: 's',
};

function event(kind: number, tags: string[][], content = ''): NostrEvent {
  return {
    id: `${kind}`.padStart(64, '0'),
    pubkey: PUBKEY,
    created_at: 1,
    kind,
    tags,
    content,
    sig: 's',
  };
}

describe('NIP-89 handler helpers', () => {
  it('parses a handler event with matching k and web template tags', () => {
    const handler = nip89HandlerFromEvent(event(31990, [
      ['d', 'media-viewer'],
      ['k', '1063'],
      ['name', 'Media Viewer'],
      ['web', 'https://example.test/open/<bech32>', 'nevent'],
    ]));

    expect(handler).toMatchObject({
      identity: `31990:${PUBKEY}:media-viewer`,
      name: 'Media Viewer',
      kinds: [1063],
      supportedTargets: expect.arrayContaining(['kind:1063', 'nevent', 'media-viewer']),
    });
  });

  it('formats handler links by replacing bech32 with the requested target pointer', () => {
    const handler = nip89HandlerFromEvent(event(31990, [
      ['d', 'media-viewer'],
      ['k', '1063'],
      ['web', 'https://example.test/open/bech32', 'nevent'],
    ]))!;

    const encoded = nip19.neventEncode({ id: TARGET.id, author: TARGET.pubkey, kind: TARGET.kind });
    expect(formatNip89HandlerLink(handler, TARGET)).toBe(`https://example.test/open/${encoded}`);
  });

  it('deduplicates handlers by address identity rather than display name', () => {
    const first = nip89HandlerFromEvent(event(31990, [['d', 'media'], ['k', '1063'], ['web', 'https://a.example/bech32']]))!;
    const second = nip89HandlerFromEvent({
      ...first.event,
      id: '1'.repeat(64),
      tags: [['d', 'media'], ['k', '1063'], ['name', 'Renamed'], ['web', 'https://b.example/bech32']],
    })!;
    const third = nip89HandlerFromEvent(event(31990, [['d', 'other'], ['k', '1063'], ['web', 'https://c.example/bech32']]))!;

    expect(dedupeNip89Handlers([first, second, third]).map((handler) => handler.identity)).toEqual([
      first.identity,
      third.identity,
    ]);
  });

  it('ignores malformed handler events and extracts recommendation refs', () => {
    expect(nip89HandlerFromEvent(event(31990, [['k', '1063']]))).toBeNull();
    expect(nip89HandlerFromEvent(event(31990, [['d', 'broken']]))).toBeNull();

    expect(nip89RecommendationRefsForKind(event(31989, [
      ['d', '1063'],
      ['a', `31990:${PUBKEY}:media`, 'wss://relay.example'],
      ['a', '31990:missing'],
    ]), 1063)).toEqual([
      { kind: 31990, pubkey: PUBKEY, dTag: 'media', relays: ['wss://relay.example'] },
    ]);
  });
});
