import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { appCurationRefsFromEvent } from './app-store-curation.js';
import { KIND_APP_CURATION_SET, KIND_SOFTWARE_APPLICATION } from './nip-constants.js';

const PUBKEY = 'a'.repeat(64);
const APP_PUBKEY = 'b'.repeat(64);

function event(kind: number, tags: string[][]): NostrEvent {
  return {
    id: `${kind}`.padStart(64, '0'),
    pubkey: PUBKEY,
    created_at: 1,
    kind,
    tags,
    content: '',
    sig: 's',
  };
}

describe('appCurationRefsFromEvent', () => {
  it('returns no refs for non-App-curation events', () => {
    expect(appCurationRefsFromEvent(event(30000, [
      ['a', `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:demo`],
    ]))).toEqual([]);
  });

  it('preserves original order among all a tags for valid software application refs', () => {
    const refs = appCurationRefsFromEvent(event(KIND_APP_CURATION_SET, [
      ['a', 'malformed'],
      ['a', `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:first`],
      ['p', APP_PUBKEY],
      ['a', `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:second`],
    ]));

    expect(refs).toEqual([
      {
        address: `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:first`,
        kind: KIND_SOFTWARE_APPLICATION,
        pubkey: APP_PUBKEY,
        dTag: 'first',
        relays: [],
        order: 1,
      },
      {
        address: `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:second`,
        kind: KIND_SOFTWARE_APPLICATION,
        pubkey: APP_PUBKEY,
        dTag: 'second',
        relays: [],
        order: 2,
      },
    ]);
  });

  it('keeps only ws and wss relay hints', () => {
    expect(appCurationRefsFromEvent(event(KIND_APP_CURATION_SET, [
      ['a', `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:demo`, 'wss://relay.example', 'https://bad.example', 'ws://localhost:9392'],
    ]))).toEqual([
      {
        address: `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:demo`,
        kind: KIND_SOFTWARE_APPLICATION,
        pubkey: APP_PUBKEY,
        dTag: 'demo',
        relays: ['wss://relay.example', 'ws://localhost:9392'],
        order: 0,
      },
    ]);
  });

  it('skips malformed refs and non-software-application refs without throwing', () => {
    expect(appCurationRefsFromEvent(event(KIND_APP_CURATION_SET, [
      ['a', 'not-an-address'],
      ['a', `31990:${APP_PUBKEY}:handler`],
      ['a', `${KIND_SOFTWARE_APPLICATION}:short:demo`],
      ['a', `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:valid`],
    ]))).toEqual([
      {
        address: `${KIND_SOFTWARE_APPLICATION}:${APP_PUBKEY}:valid`,
        kind: KIND_SOFTWARE_APPLICATION,
        pubkey: APP_PUBKEY,
        dTag: 'valid',
        relays: [],
        order: 3,
      },
    ]);
  });
});
