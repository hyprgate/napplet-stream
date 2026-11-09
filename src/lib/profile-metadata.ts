import { outbox, relay, type Subscription } from '@napplet/sdk';
import type { NostrEvent } from '@hyprgate/types';

/**
 * Shared kind-0 profile-metadata subscription.
 */
interface NappletShellHandle {
  ready(): Promise<unknown>;
  supports(domain: string, protocol?: string): boolean;
}

function getShell(): NappletShellHandle | null {
  return (globalThis as unknown as { napplet?: { shell?: NappletShellHandle } }).napplet?.shell ?? null;
}

export interface ProfileContent {
  name?: string;
  display_name?: string;
  picture?: string;
}

export type ProfileMetadataCallback = (pubkey: string, profile: ProfileContent) => void;

const NOOP_SUBSCRIPTION: Subscription = { close: () => { /* no-op */ } };

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseProfileEvent(event: NostrEvent): ProfileContent | null {
  if (event.kind !== 0) return null;

  try {
    const metadata = JSON.parse(event.content) as Record<string, unknown>;
    return {
      name: optionalString(metadata.name),
      display_name: optionalString(metadata.display_name),
      picture: optionalString(metadata.picture),
    };
  } catch {
    return null;
  }
}

export function subscribeProfileMetadata(
  pubkeys: string[],
  onProfile: ProfileMetadataCallback,
  onDone: () => void = () => { /* no-op */ },
): Subscription {
  const authors = [...new Set(pubkeys.filter((pubkey) => pubkey.length > 0))];
  if (authors.length === 0) {
    onDone();
    return NOOP_SUBSCRIPTION;
  }

  const latestByPubkey = new Map<string, number>();
  const subscriptions: Subscription[] = [];
  let closed = false;
  let closeWhenReady = false;
  let done = false;

  // Set up the close guard synchronously so an early close() (before the
  // shell.ready() gate resolves) is honored once the subscription opens.
  function close(): void {
    if (closed) return;
    closed = true;
    if (subscriptions.length > 0) {
      for (const subscription of subscriptions) subscription.close();
    } else {
      closeWhenReady = true;
    }
  }

  function handleEvent(event: NostrEvent): void {
    if (closed || event.kind !== 0 || !authors.includes(event.pubkey)) return;
    const latestCreatedAt = latestByPubkey.get(event.pubkey);
    if (latestCreatedAt !== undefined && latestCreatedAt > event.created_at) return;

    const profile = parseProfileEvent(event);
    if (!profile) return;

    latestByPubkey.set(event.pubkey, event.created_at);
    onProfile(event.pubkey, profile);
  }

  function handleEose(): void {
    if (done) return;
    done = true;
    onDone();
  }

  const filters = authors.map((author) => ({ kinds: [0], authors: [author], limit: 1 }));

  // Open the subscription AFTER shell.ready() so the handshake is settled and
  // shell.supports('outbox') reflects the runtime's registered NAP services.
  // The returned { close } is synchronous and honors early close().
  void (async () => {
    const shell = getShell();
    await shell?.ready();
    if (closed) return;
    if (shell?.supports('outbox') ?? false) {
      let queryClosed = false;
      subscriptions.push({ close: () => { queryClosed = true; } });
      void outbox.query(filters)
        .then((result) => {
          if (closed || queryClosed) return;
          for (const item of result.events) handleEvent(item.event as NostrEvent);
        })
        .finally(() => {
          if (!closed && !queryClosed) handleEose();
        });
    }
    subscriptions.push(relay.subscribe(filters, (result) => handleEvent(result.event as NostrEvent), handleEose));
    if (closeWhenReady) {
      for (const subscription of subscriptions) subscription.close();
    }
  })();

  return { close };
}
