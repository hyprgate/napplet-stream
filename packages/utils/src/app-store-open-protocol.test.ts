import { describe, expect, it } from 'vitest';
import {
  APP_OPEN_TOPIC,
  createAppOpenIntentRequest,
  parseAppOpenIntentResult,
  parseAppOpenPayload,
} from './app-store-open-protocol.js';
import type { IntentRequest as PublicIntentRequest, IntentResult as PublicIntentResult } from '@napplet/nap/intent';

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

  it('builds an archetype-led request and preserves an explicit unhandled result', () => {
    const request = createAppOpenIntentRequest('feed', { dTag: 'feed' }, { behavior: { newWindow: true } });
    expect(request).toEqual({
      archetype: 'feed',
      payload: { dTag: 'feed' },
      behavior: { newWindow: true },
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
    expect(result).toMatchObject({ archetype: 'feed', action: 'open', handled: false });
    const publicResult: PublicIntentResult = result!;
    expect(publicResult.handled).toBe(false);
    expect(parseAppOpenIntentResult({ ok: false, archetype: 'feed', handled: false })).toBeNull();
  });
});
