import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  NAPPLET_INSTALL_QUERY_PARAM,
  createNappletInstallLink,
  nappletInstallReferenceFromSearch,
  parseNappletInstallReference,
} from './napplet-install-link.js';

const PUBKEY = 'a'.repeat(64);
const EVENT_ID = 'b'.repeat(64);

describe('napplet install links', () => {
  it('accepts named naddr and snapshot nevent references', () => {
    const naddr = nip19.naddrEncode({ kind: 35129, pubkey: PUBKEY, identifier: 'reader', relays: ['wss://relay.example'] });
    const nevent = nip19.neventEncode({ id: EVENT_ID, author: PUBKEY, kind: 5129, relays: ['wss://relay.example'] });

    expect(parseNappletInstallReference(naddr)).toMatchObject({ type: 'naddr', kind: 35129, identifier: 'reader' });
    expect(parseNappletInstallReference(nevent)).toMatchObject({ type: 'nevent', kind: 5129, eventId: EVENT_ID });
  });

  it('rejects other naddr and nevent kinds', () => {
    expect(parseNappletInstallReference(nip19.naddrEncode({ kind: 35128, pubkey: PUBKEY, identifier: 'site' }))).toBeNull();
    expect(parseNappletInstallReference(nip19.neventEncode({ id: EVENT_ID, author: PUBKEY, kind: 35129 }))).toBeNull();
  });

  it('creates and parses a clean shell install URL', () => {
    const reference = nip19.naddrEncode({ kind: 35129, pubkey: PUBKEY, identifier: 'reader' });
    const link = createNappletInstallLink(reference, 'https://hyprgate.example/workspace?debug=1#old');
    expect(link).toBe(`https://hyprgate.example/workspace?${NAPPLET_INSTALL_QUERY_PARAM}=${reference}`);
    expect(nappletInstallReferenceFromSearch(new URL(link!).search)?.reference).toBe(reference);
  });

  it('rejects ambiguous duplicate install parameters', () => {
    const reference = nip19.naddrEncode({ kind: 35129, pubkey: PUBKEY, identifier: 'reader' });
    expect(nappletInstallReferenceFromSearch(`?${NAPPLET_INSTALL_QUERY_PARAM}=${reference}&${NAPPLET_INSTALL_QUERY_PARAM}=${reference}`)).toBeNull();
  });
});
