import type { NostrEvent, NostrFilter } from '@hyprgate/types';

export interface RuntimeAppletSubscription {
  close(): void;
}

export interface RuntimeAppletRelayResult {
  event: NostrEvent;
}

export interface RuntimeAppletRelay {
  subscribe(
    filters: NostrFilter | NostrFilter[],
    onEvent: (result: RuntimeAppletRelayResult) => void,
    onEose?: () => void,
  ): RuntimeAppletSubscription;
  query(filters: NostrFilter | NostrFilter[]): Promise<RuntimeAppletRelayResult[]>;
  publish(event: RuntimeEventTemplate | NostrEvent): Promise<NostrEvent>;
}

export interface RuntimeAppletIdentity {
  getPublicKey(): Promise<string>;
  getProfile(): Promise<unknown>;
  getFollows(): Promise<string[]>;
  getRelays(): Promise<Record<string, { read: boolean; write: boolean }>>;
}

export interface RuntimeAppletStorage {
  keys(): Promise<string[]>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface RuntimeAppletIntent {
  emit(topic: string, args?: unknown[], payload?: unknown): void;
}

export interface RuntimeAppletApi {
  identity: RuntimeAppletIdentity;
  relay: RuntimeAppletRelay;
  storage: RuntimeAppletStorage;
  intent: RuntimeAppletIntent;
}

export interface RuntimeAppletHostApi {
  identity: RuntimeAppletIdentity;
  relay: {
    subscribe(
      filters: NostrFilter[],
      onEvent: (event: NostrEvent) => void,
      onEose?: () => void,
    ): RuntimeAppletSubscription;
    query(filters: NostrFilter[]): Promise<NostrEvent[]>;
    publish(event: RuntimeEventTemplate | NostrEvent): Promise<NostrEvent>;
  };
  storage: {
    keys(appId: string): Promise<string[]>;
    getItem(appId: string, key: string): Promise<string | null>;
    setItem(appId: string, key: string, value: string): Promise<void>;
    removeItem(appId: string, key: string): Promise<void>;
  };
  intent: {
    emit(appId: string, topic: string, args?: unknown[], payload?: unknown): void;
  };
}

export interface RuntimeEventTemplate {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

declare global {
  interface Window {
    __HYPRGATE_RUNTIME_APPLET_API__?: RuntimeAppletHostApi;
  }
}

function normalizeFilters(filters: NostrFilter | NostrFilter[]): NostrFilter[] {
  return Array.isArray(filters) ? filters : [filters];
}

function runtimeAppId(): string {
  if (typeof window === 'undefined') return 'runtime-applet';
  const segments = window.location.pathname.split('/').filter(Boolean);
  const idx = segments.indexOf('runtime-applets');
  return idx >= 0 && segments[idx + 1] ? decodeURIComponent(segments[idx + 1]!) : 'runtime-applet';
}

function hostApi(): RuntimeAppletHostApi {
  if (typeof window === 'undefined') {
    throw new Error('runtime applet API is only available in a browser window');
  }
  const api = window.parent?.__HYPRGATE_RUNTIME_APPLET_API__;
  if (!api) throw new Error('Hyprgate runtime applet API is not installed');
  return api;
}

export const runtimeIdentity: RuntimeAppletIdentity = {
  getPublicKey: () => hostApi().identity.getPublicKey(),
  getProfile: () => hostApi().identity.getProfile(),
  getFollows: () => hostApi().identity.getFollows(),
  getRelays: () => hostApi().identity.getRelays(),
};

export const runtimeRelay: RuntimeAppletRelay = {
  subscribe(filters, onEvent, onEose) {
    return hostApi().relay.subscribe(
      normalizeFilters(filters),
      (event) => onEvent({ event }),
      onEose,
    );
  },
  async query(filters) {
    const events = await hostApi().relay.query(normalizeFilters(filters));
    return events.map((event) => ({ event }));
  },
  publish: (event) => hostApi().relay.publish(event),
};

export const runtimeStorage: RuntimeAppletStorage = {
  keys: () => hostApi().storage.keys(runtimeAppId()),
  getItem: (key) => hostApi().storage.getItem(runtimeAppId(), key),
  setItem: (key, value) => hostApi().storage.setItem(runtimeAppId(), key, value),
  removeItem: (key) => hostApi().storage.removeItem(runtimeAppId(), key),
};

export const runtimeIntent: RuntimeAppletIntent = {
  emit: (topic, args = [], payload = null) => {
    hostApi().intent.emit(runtimeAppId(), topic, args, payload);
  },
};

export const runtimeAppletApi: RuntimeAppletApi = {
  identity: runtimeIdentity,
  relay: runtimeRelay,
  storage: runtimeStorage,
  intent: runtimeIntent,
};
