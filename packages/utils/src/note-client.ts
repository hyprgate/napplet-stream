// packages/utils/src/note-client.ts
// Shared reader for the NIP-89 `client` tag on a Nostr event.

import type { NostrEvent } from '@hyprgate/types';
import { nip19 } from 'nostr-tools';

export const HYPRGATE_CLIENT_NAME = 'hyprgate';

export interface HyprgateClientTagPointerInput {
  id?: string;
  kind?: number;
  pubkey?: string;
  dTag?: string;
  identifier?: string;
  relays?: readonly string[];
}

/**
 * Read the NIP-89 `client` tag value (the publishing app's name) from an event.
 *
 * The tag shape is `["client", "<app name>", ...optional <31990:pubkey:d> / relay]`.
 * Returns the trimmed display name (tag index 1) when present and non-empty,
 * otherwise null.
 */
export function clientTagValue(event: Pick<NostrEvent, 'tags'>): string | null {
  const tag = event.tags.find((t) => t[0] === 'client');
  const value = tag?.[1]?.trim();
  return value ? value : null;
}

export function createHyprgateClientTag(input?: HyprgateClientTagPointerInput | null): string[] {
  const pointer = input ? hyprgateClientTagPointer(input) : null;
  return pointer ? ['client', HYPRGATE_CLIENT_NAME, pointer] : ['client', HYPRGATE_CLIENT_NAME];
}

export function hyprgateClientTagPointer(input: HyprgateClientTagPointerInput): string | null {
  const relays = uniqueRelays(input.relays);
  const identifier = input.identifier ?? input.dTag;
  if (
    typeof input.kind === 'number'
    && isLowerHex64(input.pubkey)
    && typeof identifier === 'string'
    && identifier.length > 0
  ) {
    return nip19.naddrEncode({
      kind: input.kind,
      pubkey: input.pubkey,
      identifier,
      ...(relays.length > 0 ? { relays } : {}),
    });
  }

  if (isLowerHex64(input.id)) {
    return nip19.neventEncode({
      id: input.id,
      ...(isLowerHex64(input.pubkey) ? { author: input.pubkey } : {}),
      ...(typeof input.kind === 'number' ? { kind: input.kind } : {}),
      ...(relays.length > 0 ? { relays } : {}),
    });
  }

  return null;
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

function isLowerHex64(value: unknown): value is string {
  return typeof value === 'string' && LOWER_HEX_64.test(value);
}

function uniqueRelays(relays: readonly string[] | undefined): string[] {
  return [...new Set((relays ?? []).filter((relay) => relay.length > 0))];
}
