// napps/stream/src/lib/stream-store.ts
// Kind 30311 parsing and stream state management.
// Pure TypeScript — no Svelte runes. Keep as .ts (not .svelte.ts) for vitest compatibility.

import type { NostrEvent } from 'nostr-tools';

export interface LiveStream {
  id: string;
  /** NIP-53 addressable coordinate: "30311:<hostPubkey>:<dTag>" — used for kind 1311 chat. */
  streamAddr: string;
  /** Relay URLs from the kind 30311 "relays" tag — where kind 1311 chat events are hosted. */
  chatRelays: string[];
  title: string;
  streamUrl: string;
  status: string;
  hostPubkey: string;
  viewerCount: number;
  image: string;
  summary: string;
  service: string;
  tags: string[];
  createdAt: number;
  event: NostrEvent;
}

export interface StreamStore {
  streams: Map<string, LiveStream>;
  loading: boolean;
  addStream(s: LiveStream): void;
  removeStream(id: string): void;
  setLoading(v: boolean): void;
  getStreams(): LiveStream[];
  clear(): void;
}

/**
 * Parse a Nostr kind 30311 event into a LiveStream object.
 * Returns null if the event is not kind 30311 or status is not 'live'.
 *
 * Tag priority for URL:  streaming > stream > recording > url
 * Title fallback:        title tag, else d tag
 * Host:                  p tag with role=host, else event.pubkey
 */
export function parseKind30311(event: NostrEvent): LiveStream | null {
  if (event.kind !== 30311) return null;

  // Build a tag lookup map (first value per key)
  const tagMap = new Map<string, string>();
  for (const tag of event.tags) {
    const key = tag[0];
    const val = tag[1];
    if (key !== undefined && val !== undefined && !tagMap.has(key)) {
      tagMap.set(key, val);
    }
  }

  // Filter: only live streams
  const status = tagMap.get('status') ?? 'offline';
  if (status !== 'live') return null;

  // d-tag (required for NIP-53 addressable coordinate)
  const dTag = tagMap.get('d') ?? '';

  // Title with fallback to d tag
  const title = tagMap.get('title') ?? (dTag || 'Untitled Stream');

  // URL with fallback chain: streaming > stream > recording > url
  const streamUrl =
    tagMap.get('streaming') ??
    tagMap.get('stream') ??
    tagMap.get('recording') ??
    tagMap.get('url') ??
    '';

  // Host: find 'p' tag with 4th element (index 3) === 'host'
  const hostTag = event.tags.find((t) => t[0] === 'p' && t[3] === 'host');
  const hostPubkey = (hostTag?.[1] ?? event.pubkey) as string;

  // Viewer count
  const viewerCount = parseInt(tagMap.get('current_participants') ?? '0', 10) || 0;

  // Content tags (t tags)
  const tags = event.tags
    .filter((t) => t[0] === 't' && t[1] !== undefined)
    .map((t) => t[1] as string);

  // NIP-53 addressable coordinate — used for kind 1311 chat filter '#a' tag
  const streamAddr = `30311:${hostPubkey}:${dTag}`;

  // Chat relay URLs from the "relays" tag — where kind 1311 events are hosted.
  // NIP-53: ["relays", "wss://one.com", "wss://two.com", ...]
  const relaysTag = event.tags.find((t) => t[0] === 'relays');
  const chatRelays: string[] = relaysTag ? relaysTag.slice(1).filter((r) => typeof r === 'string' && r.startsWith('wss://')) : [];

  return {
    id: event.id,
    streamAddr,
    chatRelays,
    title,
    streamUrl,
    status,
    hostPubkey,
    viewerCount,
    image: tagMap.get('image') ?? '',
    summary: tagMap.get('summary') ?? '',
    service: tagMap.get('service') ?? '',
    tags,
    createdAt: event.created_at,
    event,
  };
}

/**
 * Create a plain mutable stream store (no Svelte runes).
 * Bridge to Svelte reactivity via version counter + setInterval polling in components.
 */
export function createStreamStore(): StreamStore {
  const streams = new Map<string, LiveStream>();
  let loading = true;

  function removeOlderStreamFromSamePublisher(next: LiveStream): boolean {
    for (const [id, current] of streams) {
      if (current.event.pubkey !== next.event.pubkey) continue;
      if (current.createdAt >= next.createdAt) return false;
      streams.delete(id);
    }
    return true;
  }

  const store: StreamStore = {
    get streams() {
      return streams;
    },
    get loading() {
      return loading;
    },
    addStream(s: LiveStream): void {
      if (!removeOlderStreamFromSamePublisher(s)) return;
      streams.set(s.id, s);
    },
    removeStream(id: string): void {
      streams.delete(id);
    },
    setLoading(v: boolean): void {
      loading = v;
    },
    getStreams(): LiveStream[] {
      return Array.from(streams.values()).sort((a, b) => b.createdAt - a.createdAt);
    },
    clear(): void {
      streams.clear();
    },
  };

  return store;
}
