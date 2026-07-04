export type RuntimePlayerKind = 'audio' | 'video' | 'hls' | 'icecast' | 'unknown';
export type RuntimePlayerControl = 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'seek' | 'setVolume' | 'setMuted';
export type RuntimePlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface RuntimePlaybackContext {
  label?: string;
  detail?: string;
  index?: number;
  total?: number;
  chat?: RuntimePlaybackChatContext;
}

export interface RuntimePlaybackChatContext {
  streamAddr: string;
  title: string;
  chatRelays?: string[];
}

export interface RuntimePlaybackQueueItem {
  url: string;
  kind?: RuntimePlayerKind;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  duration?: number;
  aspectRatio?: number;
  live?: boolean;
  loop?: boolean;
  context?: RuntimePlaybackContext;
}

export interface RuntimePlaybackSource {
  url: string;
  kind: RuntimePlayerKind;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  duration?: number;
  aspectRatio?: number;
  context?: RuntimePlaybackContext;
  queue?: RuntimePlaybackQueueItem[];
  queueIndex?: number;
  capabilities?: RuntimePlayerControl[];
  autoplay?: boolean;
  live?: boolean;
  loop?: boolean;
}

export interface RuntimePlayerState {
  sessionId: string;
  windowId: string;
  state: RuntimePlayerStatus;
  position: number;
  duration: number | null;
  volume: number;
  muted: boolean;
  error?: string;
}

export interface RuntimePlaybackResult {
  sessionId: string;
  state?: RuntimePlayerState;
}

export interface RuntimePlayerSubscription {
  close(): void;
}

type PlayerEnvelope = {
  type: string;
  id?: string;
  sessionId?: string;
  source?: RuntimePlaybackSource;
  action?: RuntimePlayerControl;
  value?: unknown;
  state?: RuntimePlayerState | null;
  error?: string;
  ok?: boolean;
};

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type StateHandler = (state: RuntimePlayerState | null) => void;
type MediaAction = 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'seek' | 'volume';
type MediaState = {
  status: 'playing' | 'paused' | 'stopped' | 'buffering';
  position?: number;
  duration?: number;
  volume?: number;
};
type MediaSessionCreate = {
  owner: 'shell';
  source: { url: string; mimeType?: string };
  metadata?: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: { url?: string };
    duration?: number;
    mediaType?: 'audio' | 'video';
  };
  context?: RuntimePlaybackContext;
  queue?: RuntimePlaybackQueueItem[];
  queueIndex?: number;
  aspectRatio?: number;
  capabilities?: MediaAction[];
  autoplay?: boolean;
  live?: boolean;
  loop?: boolean;
};
type MediaSessionResult = {
  sessionId?: string;
  owner?: 'shell' | 'napplet';
  error?: string;
};
type NappletMediaClient = {
  createSession(options: MediaSessionCreate): Promise<MediaSessionResult>;
  destroySession(sessionId: string): void;
  sendCommand(sessionId: string, action: MediaAction, value?: number): void;
  onState(sessionId: string, callback: (state: MediaState) => void): { close(): void };
};
type NappletShellClient = {
  supports?: (capability: string, protocol?: string) => boolean;
};
type NappletGlobal = {
  napplet?: {
    media?: NappletMediaClient;
    shell?: NappletShellClient;
  };
};
type RuntimePlaybackTransport = 'media' | 'player';

const REQUEST_TIMEOUT_MS = 30_000;
const pendingRequests = new Map<string, PendingRequest<unknown>>();
const stateHandlers = new Map<string, Set<StateHandler>>();
const sessionTransports = new Map<string, RuntimePlaybackTransport>();
let listenerInstalled = false;

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isPlayerEnvelope(value: unknown): value is PlayerEnvelope {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string';
}

function ensurePlayerListener(): void {
  if (listenerInstalled) return;
  if (typeof window === 'undefined') throw new Error('runtime player is only available in a browser');
  window.addEventListener('message', handlePlayerMessage);
  listenerInstalled = true;
}

