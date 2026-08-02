import type { IntentRequest, IntentResult, NostrEvent, NostrFilter } from '@hyprgate/types';
import type {
  ControlCompletionRequest,
  ControlCompletionResult,
  ControlErrorCode,
  ControlInvocationRequest,
  ControlInvocationSnapshot,
  ControlOperationDescriptor,
  ControlRegistrySnapshot,
  ControlResolveRequest,
  ControlResolvedOperation,
} from './control-plane.js';
import {
  RuntimeControlClient,
  RuntimeControlClientError,
  type RuntimeControlInvocationHandle,
  type RuntimeControlRegistrySubscription,
} from './runtime-control-client.js';

export interface RuntimeAppletSubscription {
  close(): void;
}

export interface RuntimeAppletRelayResult {
  event: NostrEvent;
  relayHints?: string[];
}

export interface RuntimeAppletPublishOptions {
  targetAuthors?: string[];
  relays?: string[];
}

export interface RuntimeAppletSubscribeOptions {
  relays?: string[];
}

export interface RuntimeAppletRelay {
  subscribe(
    filters: NostrFilter | NostrFilter[],
    onEvent: (result: RuntimeAppletRelayResult) => void,
    onEose?: () => void,
    options?: RuntimeAppletSubscribeOptions,
  ): RuntimeAppletSubscription;
  query(filters: NostrFilter | NostrFilter[]): Promise<RuntimeAppletRelayResult[]>;
  publish(event: RuntimeEventTemplate | NostrEvent, options?: RuntimeAppletPublishOptions): Promise<NostrEvent>;
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
  invoke(request: IntentRequest): Promise<IntentResult>;
}

/** A positional argument accepted by a shell-registered runtime command. */
export interface RuntimeAppletCommandArgument {
  name: string;
  description: string;
  required?: boolean;
}

/** Serializable metadata for an explicitly allowlisted shell command. */
export interface RuntimeAppletCommand {
  id: string;
  name: string;
  category: string;
  description: string;
  usage: string;
  help: string;
  args: RuntimeAppletCommandArgument[];
  executable: boolean;
}

export interface RuntimeAppletCommandExecution {
  id: string;
  executed: true;
}

/**
 * Narrow command surface for Hyprgate-owned runtime applets. This is not a
 * JavaScript evaluation API: the shell exposes only actions which opt into
 * terminal metadata and execution.
 */
export interface RuntimeAppletCommands {
  list(): Promise<RuntimeAppletCommand[]>;
  get(id: string): Promise<RuntimeAppletCommand | null>;
  execute(id: string, args?: string[]): Promise<RuntimeAppletCommandExecution>;
}

export interface RuntimeAppletControls {
  list(): Promise<ControlRegistrySnapshot>;
  describe(operationId: string): Promise<ControlOperationDescriptor | null>;
  resolve(request: ControlResolveRequest): Promise<ControlResolvedOperation | null>;
  complete(request: ControlCompletionRequest): Promise<ControlCompletionResult>;
  invoke(request: ControlInvocationRequest): Promise<RuntimeControlInvocationHandle>;
  getInvocation(invocationId: string): Promise<ControlInvocationSnapshot | null>;
  cancel(invocationId: string): Promise<boolean>;
  subscribeRegistry(
    listener: (snapshot: ControlRegistrySnapshot) => void,
  ): Promise<RuntimeControlRegistrySubscription>;
  close(): void;
}

export class RuntimeAppletCommandError extends Error {
  constructor(
    readonly operationId: string,
    readonly code: ControlErrorCode | 'disconnected' | 'host_error',
    readonly status: ControlInvocationSnapshot['status'] | 'failed',
  ) {
    super(`Runtime command failed (${code})`);
    this.name = 'RuntimeAppletCommandError';
  }
}

export interface RuntimeAppletApi {
  identity: RuntimeAppletIdentity;
  relay: RuntimeAppletRelay;
  storage: RuntimeAppletStorage;
  intent: RuntimeAppletIntent;
  control: RuntimeAppletControls;
  commands: RuntimeAppletCommands;
}

