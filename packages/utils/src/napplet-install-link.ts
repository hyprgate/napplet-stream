import { nip19 } from 'nostr-tools';
import { KIND_NIP5D_NAMED, KIND_NIP5D_SNAPSHOT } from './nip-constants.js';

export const NAPPLET_INSTALL_QUERY_PARAM = 'install-napplet';

export interface NappletInstallReference {
  reference: string;
  type: 'naddr' | 'nevent';
  kind: typeof KIND_NIP5D_NAMED | typeof KIND_NIP5D_SNAPSHOT;
  pubkey?: string;
  identifier?: string;
  eventId?: string;
  relays: string[];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Accept only share references that the install surface can resolve unambiguously. */
export function parseNappletInstallReference(raw: string): NappletInstallReference | null {
  const reference = raw.trim();
  if (!reference || reference.length > 2048) return null;
  try {
    const decoded = nip19.decode(reference);
    if (decoded.type === 'naddr' && decoded.data.kind === KIND_NIP5D_NAMED) {
      return {
        reference,
        type: 'naddr',
        kind: KIND_NIP5D_NAMED,
        pubkey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
        relays: uniqueStrings(decoded.data.relays ?? []),
      };
    }
    if (decoded.type === 'nevent' && decoded.data.kind === KIND_NIP5D_SNAPSHOT) {
      return {
        reference,
        type: 'nevent',
        kind: KIND_NIP5D_SNAPSHOT,
        eventId: decoded.data.id,
        ...(decoded.data.author ? { pubkey: decoded.data.author } : {}),
        relays: uniqueStrings(decoded.data.relays ?? []),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function nappletInstallReferenceFromSearch(search: string): NappletInstallReference | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const values = params.getAll(NAPPLET_INSTALL_QUERY_PARAM);
  return values.length === 1 ? parseNappletInstallReference(values[0] ?? '') : null;
}

/** Build a clean shell URL that opens the runtime-owned install confirmation page. */
export function createNappletInstallLink(reference: string, baseUrl: string): string | null {
  const parsed = parseNappletInstallReference(reference);
  if (!parsed) return null;
  try {
    const url = new URL(baseUrl);
    url.search = '';
    url.hash = '';
    url.searchParams.set(NAPPLET_INSTALL_QUERY_PARAM, parsed.reference);
    return url.toString();
  } catch {
    return null;
  }
}
