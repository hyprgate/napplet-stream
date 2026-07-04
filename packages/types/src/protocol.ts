// packages/types/src/protocol.ts
// NIP-01 wire protocol types for the hyprgate shell pseudo-relay.
// All messages crossing the iframe/shell boundary use NIP-01 relay wire format.

// Phase 4 (ID-01): Capability type now re-exported from @kehto/acl (canonical NIP-5D surface).
// @kehto/acl's Capability is a string union of NUB domain caps (relay:read, identity:read, etc.)
// Note: @kehto/acl does NOT include sign:event/sign:nip04/sign:nip44 — those were removed in NIP-5D
// (signing flows through shell-internal relay.publishEncrypted). The hyprgate-local ALL_CAPABILITY_LABELS
// constant KEEPS the v1.x sign:* labels for legacy UI display until napplet conversion completes.
export type { Capability } from '@kehto/acl';

import {
  KIND_METADATA,
  KIND_CONTACTS,
  KIND_DELETION,
  KIND_REPORT,
  KIND_RELAY_LIST,
  KIND_MUTE_LIST,
  KIND_PINNED_NOTES,
  KIND_BOOKMARKS_LIST,
  KIND_COMMUNITIES_LIST,
  KIND_PUBLIC_CHATS_LIST,
  KIND_BLOCKED_RELAYS,
  KIND_SEARCH_RELAYS,
  KIND_SIMPLE_GROUPS_LIST,
  KIND_INTERESTS_LIST,
  KIND_USER_EMOJI_LIST,
  KIND_FOLLOW_SETS,
  KIND_GENERIC_LISTS,
  KIND_RELAY_SETS,
  KIND_BOOKMARK_SETS,
  KIND_CURATION_SETS,
  KIND_VIDEO_CURATION_SETS,
  KIND_INTEREST_SETS,
  KIND_EMOJI_SETS,
  KIND_RELEASE_ARTIFACT_SETS,
} from './napp-spec.js';

export const PROTOCOL_VERSION = '2.0.0' as const;

/** NIP-42 authentication event kind. */
export const AUTH_KIND = 22242 as const;

/** The pseudo-relay URI used in NIP-42 AUTH challenges. */
export const PSEUDO_RELAY_URI = 'hyprgate://shell' as const;

/** Replay protection window in seconds — events older than this are rejected. */
export const REPLAY_WINDOW_SECONDS = 30 as const;

/**
 * Signing kinds that ALWAYS prompt the user regardless of ACL level.
 *
 * Covers the high-stakes core kinds (profile 0, contacts 3, deletion 5,
 * report/moderation 1984, relay list 10002) plus the full NIP-51 list/set
 * surface. Every NIP-51 replaceable list and addressable set is a destructive
 * overwrite of a user-curated collection — adding/removing entries on a single
 * (pubkey, kind[, d-tag]) coordinate — so all are gated for explicit consent.
 *
 * Sourced from named constants in napp-spec.ts (no raw integers) so the gated
 * set and the consent-renderer registry share one kind vocabulary.
 *
 * Gating decisions:
 *  - 30030 (emoji sets) IS gated even though the emoji-manager napplet publishes
 *    it: it is a destructive overwrite of a user-owned addressable set.
 *  - 39089 (follow packs / starter packs) is NOT gated. Unlike the NIP-51 lists,
 *    follow packs are content authored as discrete shareable artifacts (the
 *    follow-pack napplet publishes many distinct d-tags), not a single canonical
 *    user collection being replaced. Prompting on every pack publish would make
 *    that napplet unusable. Revisit if follow packs become a single-instance
 *    user list.
 */
export const DESTRUCTIVE_KINDS = new Set<number>([
  KIND_METADATA,            // 0    — profile replacement
  KIND_CONTACTS,            // 3    — contact list overwrite
  KIND_DELETION,            // 5    — event deletion
  KIND_REPORT,              // 1984 — NIP-56 moderation signal
  KIND_RELAY_LIST,          // 10002 — NIP-65 relay list overwrite
  // NIP-51 replaceable lists
  KIND_MUTE_LIST,           // 10000
  KIND_PINNED_NOTES,        // 10001
  KIND_BOOKMARKS_LIST,      // 10003
  KIND_COMMUNITIES_LIST,    // 10004
  KIND_PUBLIC_CHATS_LIST,   // 10005
  KIND_BLOCKED_RELAYS,      // 10006
  KIND_SEARCH_RELAYS,       // 10007
  KIND_SIMPLE_GROUPS_LIST,  // 10009
  KIND_INTERESTS_LIST,      // 10015
  KIND_USER_EMOJI_LIST,     // 10030
  // NIP-51 addressable sets
  KIND_FOLLOW_SETS,         // 30000
  KIND_GENERIC_LISTS,       // 30001 (deprecated)
  KIND_RELAY_SETS,          // 30002
  KIND_BOOKMARK_SETS,       // 30003
  KIND_CURATION_SETS,       // 30004
  KIND_VIDEO_CURATION_SETS, // 30005
  KIND_INTEREST_SETS,       // 30015
  KIND_EMOJI_SETS,          // 30030
  KIND_RELEASE_ARTIFACT_SETS, // 30063
]);

