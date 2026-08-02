import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import {
  parseDraftAppStoreListingEvent,
  type DraftAppStoreGeneratedReference,
  type DraftAppStoreNip5dReference,
} from './draft-app-store-listing.js';
import {
  KIND_NIP5D_NAMED,
  KIND_NIP5D_ROOT,
  KIND_NIP5D_SNAPSHOT,
  KIND_NOTE,
  KIND_SOFTWARE_APPLICATION,
} from './nip-constants.js';

const PUBLISHER = 'a'.repeat(64);
const APP_PUBKEY = 'b'.repeat(64);
const SNAPSHOT_ID = 'c'.repeat(64);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'd'.repeat(64),
    pubkey: PUBLISHER,
    created_at: 1,
    kind: KIND_SOFTWARE_APPLICATION,
    tags: [
      ['d', 'demo-app'],
      ['name', 'Demo App'],
      ['summary', 'A compact app summary'],
      ['image', 'https://example.test/screenshot.png'],
      ['l', 'productivity'],
      ['a', `${KIND_NIP5D_NAMED}:${APP_PUBKEY}:demo-app`, 'wss://relay.example'],
    ],
    content: 'Long app description.',
    sig: 's',
    ...overrides,
  };
}

describe('parseDraftAppStoreListingEvent', () => {
  it('parses a complete draft listing', () => {
    const parsed = parseDraftAppStoreListingEvent(event());

    expect(parsed).toMatchObject({
      ok: true,
      listing: {
        address: `${KIND_SOFTWARE_APPLICATION}:${PUBLISHER}:demo-app`,
        publisher: PUBLISHER,
        dTag: 'demo-app',
        name: 'Demo App',
        summary: 'A compact app summary',
        description: 'Long app description.',
        screenshots: ['https://example.test/screenshot.png'],
        labels: ['productivity'],
        topics: [],
        provisionalTags: [],
      },
    });
  });

  it('returns typed failures for incomplete listings', () => {
    const parsed = parseDraftAppStoreListingEvent(event({ tags: [['d', 'demo-app']], content: '  ' }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('incomplete-listing');
      expect(parsed.issues).toEqual(expect.arrayContaining([
        'missing-name',
        'missing-summary',
        'missing-description',
        'missing-screenshot',
        'missing-label-or-topic',
        'missing-app-reference',
      ]));
    }
  });

  it('rejects namespace-only labels without a concrete label or topic', () => {
    const parsed = parseDraftAppStoreListingEvent(event({
      tags: [
        ['d', 'demo-app'],
        ['name', 'Demo App'],
        ['summary', 'A compact app summary'],
        ['image', 'https://example.test/screenshot.png'],
        ['L', 'com.hyprgate.category'],
        ['a', `${KIND_NIP5D_NAMED}:${APP_PUBKEY}:demo-app`],
      ],
    }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('incomplete-listing');
      expect(parsed.issues).toContain('missing-label-or-topic');
    }
  });

  it('isolates unknown provisional tags', () => {
    const parsed = parseDraftAppStoreListingEvent(event({
      tags: [
        ['d', 'demo-app'],
        ['name', 'Demo App'],
        ['summary', 'A compact app summary'],
        ['screenshot', 'https://example.test/screenshot.png'],
        ['t', 'tools'],
        ['a', `${KIND_NIP5D_NAMED}:${APP_PUBKEY}:demo-app`],
        ['hyprgate:foo', 'bar'],
      ],
    }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.listing.provisionalTags).toEqual([['hyprgate:foo', 'bar']]);
      expect(parsed.listing.topics).toEqual(['tools']);
    }
  });

  it('parses generated registry references without mixing them into NIP-5D references', () => {
    const parsed = parseDraftAppStoreListingEvent(event({
      tags: [
        ['d', 'settings'],
        ['name', 'Settings'],
        ['summary', 'Configure local preferences'],
        ['screenshot', 'https://example.test/settings.png'],
        ['t', 'tools'],
        ['hyprgate:registry', 'settings'],
      ],
    }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.listing.generatedReferences).toEqual([
        {
          type: 'generated',
          id: 'settings',
          tag: ['hyprgate:registry', 'settings'],
        },
      ] satisfies DraftAppStoreGeneratedReference[]);
      expect(parsed.listing.nip5dReferences).toEqual([]);
      expect(parsed.listing.provisionalTags).toEqual([['hyprgate:registry', 'settings']]);
    }
  });

  it('requires either a NIP-5D or generated registry app reference', () => {
    const parsed = parseDraftAppStoreListingEvent(event({
      tags: [
        ['d', 'demo-app'],
        ['name', 'Demo App'],
        ['summary', 'A compact app summary'],
        ['image', 'https://example.test/screenshot.png'],
        ['l', 'productivity'],
      ],
    }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('incomplete-listing');
      expect(parsed.issues).toContain('missing-app-reference');
    }
  });

  it('parses root, named, and snapshot NIP-5D references', () => {
    const parsed = parseDraftAppStoreListingEvent(event({
      tags: [
        ['d', 'demo-app'],
        ['name', 'Demo App'],
        ['summary', 'A compact app summary'],
        ['image', 'https://example.test/screenshot.png'],
        ['l', 'productivity'],
        ['a', `${KIND_NIP5D_ROOT}:${APP_PUBKEY}:`, 'wss://root.example'],
        ['a', `${KIND_NIP5D_NAMED}:${APP_PUBKEY}:demo-app`, 'wss://named.example'],
        ['e', SNAPSHOT_ID, 'wss://snapshot.example', 'nip5d:snapshot'],
      ],
    }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.listing.nip5dReferences).toEqual([
        {
          type: 'root',
          kind: KIND_NIP5D_ROOT,
          pubkey: APP_PUBKEY,
          relays: ['wss://root.example'],
        },
        {
          type: 'named',
          kind: KIND_NIP5D_NAMED,
          pubkey: APP_PUBKEY,
          dTag: 'demo-app',
          relays: ['wss://named.example'],
        },
        {
          type: 'snapshot',
          kind: KIND_NIP5D_SNAPSHOT,
          eventId: SNAPSHOT_ID,
          relays: ['wss://snapshot.example'],
          marker: 'nip5d:snapshot',
        },
      ] satisfies DraftAppStoreNip5dReference[]);
    }
  });

  it('rejects wrong-kind events', () => {
    expect(parseDraftAppStoreListingEvent(event({ kind: KIND_NOTE }))).toEqual({
      ok: false,
      reason: 'wrong-kind',
      issues: ['expected-kind-32267'],
    });
  });

  it('rejects uppercase or invalid publisher pubkeys', () => {
    expect(parseDraftAppStoreListingEvent(event({ pubkey: PUBLISHER.toUpperCase() }))).toMatchObject({
      ok: false,
      reason: 'invalid-publisher',
    });
    expect(parseDraftAppStoreListingEvent(event({ pubkey: 'short' }))).toMatchObject({
      ok: false,
      reason: 'invalid-publisher',
    });
  });
});
