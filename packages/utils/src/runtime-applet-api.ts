import type { IntentRequest, NostrEvent, NostrFilter } from '@hyprgate/types';
import type { RuntimeAppOpenResult } from './app-store-open-protocol.js';
import type {
  ControlCompletionRequest,
  ControlCompletionResult,
  ControlDescribedOperation,
  ControlErrorCode,
  ControlInvocationRequest,
  ControlInvocationSnapshot,
  ControlJsonValue,
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
  /**
   * Observe the current identity's shared profile rail. The host stops this
   * subscription when the runtime applet closes or the identity session changes.
   */
  subscribeProfile(listener: (profile: unknown | null) => void): RuntimeAppletSubscription;
  getFollows(): Promise<string[]>;
  getRelays(): Promise<Record<string, { read: boolean; write: boolean }>>;
}

export interface RuntimeAppletIntent {
  invoke(request: IntentRequest): Promise<RuntimeAppOpenResult>;
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
  describe(operationId: string): Promise<ControlDescribedOperation | null>;
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
  intent: RuntimeAppletIntent;
  control: RuntimeAppletControls;
  commands: RuntimeAppletCommands;
}

export interface RuntimeAppletHostApi {
  identity: Omit<RuntimeAppletIdentity, 'getRelays'>;
  intent: {
    invoke(appId: string, request: IntentRequest): Promise<RuntimeAppOpenResult>;
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
  subscribeProfile: (listener) => hostApi().identity.subscribeProfile(listener),
  getFollows: () => hostApi().identity.getFollows(),
  async getRelays() {
    const value = await invokeRuntimeRelay('relay.runtime.identity-relays', {});
    if (!Array.isArray(value.relays)) throw new RuntimeAppletCommandError('relay.runtime.identity-relays', 'host_error', 'failed');
    return Object.fromEntries(value.relays.flatMap((relay) => {
      if (!relay || typeof relay !== 'object' || Array.isArray(relay)) return [];
      const value = relay as Record<string, unknown>;
      return typeof value.url === 'string' && typeof value.read === 'boolean' && typeof value.write === 'boolean'
        ? [[value.url, { read: value.read, write: value.write }] as const]
        : [];
    }));
  },
};

type RuntimeRelayControlValue = Record<string, unknown>;
type RuntimeRelayProgressChunk = { streamId: string; chunkIndex: number; totalChunks: number; payload: string };

function relayProgressResult(
  data: unknown,
  chunks: Map<string, string[]>,
): RuntimeAppletRelayResult | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const chunk = data as Partial<RuntimeRelayProgressChunk>;
  const { streamId, chunkIndex, totalChunks, payload } = chunk;
  if (typeof streamId !== 'string' || typeof chunkIndex !== 'number' || typeof totalChunks !== 'number' || typeof payload !== 'string' ||
    !Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) return undefined;
  const parts = chunks.get(streamId) ?? Array.from({ length: totalChunks }, () => '');
  if (parts.length !== totalChunks) return undefined;
  parts[chunkIndex] = payload;
  chunks.set(streamId, parts);
  if (parts.some(part => part.length === 0)) return undefined;
  chunks.delete(streamId);
  try {
    const parsed = JSON.parse(parts.join('')) as RuntimeAppletRelayResult;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.event && typeof parsed.event === 'object'
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function relayControlError(operationId: string, snapshot: ControlInvocationSnapshot): RuntimeAppletCommandError {
  return new RuntimeAppletCommandError(operationId, snapshot.error?.code ?? 'host_error', snapshot.status);
}

async function invokeRuntimeRelay(
  operationId: string,
  arguments_: Record<string, unknown>,
): Promise<RuntimeRelayControlValue> {
  const client = controls();
  const described = await client.describe(operationId);
  if (!described) throw new RuntimeAppletCommandError(operationId, 'unknown_operation', 'failed');
  const invocation = await client.invoke({
    operationId,
    arguments: arguments_ as ControlInvocationRequest['arguments'],
    expectedRegistrationRevision: described.registrationRevision,
  });
  const snapshot = await invocation.result;
  if (snapshot.status !== 'succeeded' && snapshot.status !== 'no-op') throw relayControlError(operationId, snapshot);
  if (!snapshot.value || typeof snapshot.value !== 'object' || Array.isArray(snapshot.value)) {
    throw new RuntimeAppletCommandError(operationId, 'host_error', 'failed');
  }
  return snapshot.value as RuntimeRelayControlValue;
}

export const runtimeRelay: RuntimeAppletRelay = {
  subscribe(filters, onEvent, onEose, options) {
    let closed = false;
    let invocation: RuntimeControlInvocationHandle | undefined;
    let unsubscribe: (() => void) | undefined;
    const chunks = new Map<string, string[]>();
    const client = controls();
    void (async () => {
      const operationId = 'relay.runtime.subscribe';
      const described = await client.describe(operationId);
      if (!described || closed) return;
      invocation = await client.invoke({
        operationId,
        arguments: { filters: normalizeFilters(filters) as unknown as ControlJsonValue, ...(options?.relays ? { relays: options.relays } : {}) },
        expectedRegistrationRevision: described.registrationRevision,
      });
      if (closed) {
        await invocation.cancel();
        return;
      }
      unsubscribe = invocation.subscribe((controlEvent) => {
        if (closed) return;
        if (controlEvent.kind !== 'progress') return;
        const result = relayProgressResult(controlEvent.data, chunks);
        if (result) onEvent(result);
        else if (controlEvent.message === 'Runtime relay EOSE') onEose?.();
      });
      void invocation.result.catch(() => undefined);
    })().catch(() => undefined);
    return { close: () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      void invocation?.cancel().catch(() => undefined);
    } };
  },
  async query(filters) {
    const operationId = 'relay.runtime.query';
    const client = controls();
    const described = await client.describe(operationId);
    if (!described) throw new RuntimeAppletCommandError(operationId, 'unknown_operation', 'failed');
    const invocation = await client.invoke({
      operationId,
      arguments: { filters: normalizeFilters(filters) as unknown as ControlJsonValue },
      expectedRegistrationRevision: described.registrationRevision,
    });
    const results: RuntimeAppletRelayResult[] = [];
    const chunks = new Map<string, string[]>();
    invocation.subscribe((controlEvent) => {
      if (controlEvent.kind !== 'progress' || controlEvent.message !== 'Runtime relay query chunk') return;
      const result = relayProgressResult(controlEvent.data, chunks);
      if (result) results.push(result);
    });
    const snapshot = await invocation.result;
    if (snapshot.status !== 'succeeded') throw relayControlError(operationId, snapshot);
    const terminal = snapshot.value as { count?: unknown; truncated?: unknown } | undefined;
    if (!terminal || terminal.truncated !== false || terminal.count !== results.length) {
      throw new RuntimeAppletCommandError(operationId, 'host_error', 'failed');
    }
    return results;
  },
  async publish(event, options) {
    const value = await invokeRuntimeRelay('relay.runtime.publish', {
      event,
      ...(options?.targetAuthors ? { targetAuthors: options.targetAuthors } : {}),
      ...(options?.relays ? { relays: options.relays } : {}),
    });
    if (!value.event || typeof value.event !== 'object' || Array.isArray(value.event)) {
      throw new RuntimeAppletCommandError('relay.runtime.publish', 'host_error', 'failed');
    }
    return value.event as NostrEvent;
  },
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
    const described = await runtimeControls.describe(id);
    return described ? runtimeCommand(described.descriptor) : null;
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
      const client = controls();
      const described = await client.describe(id);
      if (!described) throw new RuntimeAppletCommandError(id, 'unknown_operation', 'failed');
      const descriptor = described.descriptor;
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
      const invocation = await client.invoke({
        operationId: id,
        arguments: namedArguments,
        expectedRegistrationRevision: described.registrationRevision,
      });
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
  intent: runtimeIntent,
  control: runtimeControls,
  commands: runtimeCommands,
};