function handlePlayerMessage(event: MessageEvent): void {
  if (event.source !== window.parent) return;
  if (!isPlayerEnvelope(event.data)) return;
  const message = event.data;

  if (message.id && pendingRequests.has(message.id)) {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(message.id);
    if (message.type.endsWith('.error')) {
      pending.reject(new Error(message.error ?? 'runtime player request failed'));
    } else {
      pending.resolve(message);
    }
    return;
  }

  if (message.type === 'player.state') {
    const sessionId = message.sessionId ?? message.state?.sessionId;
    if (!sessionId) return;
    const handlers = stateHandlers.get(sessionId);
    if (!handlers) return;
    for (const handler of handlers) handler(message.state ?? null);
  }
}

function sendPlayerRequest<T>(message: Omit<PlayerEnvelope, 'id'>): Promise<T> {
  ensurePlayerListener();
  const id = createRequestId();
  const envelope = { ...message, id };

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingRequests.delete(id)) {
        reject(new Error(`${message.type} timed out`));
      }
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
    window.parent.postMessage(envelope, '*');
  });
}

function getNappletMediaClient(): NappletMediaClient | null {
  if (typeof window === 'undefined') return null;
  const napplet = (window as NappletGlobal).napplet;
  const media = napplet?.media;
  if (
    media
    && typeof media.createSession === 'function'
    && typeof media.destroySession === 'function'
    && typeof media.sendCommand === 'function'
    && typeof media.onState === 'function'
  ) {
    return media;
  }
  return null;
}

function shellSupportsMedia(): boolean {
  if (typeof window === 'undefined') return false;
  const supports = (window as NappletGlobal).napplet?.shell?.supports;
  if (typeof supports !== 'function') return true;
  try {
    return supports('media') || supports('nap:media');
  } catch {
    return true;
  }
}

function mediaTypeForRuntimeKind(kind: RuntimePlayerKind): 'audio' | 'video' {
  return kind === 'video' || kind === 'hls' ? 'video' : 'audio';
}

function mimeTypeForRuntimeKind(kind: RuntimePlayerKind): string | undefined {
  switch (kind) {
    case 'hls':
      return 'application/vnd.apple.mpegurl';
    case 'video':
      return 'video/mp4';
    case 'audio':
    case 'icecast':
      return 'audio/mpeg';
    default:
      return undefined;
  }
}

function toMediaActions(controls: RuntimePlayerControl[] | undefined): MediaAction[] | undefined {
  if (!controls) return undefined;
  const actions = new Set<MediaAction>();
  for (const control of controls) {
    switch (control) {
      case 'play':
      case 'pause':
      case 'stop':
      case 'next':
      case 'prev':
      case 'seek':
        actions.add(control);
        break;
      case 'setVolume':
      case 'setMuted':
        actions.add('volume');
        break;
    }
  }
  return actions.size > 0 ? [...actions] : undefined;
}

function toMediaSessionCreate(source: RuntimePlaybackSource): MediaSessionCreate {
  const metadata: NonNullable<MediaSessionCreate['metadata']> = {
    mediaType: mediaTypeForRuntimeKind(source.kind),
  };
  if (source.title) metadata.title = source.title;
  if (source.artist) metadata.artist = source.artist;
  if (source.album) metadata.album = source.album;
  if (source.artworkUrl) metadata.artwork = { url: source.artworkUrl };
  if (typeof source.duration === 'number') metadata.duration = source.duration;

  const create: MediaSessionCreate = {
    owner: 'shell',
    source: {
      url: source.url,
      ...(mimeTypeForRuntimeKind(source.kind) ? { mimeType: mimeTypeForRuntimeKind(source.kind) } : {}),
    },
    metadata,
    capabilities: toMediaActions(source.capabilities),
    autoplay: source.autoplay,
    live: source.live,
  };
  if (source.context) create.context = source.context;
  if (source.queue) create.queue = source.queue;
  if (typeof source.queueIndex === 'number') create.queueIndex = source.queueIndex;
  if (typeof source.aspectRatio === 'number') create.aspectRatio = source.aspectRatio;
  if (source.loop === true) create.loop = true;
  return create;
}

