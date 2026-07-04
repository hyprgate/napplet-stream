// packages/utils/src/nsfw.ts
// Shared detection for NSFW-tagged Nostr events.

import type { NostrEvent } from '@hyprgate/types';

/**
 * Whether an event is marked NSFW. On Nostr this is conventionally a `t`
 * (hashtag) tag with the value `nsfw` (case-insensitive, with or without a
 * leading `#`). Used to filter adult content out by default.
 */
export function hasNsfwTag(event: Pick<NostrEvent, 'tags'>): boolean {
  return event.tags.some(
    (tag) => tag[0] === 't' && tag[1]?.trim().replace(/^#+/, '').toLowerCase() === 'nsfw',
  );
}
