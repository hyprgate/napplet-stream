export interface PublicKeyIdentityClient {
  getPublicKey(): Promise<string | null | undefined>;
  onChanged?: (handler: (pubkey: string) => void) => { close(): void };
}

export interface WaitForPublicKeyOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  isValidPubkey?: (pubkey: string) => boolean;
  onError?: (error: unknown) => void;
}

const DEFAULT_INTERVAL_MS = 300;

function isUsablePubkey(pubkey: unknown, isValidPubkey?: (pubkey: string) => boolean): pubkey is string {
  return typeof pubkey === 'string'
    && pubkey.length > 0
    && (isValidPubkey ? isValidPubkey(pubkey) : true);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function subscribeToIdentityChanges(
  identity: PublicKeyIdentityClient,
  onChange: () => void,
): { close(): void } | null {
  if (typeof identity.onChanged !== 'function') return null;
  try {
    return identity.onChanged(() => onChange());
  } catch {
    return null;
  }
}

export async function waitForPublicKey(
  identity: PublicKeyIdentityClient,
  options: WaitForPublicKeyOptions = {},
): Promise<string | null> {
  const intervalMs = Math.max(1, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const startedAt = Date.now();
  let attempts = 0;
  const identityChangeWaiters = new Set<() => void>();
  const identityChangeSub = subscribeToIdentityChanges(identity, () => {
    for (const resolve of identityChangeWaiters) resolve();
  });

  const waitForRetry = (ms: number): Promise<void> => {
    if (options.signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let timeout: number | null = null;
      const finish = () => {
        if (timeout !== null) window.clearTimeout(timeout);
        identityChangeWaiters.delete(finish);
        resolve();
      };
      identityChangeWaiters.add(finish);
      timeout = window.setTimeout(finish, ms);
      options.signal?.addEventListener('abort', finish, { once: true });
    });
  };

  try {
    while (!options.signal?.aborted) {
      attempts++;
      try {
        const pubkey = await identity.getPublicKey();
        if (isUsablePubkey(pubkey, options.isValidPubkey)) return pubkey;
      } catch (error) {
        options.onError?.(error);
      }

      if (options.maxAttempts !== undefined && attempts >= options.maxAttempts) return null;
      if (options.timeoutMs !== undefined) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= options.timeoutMs) return null;
        await waitForRetry(Math.min(intervalMs, options.timeoutMs - elapsed));
      } else if (identityChangeSub) {
        await waitForRetry(intervalMs);
      } else {
        await wait(intervalMs, options.signal);
      }
    }

    return null;
  } finally {
    identityChangeSub?.close();
    identityChangeWaiters.clear();
  }
}