/**
 * Ephemeral event kinds (29000-29999) used for hyprgate bus messages.
 * Ephemeral events are auto-discarded by real relays per NIP-01 spec — perfect
 * for bus traffic that should never persist beyond the pseudo-relay.
 */
export const BusKind = {
  REGISTRATION: 29000,
  SIGNER_REQUEST: 29001,
  SIGNER_RESPONSE: 29002,
  INTER_PANE: 29003,
  HOTKEY_FORWARD: 29004,
  METADATA: 29005,
  NIPDB_REQUEST: 29006,
  NIPDB_RESPONSE: 29007,
} as const;

export type BusKindValue = (typeof BusKind)[keyof typeof BusKind];

/**
 * Hyprgate-local capability label list for UI display.
 *
 * NOTE: This intentionally diverges from @kehto/acl's Capability type.
 * @kehto/acl (NIP-5D v0.1.0) removed sign:event/sign:nip04/sign:nip44 — signing
 * flows through shell-internal relay.publishEncrypted. These string labels are kept
 * here for legacy ACL settings UI display until all built-ins are converted to napplets
 * in Phases 7–9. After napplet conversion, remove sign:* entries.
 *
 * Renamed from ALL_CAPABILITIES to ALL_CAPABILITY_LABELS to signal divergence.
 * @deprecated Use ALL_CAPABILITY_LABELS. This alias will be removed when Plans 04-03/04-04/04-05
 *             update all consumers (AclSection.svelte, pseudo-relay.ts) to use ALL_CAPABILITY_LABELS.
 */
export const ALL_CAPABILITY_LABELS: readonly string[] = [
  'relay:read',
  'relay:write',
  'cache:read',
  'cache:write',
  'hotkey:forward',
  'sign:event',
  'sign:nip04',
  'sign:nip44',
  'storage:read',
  'storage:write',
] as const;

/** Standard NIP-01 nostr event. */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** NIP-01 subscription filter. */
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: string[] | undefined;
}

export type ClientEventMessage = ['EVENT', NostrEvent];
export type ClientReqMessage = ['REQ', string, ...NostrFilter[]];
export type ClientCloseMessage = ['CLOSE', string];
export type ClientAuthMessage = ['AUTH', NostrEvent];
export type ClientCountMessage = ['COUNT', string, ...NostrFilter[]];

export type ClientMessage =
  | ClientEventMessage
  | ClientReqMessage
  | ClientCloseMessage
  | ClientAuthMessage
  | ClientCountMessage;

export type RelayEventMessage = ['EVENT', string, NostrEvent];
export type RelayOkMessage = ['OK', string, boolean, string];
export type RelayEoseMessage = ['EOSE', string];
export type RelayClosedMessage = ['CLOSED', string, string];
export type RelayAuthMessage = ['AUTH', string];
export type RelayNoticeMessage = ['NOTICE', string];
export type RelayCountMessage = ['COUNT', string, { count: number }];

export type RelayMessage =
  | RelayEventMessage
  | RelayOkMessage
  | RelayEoseMessage
  | RelayClosedMessage
  | RelayAuthMessage
  | RelayNoticeMessage
  | RelayCountMessage;

// AclEntry interface REMOVED (Phase 4 ID-01). Use @kehto/acl's AclEntry directly.
// AclEntry was: { pubkey: string; capabilities: Capability[]; blocked: boolean; storageQuota?: number; }
// @kehto/acl AclEntry is: { readonly caps: number; readonly blocked: boolean; readonly quota: number; }

/**
 * Backward-compatible alias for ALL_CAPABILITY_LABELS.
 * @deprecated Use ALL_CAPABILITY_LABELS directly. Removed after Plans 04-03/04-04/04-05
 *             update AclSection.svelte and pseudo-relay.ts.
 */
export const ALL_CAPABILITIES = ALL_CAPABILITY_LABELS;
