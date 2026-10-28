import { describe, expect, it } from 'vitest';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { nappletCatalogTarget, nappletCatalogTargetFromReference, parseNappletCatalogAddress } from './napplet-catalog.js';

const key = new Uint8Array(32).fill(1);
const author = getPublicKey(key);
const root = `15129:${author}:`;
const named = `35129:${author}:reader`;

describe('catalog provenance', () => {
  it('keeps root and named coordinates distinct', () => {
    expect(parseNappletCatalogAddress(root)).toMatchObject({ kind: 15129, dTag: '' });
    expect(parseNappletCatalogAddress(named)).toMatchObject({ kind: 35129, dTag: 'reader' });
    expect(parseNappletCatalogAddress(`5129:${author}:`)).toBeNull();
    expect(parseNappletCatalogAddress(`15129:${author}:reader`)).toBeNull();
    expect(nappletCatalogTargetFromReference(nip19.naddrEncode({ kind: 15129, pubkey: author, identifier: '' }))?.address).toBe(root);
  });

  it('prefers immediate parent, falls back to root, and does not invent lineage', () => {
    const snapshot = (tags: string[][]) => finalizeEvent({ kind: 5129, created_at: 1, content: 'Reader version', tags: [['x', 'a'.repeat(64)], ...tags] }, key);
    expect(nappletCatalogTarget(snapshot([['a', named], ['A', root]]))?.address).toBe(named);
    expect(nappletCatalogTarget(snapshot([['A', root]]))?.address).toBe(root);
    expect(nappletCatalogTarget(snapshot([]))).toBeNull();
  });
});
