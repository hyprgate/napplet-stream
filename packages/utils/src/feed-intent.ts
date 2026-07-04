// packages/utils/src/feed-intent.ts
// Shared adapter + validator for the hyprgate feed wireformat (Phase 88).
// Lives in @hyprgate/utils so every invoker (feed-builder, the shell intent
// path, the feed napplet) reuses one mapping/validation — anti-drift.
//
// A FeedIntentPayload crosses the napplet trust boundary, so it is treated as
// UNTRUSTED (NAP-INTENT §Security, threat T-88-04): validateFeedIntentPayload
// rejects malformed/oversized input before it ever reaches a subscription.

import type { FeedIntentOrigin, FeedIntentPayload, NostrFilter } from '@hyprgate/types';

export type { FeedIntentOrigin, FeedIntentPayload } from '@hyprgate/types';

/** Max filters in one payload (DoS cap — V5 / T-88-04). */
export const MAX_FEED_FILTERS = 32;
/** Max relays in one pinned payload (DoS cap — V5 / T-88-04). */
export const MAX_FEED_RELAYS = 64;

/** ws:// or wss:// only. */
const RELAY_URL_RE = /^wss?:\/\//;

/**
 * The structural shape of a saved entity the adapter consumes. Typed locally
 * (not imported from feed-builder) to avoid a utils→napp circular dependency;
 * feed-builder's `SavedEntity` is assignable to this.
 */
export interface SavedEntityInput {
  type: 'nfilter' | 'nfilters' | 'nfeed';
  identifier: string;
  filters: NostrFilter[];
  relays: string[];
  address?: string;
}

/** Drop `limit` and clone known filter values so Svelte proxies never cross postMessage. */
function normalizeFilter(filter: NostrFilter): NostrFilter {
  const normalized: NostrFilter = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'limit') continue;
    normalized[key as keyof NostrFilter] = Array.isArray(value) ? [...value] : value;
  }
  return normalized;
}

/**
 * Map a saved entity to a FeedIntentPayload.
 *
 * - `nfeed` (relays present) → relay-origin pin: `{ filters, origin:'relay', relays, title }`.
 * - `nfilters` / `nfilter` (no relays) → outbox discovery: `{ filters, origin:'outbox', title }`.
 *
 * Carries the RAW decoded filters (never the bech32). `limit` is stripped.
 */
export function nfeedToFeedPayload(entity: SavedEntityInput): FeedIntentPayload {
  const filters = entity.filters.map(normalizeFilter);
  const title = entity.identifier;
  const base = typeof entity.address === 'string'
    ? { filters, title, savedEntityAddress: entity.address }
    : { filters, title };

  if (entity.type === 'nfeed' && entity.relays.length > 0) {
    return { ...base, origin: 'relay', relays: [...entity.relays] };
  }
  // nfilters / nfilter, or a malformed legacy nfeed without relays → outbox discovery.
  return { ...base, origin: 'outbox' };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isOrigin(x: unknown): x is FeedIntentOrigin {
  return x === 'outbox' || x === 'relay';
}

/**
 * Validate an untrusted value as a FeedIntentPayload, returning the typed,
 * normalized payload or `null`. Rejections (T-88-04):
 *   - non-object input;
 *   - `filters` not a non-empty array, or any element not an object;
 *   - filter count over {@link MAX_FEED_FILTERS};
 *   - `origin` not in the enum;
 *   - `origin:'relay'` with missing/empty relays, any non-ws(s) relay, or relay
 *     count over {@link MAX_FEED_RELAYS};
 *   - a non-string `title`.
 *
 * Normalization: `limit` is stripped from every filter; `relays` is dropped for
 * an outbox origin (a pin set is meaningless without a pin).
 */
export function validateFeedIntentPayload(x: unknown): FeedIntentPayload | null {
  if (!isRecord(x)) return null;

  const { filters, origin, relays, title, savedEntityAddress } = x;

  if (!Array.isArray(filters) || filters.length === 0) return null;
  if (filters.length > MAX_FEED_FILTERS) return null;
  if (!filters.every(isRecord)) return null;

  if (!isOrigin(origin)) return null;

  if (title !== undefined && typeof title !== 'string') return null;
  if (savedEntityAddress !== undefined && typeof savedEntityAddress !== 'string') return null;

  const normalizedFilters = (filters as NostrFilter[]).map(normalizeFilter);

  if (origin === 'relay') {
    if (!Array.isArray(relays) || relays.length === 0) return null;
    if (relays.length > MAX_FEED_RELAYS) return null;
    if (!relays.every((r) => typeof r === 'string' && RELAY_URL_RE.test(r))) return null;

    const payload: FeedIntentPayload = {
      filters: normalizedFilters,
      origin,
      relays: [...(relays as string[])],
    };
    if (typeof title === 'string') payload.title = title;
    if (typeof savedEntityAddress === 'string') payload.savedEntityAddress = savedEntityAddress;
    return payload;
  }

  // outbox: relays are irrelevant — drop them.
  const payload: FeedIntentPayload = { filters: normalizedFilters, origin };
  if (typeof title === 'string') payload.title = title;
  if (typeof savedEntityAddress === 'string') payload.savedEntityAddress = savedEntityAddress;
  return payload;
}
