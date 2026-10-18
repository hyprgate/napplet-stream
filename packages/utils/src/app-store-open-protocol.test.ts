import { describe, expect, it } from 'vitest';
import {
  APP_OPEN_TOPIC,
  createAppOpenIntentRequest,
  parseAppOpenIntentResult,
  parseAppOpenPayload,
} from './app-store-open-protocol.js';
import type { IntentRequest as PublicIntentRequest } from '@napplet/nap/intent';

describe('app store open protocol', () => {
  it('defines the shell-routed app open topic', () => {
    expect(APP_OPEN_TOPIC).toBe('app:open');
  });

  it('normalizes valid app open payloads', () => {
    expect(parseAppOpenPayload({
      dTag: 'feed',
      title: ' Feed ',
      class: 'feed',
      component: '',
      author: 'A'.repeat(64),
      relays: [' wss://relay.example ', 'http://bad.example', 'wss://relay.example'],
      source: 'app-store',
    })).toEqual({
      dTag: 'feed',
      title: 'Feed',
      class: 'feed',
      author: 'a'.repeat(64),
      relays: ['wss://relay.example'],
      source: 'app-store',
    });
  });

  it('rejects missing and unsafe routing identifiers', () => {
    expect(parseAppOpenPayload({ title: 'Feed' })).toBeNull();
    expect(parseAppOpenPayload({ dTag: '../feed' })).toBeNull();
    expect(parseAppOpenPayload({ dTag: 'feed', component: '../settings' })).toBeNull();
    expect(parseAppOpenPayload({ dTag: 'feed', author: 'not-a-pubkey' })).toBeNull();
  });

  it('builds an archetype-led request and preserves a pre-acceptance failure', () => {
    const request = createAppOpenIntentRequest('feed', { dTag: 'feed' }, { behavior: { reuse: false } });
    expect(request).toEqual({
      archetype: 'feed',
      action: 'open',
      convention: 'napplet:feed/open',
      payload: { dTag: 'feed' },
      behavior: { reuse: false },
    });
    const publicRequest: PublicIntentRequest = request!;
    expect(publicRequest.archetype).toBe('feed');
    expect(createAppOpenIntentRequest('', { dTag: 'feed' })).toBeNull();
    expect(createAppOpenIntentRequest('feed', { dTag: '../feed' })).toBeNull();
    const result = parseAppOpenIntentResult({
      ok: false,
      archetype: 'feed',
      action: 'open',
      handled: false,
      error: 'no handler',
    });
    expect(result).toEqual({ ok: false, error: 'no handler' });
    expect(parseAppOpenIntentResult({ ok: true })).toEqual({ ok: true });
    expect(parseAppOpenIntentResult({ ok: false, archetype: 'feed', handled: false })).toBeNull();
  });
});
