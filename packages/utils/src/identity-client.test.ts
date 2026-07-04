import { describe, expect, it, vi } from 'vitest';
import { waitForPublicKey, type PublicKeyIdentityClient } from './identity-client.js';

function clientWithResults(results: Array<string | null | undefined>): PublicKeyIdentityClient {
  const values = [...results];
  return {
    getPublicKey: vi.fn(async () => values.shift() ?? ''),
  };
}

describe('waitForPublicKey', () => {
  it('retries empty identity results until a pubkey is available', async () => {
    const identity = clientWithResults(['', null, 'a'.repeat(64)]);

    await expect(waitForPublicKey(identity, { intervalMs: 1, maxAttempts: 4 })).resolves.toBe('a'.repeat(64));
    expect(identity.getPublicKey).toHaveBeenCalledTimes(3);
  });

  it('returns null when maxAttempts is reached', async () => {
    const identity = clientWithResults(['', '', 'a'.repeat(64)]);

    await expect(waitForPublicKey(identity, { intervalMs: 1, maxAttempts: 2 })).resolves.toBeNull();
    expect(identity.getPublicKey).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying rejected identity requests and reports errors', async () => {
    const error = new Error('not ready');
    const onError = vi.fn();
    const identity: PublicKeyIdentityClient = {
      getPublicKey: vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('b'.repeat(64)),
    };

    await expect(waitForPublicKey(identity, { intervalMs: 1, maxAttempts: 2, onError })).resolves.toBe('b'.repeat(64));
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('honors custom pubkey validation', async () => {
    const identity = clientWithResults(['not-hex', 'c'.repeat(64)]);

    await expect(waitForPublicKey(identity, {
      intervalMs: 1,
      maxAttempts: 2,
      isValidPubkey: (pubkey) => /^[0-9a-f]{64}$/.test(pubkey),
    })).resolves.toBe('c'.repeat(64));
  });

  it('wakes retry attempts from identity.changed when the SDK supports it', async () => {
    const close = vi.fn();
    let onChanged: (pubkey: string) => void = () => {};
    const identity: PublicKeyIdentityClient = {
      getPublicKey: vi.fn()
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('d'.repeat(64)),
      onChanged: vi.fn((handler) => {
        onChanged = handler;
        return { close };
      }),
    };

    const result = waitForPublicKey(identity, { intervalMs: 10_000, maxAttempts: 2 });
    await vi.waitFor(() => expect(identity.getPublicKey).toHaveBeenCalledOnce());
    onChanged('d'.repeat(64));

    await expect(result).resolves.toBe('d'.repeat(64));
    expect(identity.getPublicKey).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
});