export interface RuntimeAppletHostApi {
  identity: RuntimeAppletIdentity;
  relay: {
    subscribe(
      filters: NostrFilter[],
      onEvent: (result: RuntimeAppletRelayResult) => void,
      onEose?: () => void,
      options?: RuntimeAppletSubscribeOptions,
    ): RuntimeAppletSubscription;
    query(filters: NostrFilter[]): Promise<RuntimeAppletRelayResult[]>;
    publish(event: RuntimeEventTemplate | NostrEvent, options?: RuntimeAppletPublishOptions): Promise<NostrEvent>;
  };
  storage: {
    keys(appId: string): Promise<string[]>;
    getItem(appId: string, key: string): Promise<string | null>;
    setItem(appId: string, key: string, value: string): Promise<void>;
    removeItem(appId: string, key: string): Promise<void>;
  };
  intent: {
    invoke(appId: string, request: IntentRequest): Promise<IntentResult>;
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
  subscribe(filters, onEvent, onEose, options) {
    return hostApi().relay.subscribe(
      normalizeFilters(filters),
      onEvent,
      onEose,
      options,
    );
  },
  query: filters => hostApi().relay.query(normalizeFilters(filters)),
  publish: (event, options) => hostApi().relay.publish(event, options),
};

export const runtimeStorage: RuntimeAppletStorage = {
  keys: () => hostApi().storage.keys(runtimeAppId()),
  getItem: (key) => hostApi().storage.getItem(runtimeAppId(), key),
  setItem: (key, value) => hostApi().storage.setItem(runtimeAppId(), key, value),
  removeItem: (key) => hostApi().storage.removeItem(runtimeAppId(), key),
};

export const runtimeIntent: RuntimeAppletIntent = {
  invoke: request => hostApi().intent.invoke(runtimeAppId(), request),
};

let controlClient: RuntimeControlClient | undefined;

function controls(): RuntimeControlClient {
  if (controlClient) return controlClient;
  if (typeof window === 'undefined') {
    throw new Error('runtime control API is only available in a browser window');
  }
  controlClient = new RuntimeControlClient({
    window,
    parent: window.parent,
    origin: window.location.origin,
  });
  return controlClient;
}

export const runtimeControls: RuntimeAppletControls = {
  list: () => controls().list(),
  describe: operationId => controls().describe(operationId),
  resolve: request => controls().resolve(request),
  complete: request => controls().complete(request),
  invoke: request => controls().invoke(request),
  getInvocation: invocationId => controls().getInvocation(invocationId),
  cancel: invocationId => controls().cancel(invocationId),
  subscribeRegistry: listener => controls().subscribeRegistry(listener),
  close: () => {
    controlClient?.close();
    controlClient = undefined;
  },
};

function runtimeCommand(descriptor: ControlOperationDescriptor): RuntimeAppletCommand {
  return {
    id: descriptor.id,
    name: descriptor.summary,
    category: descriptor.source.domain,
    description: descriptor.summary,
    usage: descriptor.usage,
    help: descriptor.help,
    args: descriptor.arguments.map(argument => ({
      name: argument.name,
      description: argument.description,
      ...(argument.required ? { required: true } : {}),
    })),
    executable: descriptor.availability.state === 'available',
  };
}

export const runtimeCommands: RuntimeAppletCommands = {
  async list() {
    const snapshot = await runtimeControls.list();
    return snapshot.operations.map(runtimeCommand);
  },
  async get(id) {
    if (typeof id !== 'string') throw new RuntimeAppletCommandError('unknown.operation', 'host_error', 'failed');
    const descriptor = await runtimeControls.describe(id);
    return descriptor ? runtimeCommand(descriptor) : null;
  },
  async execute(id, args = []) {
    if (typeof id !== 'string' || !Array.isArray(args) || !args.every(arg => typeof arg === 'string')) {
      throw new RuntimeAppletCommandError(
        typeof id === 'string' ? id : 'unknown.operation',
        'invalid_arguments',
        'failed',
      );
    }
    try {
      const descriptor = await runtimeControls.describe(id);
      if (!descriptor) throw new RuntimeAppletCommandError(id, 'unknown_operation', 'failed');
      if (descriptor.availability.state !== 'available') {
        throw new RuntimeAppletCommandError(id, 'unavailable', 'unavailable');
      }
      if (args.length > descriptor.arguments.length) {
        throw new RuntimeAppletCommandError(id, 'invalid_arguments', 'failed');
      }
      const namedArguments = Object.fromEntries(args.map((value, index) => [
        descriptor.arguments[index]!.name,
        value,
      ]));
      const invocation = await runtimeControls.invoke({ operationId: id, arguments: namedArguments });
      const snapshot = await invocation.result;
      if (snapshot.status === 'accepted' || snapshot.status === 'succeeded' || snapshot.status === 'no-op') {
        return { id, executed: true };
      }
      throw new RuntimeAppletCommandError(id, snapshot.error?.code ?? 'host_error', snapshot.status);
    } catch (error) {
      if (error instanceof RuntimeAppletCommandError) throw error;
      if (error instanceof RuntimeControlClientError) {
        throw new RuntimeAppletCommandError(
          id,
          error.code === 'disconnected' ? 'disconnected' : 'host_error',
          'failed',
        );
      }
      throw new RuntimeAppletCommandError(id, 'host_error', 'failed');
    }
  },
};

export const runtimeAppletApi: RuntimeAppletApi = {
  identity: runtimeIdentity,
  relay: runtimeRelay,
  storage: runtimeStorage,
  intent: runtimeIntent,
  control: runtimeControls,
  commands: runtimeCommands,
};
