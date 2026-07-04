// feed-builtins.ts — built-in feed payload synthesis (Phase 89, Plan 01).
//
// The shell chrome offers three quick built-ins alongside the saved-entity
// library: Following, Global, and a #tag quick filter (D-02). Each maps to a
// FeedIntentPayload using the EXACT shapes the feed napplet's feed-engine
// synthesizes (CONTEXT §specifics, authoritative) — anti-drift, so the chrome
// path and the napplet's backward-compat default produce identical subscriptions.
//
// Following with no loaded follows must remain a valid degenerate feed, NOT
// drift into Global. Some downstream routers/relays normalize empty arrays, so
// the chrome path uses an impossible pubkey sentinel instead of authors: [].

import type { FeedIntentPayload } from '@hyprgate/types';

const EMPTY_FOLLOWING_AUTHOR = '0'.repeat(64);

/** A built-in feed selection. */
export type BuiltinFeedSpec =
  | { kind: 'following'; follows: string[] }
  | { kind: 'global' }
  | { kind: 'tag'; tag: string };

/**
 * Synthesize the FeedIntentPayload for a built-in selection. Shapes mirror
 * napplets/feed/src/lib/feed-engine.ts VERBATIM:
 *   - Following → { filters:[{kinds:[1],authors:<follows>}], origin:'outbox', title:'Following' }
 *   - Global    → { filters:[{kinds:[1]}],                   origin:'outbox', title:'Global' }
 *   - #tag      → { filters:[{kinds:[1],'#t':[tag]}],        origin:'outbox', title:`#${tag}` }
 */
export function buildBuiltinFeedPayload(spec: BuiltinFeedSpec): FeedIntentPayload {
  switch (spec.kind) {
    case 'following':
      return {
        filters: [{ kinds: [1], authors: spec.follows.length > 0 ? spec.follows : [EMPTY_FOLLOWING_AUTHOR] }],
        origin: 'outbox',
        title: 'Following',
      };
    case 'global':
      return {
        filters: [{ kinds: [1] }],
        origin: 'outbox',
        title: 'Global',
      };
    case 'tag':
      return {
        filters: [{ kinds: [1], '#t': [spec.tag] }],
        origin: 'outbox',
        title: `#${spec.tag}`,
      };
  }
}
