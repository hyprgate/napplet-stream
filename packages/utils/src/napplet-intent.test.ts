import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIntentRequest } from '@hyprgate/types';
import { invokeNappletIntent } from './napplet-intent.js';

afterEach(() => vi.unstubAllGlobals());

describe('public SDK intent requests', () => {
  it('uses the convention URI and invoke options against the injected domain', async () => {
    const handler = `nip5d:35129:${'a'.repeat(64)}:profile`;
    const accepted = { ok: true, archetype: 'profile', action: 'open', convention: 'napplet:profile/open', handler };
    const invoke = vi.fn(async () => accepted);
    vi.stubGlobal('window', { napplet: { intent: { invoke } } });
    const request = createIntentRequest({ archetype: 'profile', payload: { pubkey: 'b'.repeat(64) },
      behavior: { reuse: false, focus: true }, handler,
    })!;
    await expect(invokeNappletIntent(request)).resolves.toEqual(accepted);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('napplet:profile/open', {
      payload: request.payload, handler, behavior: { reuse: false, focus: true },
    });
  });

  it('preserves absent payloads and returns pre-acceptance failures', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: 'no handler' }));
    vi.stubGlobal('window', { napplet: { intent: { invoke } } });
    await expect(invokeNappletIntent(createIntentRequest({ archetype: 'profile' })!))
      .resolves.toEqual({ ok: false, error: 'no handler' });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('napplet:profile/open', {});
  });
});
