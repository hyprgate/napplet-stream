import { describe, expect, it } from 'vitest';
import {
  APP_REGISTRY_RESULT_TOPIC,
  APP_REGISTRY_SET_DEFAULT_TOPIC,
  APP_REGISTRY_SNAPSHOT_TOPIC,
  normalizeAppRegistrySnapshot,
  parseAppRegistryEnabledPayload,
  parseAppRegistrySetDefaultPayload,
} from './app-registry-protocol.js';

describe('app registry protocol', () => {
  it('defines local shell registry topics', () => {
    expect(APP_REGISTRY_SNAPSHOT_TOPIC).toBe('app-registry:snapshot');
    expect(APP_REGISTRY_SET_DEFAULT_TOPIC).toBe('app-registry:set-default');
    expect(APP_REGISTRY_RESULT_TOPIC).toBe('app-registry:result');
  });

  it('normalizes registry snapshots for app-facing DTOs', () => {
    expect(normalizeAppRegistrySnapshot({
      actions: [{
        key: 'feed',
        label: ' Feed ',
        enabled: true,
        defaultAppId: 'builtin:feed',
        apps: ['builtin:feed', '../bad'],
      }],
      apps: [{
        id: 'builtin:feed',
        title: ' Feed ',
        dTag: 'feed',
        author: 'a'.repeat(64),
        relayHints: [' wss://relay.example ', ''],
        source: 'bundled',
        reference: 'naddr1feed',
        referenceType: 'naddr',
        enabled: true,
        available: true,
        actions: ['open'],
        routeKeys: ['feed'],
      }],
    })).toEqual({
      actions: [{
        key: 'feed',
        label: 'Feed',
        enabled: true,
        defaultAppId: 'builtin:feed',
        apps: ['builtin:feed'],
      }],
      apps: [{
        id: 'builtin:feed',
        title: 'Feed',
        dTag: 'feed',
        author: 'a'.repeat(64),
        relayHints: ['wss://relay.example'],
        source: 'bundled',
        reference: 'naddr1feed',
        referenceType: 'naddr',
        enabled: true,
        available: true,
        actions: ['open'],
        routeKeys: ['feed'],
      }],
    });
  });

  it('rejects malformed mutation payloads', () => {
    expect(parseAppRegistrySetDefaultPayload({ routeKey: 'feed', appId: 'builtin:feed' })).toEqual({
      routeKey: 'feed',
      appId: 'builtin:feed',
    });
    expect(parseAppRegistrySetDefaultPayload({ routeKey: '../feed', appId: 'builtin:feed' })).toBeNull();
    expect(parseAppRegistryEnabledPayload({ key: 'builtin:feed', enabled: false })).toEqual({
      key: 'builtin:feed',
      enabled: false,
    });
    expect(parseAppRegistryEnabledPayload({ key: 'builtin:feed', enabled: 'false' })).toBeNull();
  });
});
