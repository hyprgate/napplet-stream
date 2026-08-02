import type { NostrEvent } from '@hyprgate/types';
import { KIND_APP_CURATION_SET, KIND_SOFTWARE_APPLICATION } from './nip-constants.js';

export interface AppStoreCurationRef {
  address: string;
  kind: number;
  pubkey: string;
  dTag: string;
  relays: string[];
  order: number;
}

export function appCurationRefsFromEvent(event: NostrEvent): AppStoreCurationRef[] {
  if (event.kind !== KIND_APP_CURATION_SET) return [];

  let order = -1;
  const refs: AppStoreCurationRef[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'a') continue;
    order += 1;
    const ref = parseSoftwareApplicationAddress(tag, order);
    if (ref) refs.push(ref);
  }
  return refs;
}

function parseSoftwareApplicationAddress(tag: string[], order: number): AppStoreCurationRef | null {
  const address = tag[1];
  if (!address) return null;
  const [kindText, pubkey, ...dTagParts] = address.split(':');
  const dTag = dTagParts.join(':');
  if (Number(kindText) !== KIND_SOFTWARE_APPLICATION || !isLowerHex64(pubkey) || !dTag) return null;
  return {
    address,
    kind: KIND_SOFTWARE_APPLICATION,
    pubkey,
    dTag,
    relays: tag.slice(2).filter(isRelayHint),
    order,
  };
}

function isLowerHex64(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isRelayHint(value: string): boolean {
  return value.startsWith('wss://') || value.startsWith('ws://');
}
