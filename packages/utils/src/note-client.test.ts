import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { nip19 } from 'nostr-tools';
import {
  clientTagValue,
  createHyprgateClientTag,
  hyprgateClientTagPointer,
} from './note-client.js';

function eventWithTags(tags: string[][]): Pick<NostrEvent, 'tags'> {
  return { tags };
}

describe('clientTagValue', () => {
  it('returns the client name from a NIP-89 client tag', () => {
    expect(clientTagValue(eventWithTags([['client', 'Amethyst']]))).toBe('Amethyst');
  });

  it('reads the name even when the tag carries an address and relay', () => {
    expect(
      clientTagValue(eventWithTags([['client', 'Coracle', '31990:abc:def', 'wss://relay.example']])),
    ).toBe('Coracle');
  });

  it('trims surrounding whitespace', () => {
    expect(clientTagValue(eventWithTags([['client', '  Damus  ']]))).toBe('Damus');
  });

  it('returns null when there is no client tag', () => {
    expect(clientTagValue(eventWithTags([['t', 'nostr'], ['p', 'abc']]))).toBeNull();
  });

  it('returns null when the client tag value is empty or missing', () => {
    expect(clientTagValue(eventWithTags([['client', '']]))).toBeNull();
    expect(clientTagValue(eventWithTags([['client']]))).toBeNull();
  });

  it('keeps the display slot readable for the Hyprgate provenance pointer shape', () => {
    const pointer = nip19.naddrEncode({
      kind: 35129,
      pubkey: 'a'.repeat(64),
      identifier: 'debug',
    });
    expect(clientTagValue(eventWithTags([['client', 'hyprgate', pointer]]))).toBe('hyprgate');
  });
});

describe('createHyprgateClientTag', () => {
  it('builds a Hyprgate client tag with an naddr provenance pointer when address data is present', () => {
    const tag = createHyprgateClientTag({
      id: 'e'.repeat(64),
      kind: 35129,
      pubkey: 'a'.repeat(64),
      dTag: 'debug',
      relays: ['wss://relay.example'],
    });

    expect(tag[0]).toBe('client');
    expect(tag[1]).toBe('hyprgate');
    expect(tag[2]).toMatch(/^naddr1/);
    expect(nip19.decode(tag[2]!).data).toMatchObject({
      kind: 35129,
      pubkey: 'a'.repeat(64),
      identifier: 'debug',
      relays: ['wss://relay.example'],
    });
  });

  it('falls back to an nevent provenance pointer when only an exact event id is available', () => {
    const pointer = hyprgateClientTagPointer({
      id: 'e'.repeat(64),
      kind: 1063,
      pubkey: 'a'.repeat(64),
    });

    expect(pointer).toMatch(/^nevent1/);
    expect(nip19.decode(pointer!).data).toMatchObject({
      id: 'e'.repeat(64),
      kind: 1063,
      author: 'a'.repeat(64),
    });
  });

  it('does not fabricate a pointer from incomplete event data', () => {
    expect(createHyprgateClientTag({ kind: 35129, dTag: 'debug' })).toEqual(['client', 'hyprgate']);
    expect(hyprgateClientTagPointer({ kind: 35129, dTag: 'debug' })).toBeNull();
  });
});
