// packages/types/src/napp-spec.ts
// SPEC VERSION: Based on NIP nsite PR#1538 and NIP-C4 PR#2274 as of 2026-03-21.
// UPDATE THIS COMMENT when spec finalizes.
//
// NEVER use raw integer kind literals elsewhere in the codebase.
// All kind references must import from this file.

/** Revision tag for the napp/nsite spec these constants reflect. Update on spec finalization. */
export const NAPP_SPEC_REVISION = 'draft-2026-03-21' as const;

/** Kind for a file hash event (nsite manifest entry). */
export const KIND_NSITE_MANIFEST = 34128;

/** Kind for a path-to-hash manifest (nsite index). Unconfirmed — may change when spec finalizes. */
export const KIND_NSITE_INDEX = 35128;

/** Kind for an app listing event (napp directory entry). */
export const KIND_NAPP_LISTING = 37348;

/** Kind 0: user metadata. */
export const KIND_METADATA = 0;

/** Kind 1: short text note. */
export const KIND_NOTE = 1;

/** Kind 3: contact list / follows. */
export const KIND_CONTACTS = 3;

/** Kind 5: event deletion request. */
export const KIND_DELETION = 5;

/** Kind 6: repost. */
export const KIND_REPOST = 6;

/** Kind 7: reaction. */
export const KIND_REACTION = 7;

/** Kind 16: generic repost. */
export const KIND_GENERIC_REPOST = 16;

/** Kind 9734: NIP-57 zap request. */
export const KIND_ZAP_REQUEST = 9734;

/** Kind 9735: NIP-57 zap receipt. */
export const KIND_ZAP_RECEIPT = 9735;

/** Kind 1984: NIP-56 report — moderation signal about a pubkey/event/blob. */
export const KIND_REPORT = 1984;

/** Kind 10002: relay list metadata (NIP-65). */
export const KIND_RELAY_LIST = 10002;

// ── NIP-51 lists (replaceable, single-instance per user) ─────────────────────
// Verified against the living NIP-51 spec (replaceable lists section).

/** Kind 10000: NIP-51 mute list. */
export const KIND_MUTE_LIST = 10000;

/** Kind 10001: NIP-51 pinned-notes list. */
export const KIND_PINNED_NOTES = 10001;

/** Kind 10003: NIP-51 bookmarks list. */
export const KIND_BOOKMARKS_LIST = 10003;

/** Kind 10004: NIP-51 communities list. */
export const KIND_COMMUNITIES_LIST = 10004;

/** Kind 10005: NIP-51 public-chats list. */
export const KIND_PUBLIC_CHATS_LIST = 10005;

/** Kind 10006: NIP-51 blocked-relays list. */
export const KIND_BLOCKED_RELAYS = 10006;

/** Kind 10007: NIP-51 search-relays list. */
export const KIND_SEARCH_RELAYS = 10007;

/** Kind 10009: NIP-51 simple-groups list. */
export const KIND_SIMPLE_GROUPS_LIST = 10009;

/** Kind 10015: NIP-51 interests list. */
export const KIND_INTERESTS_LIST = 10015;

/** Kind 10030: NIP-51 user emoji list. */
export const KIND_USER_EMOJI_LIST = 10030;

// ── NIP-51 sets (addressable, multiple instances per user, keyed by d-tag) ───

/** Kind 30000: NIP-51 follow sets. */
export const KIND_FOLLOW_SETS = 30000;

/** Kind 30001: NIP-51 generic lists (deprecated, kept for gating completeness). */
export const KIND_GENERIC_LISTS = 30001;

/** Kind 30002: NIP-51 relay sets. */
export const KIND_RELAY_SETS = 30002;

/** Kind 30003: NIP-51 bookmark sets. */
export const KIND_BOOKMARK_SETS = 30003;

/** Kind 30004: NIP-51 article-curation sets. */
export const KIND_CURATION_SETS = 30004;

/** Kind 30005: NIP-51 video-curation sets. */
export const KIND_VIDEO_CURATION_SETS = 30005;

/** Kind 30015: NIP-51 interest sets. */
export const KIND_INTEREST_SETS = 30015;

/** Kind 30030: NIP-51 emoji sets. */
export const KIND_EMOJI_SETS = 30030;

/** Kind 30063: NIP-51 release-artifact sets. */
export const KIND_RELEASE_ARTIFACT_SETS = 30063;

/** Kind 39089: NIP-51 starter pack / follow pack. */
export const KIND_FOLLOW_PACK = 39089;
