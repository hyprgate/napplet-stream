import type { NostrEvent } from '@hyprgate/types';
import { nip19 } from 'nostr-tools';

export interface NappletCatalogTarget {
  address: string;
  kind: 15129 | 35129;
  pubkey: string;
  dTag: string;
}

export function parseNappletCatalogAddress(address: string | undefined): NappletCatalogTarget | null {
  if (!address) return null;
  const [kindText, pubkey, ...identifier] = address.split(':');
  const kind = Number(kindText);
  const dTag = identifier.join(':');
  if (String(kind) !== kindText || !/^[0-9a-f]{64}$/.test(pubkey ?? '') || identifier.length === 0
    || (kind !== 15129 && kind !== 35129)
    || (kind === 15129 ? dTag !== '' : !dTag)) return null;
  return { address, kind, pubkey: pubkey!, dTag };
}

/** Catalog grouping only. Lineage never supplies a runtime principal or artifact. */
export function nappletCatalogTarget(event: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags'>): NappletCatalogTarget | null {
  if (event.kind === 5129) {
    for (const name of ['a', 'A']) {
      const tags = event.tags.filter((tag) => tag[0] === name);
      if (tags.length !== 1) continue;
      const target = parseNappletCatalogAddress(tags[0]?.[1]);
      if (target) return target;
    }
    return null;
  }
  const dTags = event.tags.filter((tag) => tag[0] === 'd');
  if (event.kind === 15129 && dTags.length !== 0) return null;
  if (event.kind === 35129 && dTags.length !== 1) return null;
  return parseNappletCatalogAddress(`${event.kind}:${event.pubkey}:${dTags[0]?.[1] ?? ''}`);
}

export function nappletCatalogTargetFromReference(reference: string | undefined): NappletCatalogTarget | null {
  if (!reference) return null;
  try {
    const decoded = nip19.decode(reference);
    return decoded.type === 'naddr'
      ? parseNappletCatalogAddress(`${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`)
      : null;
  } catch {
    return null;
  }
}
