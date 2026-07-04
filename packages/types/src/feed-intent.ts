// packages/types/src/feed-intent.ts
// The hyprgate feed wireformat (Phase 88, FEED-01/FEED-02). A FeedIntentPayload
// is the single shape the feed napplet renders from — whatever NostrFilter[] it
// carries is what the feed subscribes to. `origin` selects the retrieval path:
//   - 'outbox' → NAP-OUTBOX discovery (NIP-65 author-write relays)
//   - 'relay'  → NAP-RELAYS scoped subscriptions to `relays` (the saved nfeed relay set)
//
// Shared home is @hyprgate/types so the feed napplet, the shell intent path, and
// the feed-builder invoker all reference one type (anti-drift).

import type { NostrFilter } from './protocol.js';

/** How a FeedIntentPayload's filters should be routed to relays. */
export type FeedIntentOrigin = 'outbox' | 'relay';

/**
 * The feed wireformat. The feed napplet builds its subscription ENTIRELY from
 * this — there is no hard-coded following/global filter on the payload path.
 *
 * - `filters` — RAW decoded NIP-01 filters (never the bech32 form). Non-empty.
 * - `origin`  — 'outbox' (discovery) or 'relay' (exact pin).
 * - `relays`  — required + non-empty when `origin === 'relay'`; the feed opens
 *   scoped NAP-RELAYS subscriptions to these. Absent/ignored for `origin === 'outbox'`.
 * - `title`   — optional display title (e.g. the saved entity's identifier).
 * - `savedEntityAddress` — optional kind-39823 address for shell-owned live
 *   refresh of windows using a saved feed/filter.
 */
export interface FeedIntentPayload {
  filters: NostrFilter[];
  origin: FeedIntentOrigin;
  relays?: string[];
  title?: string;
  savedEntityAddress?: string;
}
