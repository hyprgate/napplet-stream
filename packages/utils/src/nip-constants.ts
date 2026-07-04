// Re-export kind constants from @hyprgate/types for convenience
// All kind numbers MUST come from @hyprgate/types/napp-spec — never use raw integers
export {
  KIND_NSITE_MANIFEST,
  KIND_NSITE_INDEX,
  KIND_NAPP_LISTING,
  KIND_METADATA,
  KIND_NOTE,
  KIND_CONTACTS,
  KIND_DELETION,
  KIND_REPORT,
  KIND_REPOST,
  KIND_REACTION,
  KIND_GENERIC_REPOST,
  KIND_ZAP_REQUEST,
  KIND_ZAP_RECEIPT,
  KIND_RELAY_LIST,
  // NIP-51 replaceable lists
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
  // NIP-51 addressable sets
  KIND_FOLLOW_SETS,
  KIND_GENERIC_LISTS,
  KIND_RELAY_SETS,
  KIND_BOOKMARK_SETS,
  KIND_CURATION_SETS,
  KIND_VIDEO_CURATION_SETS,
  KIND_INTEREST_SETS,
  KIND_EMOJI_SETS,
  KIND_RELEASE_ARTIFACT_SETS,
  KIND_FOLLOW_PACK,
  NAPP_SPEC_REVISION,
  // Canonical destructive-kind gate set (Set<number>) — single source of truth
  // lives in @hyprgate/types/protocol. Re-exported here so utils consumers do not
  // re-declare a divergent literal array (the previous shadow constant drifted
  // out of sync with the protocol Set).
  DESTRUCTIVE_KINDS,
} from '@hyprgate/types';
