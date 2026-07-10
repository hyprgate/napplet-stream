// entities.ts — pure kind-39823 decode helpers shared by the shell + feed-builder.
//
// Extracted VERBATIM (pure functions only) from napplets/feed-builder/src/lib/filters.ts
// so the shell chrome (Phase 89) can read the user's saved nfilter/nfilters/nfeed
// library WITHOUT importing from a napplet (RESEARCH Open Q1 / Assumption A1).
// Anti-drift: mirrors how nfeedToFeedPayload already lives in @hyprgate/utils.
//
// PURE: imports only nostr-tools + @sandwichfarm/encoded-entities + @hyprgate/types.
// No napplet SDK, no DOM. The SDK-coupled feed-builder store (init/save/remove/
// createFeedBuilderStore) deliberately STAYS in the napp.

import type { NostrEvent } from '@hyprgate/types';
import type { Filter } from 'nostr-tools/filter';
import { decodeNfeed, decodeNfilter, decodeNfilters } from '@sandwichfarm/encoded-entities';

/** Addressable event kind that stores a saved filter or feed. */
export const KIND_FILTER_FEED = 39823 as const;

/** The three encoded-entity flavours, chosen by filter count and relays. */
export type EntityType = 'nfilter' | 'nfilters' | 'nfeed';

/** A saved filter/feed parsed from a kind 39823 event. */
export interface SavedEntity {
  identifier: string;
  type: EntityType;
  encoded: string;
  filters: Filter[];
  relays: string[];
  pubkey: string;
  createdAt: number;
  address: string;
}

/** Pick the most specific entity for a set of filters and relays. */
export function chooseType(filters: Filter[], relays: string[]): EntityType {
  if (relays.length > 0) return 'nfeed';
  if (filters.length > 1) return 'nfilters';
  return 'nfilter';
}

/** Decode a bech32 entity by prefix into filters and relays. */
export function decodeEntity(encoded: string): { type: EntityType; filters: Filter[]; relays: string[] } {
  // `nfilter` is a prefix of `nfilters`; check the longer / relay forms first.
  if (encoded.startsWith('nfeed1')) {
    const feed = decodeNfeed(encoded);
    return { type: 'nfeed', filters: feed.filters, relays: feed.relays };
  }
  if (encoded.startsWith('nfilters1')) {
    return { type: 'nfilters', filters: decodeNfilters(encoded), relays: [] };
  }
  if (encoded.startsWith('nfilter1')) {
    return { type: 'nfilter', filters: [decodeNfilter(encoded)], relays: [] };
  }
  throw new Error(`Unknown entity: ${encoded.slice(0, 12)}…`);
}

/** Parse a kind 39823 event into a SavedEntity, or null if malformed. */
export function parseEntityEvent(event: NostrEvent): SavedEntity | null {
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (!identifier) return null;
  const encoded = (event.content ?? '').trim();
  let decoded: { type: EntityType; filters: Filter[]; relays: string[] };
  try {
    decoded = decodeEntity(encoded);
  } catch {
    return null;
  }
  return {
    identifier,
    type: decoded.type,
    encoded,
    filters: decoded.filters,
    relays: decoded.relays,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    address: `${KIND_FILTER_FEED}:${event.pubkey}:${identifier}`,
  };
}