function toMediaAction(action: RuntimePlayerControl): MediaAction | null {
  switch (action) {
    case 'play':
    case 'pause':
    case 'stop':
    case 'next':
    case 'prev':
    case 'seek':
      return action;
    case 'setVolume':
    case 'setMuted':
      return 'volume';
    default:
      return null;
  }
}

function toRuntimeState(sessionId: string, state: MediaState): RuntimePlayerState {
  const runtimeStatus: RuntimePlayerStatus = state.status === 'buffering'
    ? 'loading'
    : state.status === 'stopped'
      ? 'idle'
      : state.status;
  return {
    sessionId,
    windowId: '',
    state: runtimeStatus,
    position: state.position ?? 0,
    duration: state.duration ?? null,
    volume: state.volume ?? 1,
    muted: false,
  };
}

export async function requestRuntimePlayback(source: RuntimePlaybackSource): Promise<RuntimePlaybackResult> {
  const media = getNappletMediaClient();
  if (media && shellSupportsMedia()) {
    try {
      const result = await media.createSession(toMediaSessionCreate(source));
      if (result.sessionId && result.owner === 'shell' && !result.error) {
        sessionTransports.set(result.sessionId, 'media');
        return { sessionId: result.sessionId };
      }
    } catch {
      // Fall through to the legacy player.* bridge below.
    }
  }

  const result = await sendPlayerRequest<PlayerEnvelope>({
    type: 'player.requestPlayback',
    source,
  });
  if (!result.sessionId) throw new Error('runtime player did not return a sessionId');
  sessionTransports.set(result.sessionId, 'player');
  return {
    sessionId: result.sessionId,
    state: result.state ?? undefined,
  };
}

export async function controlRuntimePlayback(
  sessionId: string,
  action: RuntimePlayerControl,
  value?: unknown,
): Promise<RuntimePlayerState | undefined> {
  if (sessionTransports.get(sessionId) === 'media') {
    const media = getNappletMediaClient();
    const mediaAction = toMediaAction(action);
    if (!media || !mediaAction) return undefined;
    media.sendCommand(sessionId, mediaAction, typeof value === 'number' ? value : undefined);
    return undefined;
  }

  const result = await sendPlayerRequest<PlayerEnvelope>({
    type: 'player.control',
    sessionId,
    action,
    value,
  });
  return result.state ?? undefined;
}

export async function releaseRuntimePlayback(sessionId: string): Promise<void> {
  if (sessionTransports.get(sessionId) === 'media') {
    getNappletMediaClient()?.destroySession(sessionId);
    sessionTransports.delete(sessionId);
    stateHandlers.delete(sessionId);
    return;
  }

  await sendPlayerRequest<PlayerEnvelope>({
    type: 'player.release',
    sessionId,
  });
  sessionTransports.delete(sessionId);
  stateHandlers.delete(sessionId);
}

export function subscribeRuntimePlayback(
  sessionId: string,
  handler: StateHandler,
): RuntimePlayerSubscription {
  if (sessionTransports.get(sessionId) === 'media') {
    const subscription = getNappletMediaClient()?.onState(sessionId, (state) => {
      handler(toRuntimeState(sessionId, state));
    });
    return {
      close() {
        subscription?.close();
      },
    };
  }

  ensurePlayerListener();
  const handlers = stateHandlers.get(sessionId) ?? new Set<StateHandler>();
  handlers.add(handler);
  stateHandlers.set(sessionId, handlers);
  void sendPlayerRequest<PlayerEnvelope>({
    type: 'player.subscribe',
    sessionId,
  }).catch((error) => {
    console.warn('[runtime-player] subscribe failed:', error);
  });

  return {
    close() {
      const current = stateHandlers.get(sessionId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) stateHandlers.delete(sessionId);
    },
  };
}
