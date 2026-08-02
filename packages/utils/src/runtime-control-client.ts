import {
  RUNTIME_CONTROL_MAX_ID_LENGTH,
  RUNTIME_CONTROL_PROTOCOL,
  RUNTIME_CONTROL_VERSION,
  isRuntimeControlRequest,
  isRuntimeControlEvent,
  isRuntimeControlResponse,
  type ControlCompletionRequest,
  type ControlCompletionResult,
  type ControlInvocationEvent,
  type ControlInvocationRequest,
  type ControlInvocationSnapshot,
  type ControlOperationDescriptor,
  type ControlRegistrySnapshot,
  type ControlResolveRequest,
  type ControlResolvedOperation,
  type RuntimeControlMethod,
  type RuntimeControlMethodMap,
  type RuntimeControlEvent,
  type RuntimeControlRequest,
  type RuntimeControlTransportErrorCode,
} from './control-plane.js';

export class RuntimeControlClientError extends Error {
  constructor(
    readonly code: RuntimeControlTransportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeControlClientError';
  }
}

export interface RuntimeControlClientOptions {
  window?: Window;
  parent?: WindowProxy;
  origin?: string;
  maxPending?: number;
  maxSubscriptions?: number;
  maxInvocations?: number;
  maxCompletedInvocations?: number;
  maxCompletedRequestIds?: number;
  maxBufferedEvents?: number;
  requestIdFactory?: () => string;
}

export interface RuntimeControlRegistrySubscription {
  readonly id: string;
  unsubscribe(): Promise<void>;
}

export interface RuntimeControlInvocationHandle {
  readonly id: string;
  readonly cancellable: boolean;
  readonly result: Promise<ControlInvocationSnapshot>;
  cancel(): Promise<boolean>;
  subscribe(listener: (event: ControlInvocationEvent) => void): () => void;
  unsubscribe(): Promise<void>;
}

interface PendingRequest {
  method: RuntimeControlMethod;
  resolve: (payload: unknown) => void;
  reject: (error: RuntimeControlClientError) => void;
}

interface InvocationState {
  resolve: (snapshot: ControlInvocationSnapshot) => void;
  reject: (error: RuntimeControlClientError) => void;
  listeners: Set<(event: ControlInvocationEvent) => void>;
  history: ControlInvocationEvent[];
  lastSequence: number;
  settled: boolean;
  unsubscribePromise?: Promise<void>;
}

interface RegistrySubscriptionState {
  listener: (snapshot: ControlRegistrySnapshot) => void;
  lastRevision: number;
}

let fallbackRequestId = 0;

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  fallbackRequestId += 1;
  return `runtime-control-${Date.now().toString(36)}-${fallbackRequestId}`;
}

function validLocalId(value: string): boolean {
  return value.length > 0 && value.length <= RUNTIME_CONTROL_MAX_ID_LENGTH && /^[A-Za-z0-9._:-]+$/.test(value);
}

export class RuntimeControlClient {
  private readonly target: Window;
  private readonly parent: WindowProxy;
  private readonly origin: string;
  private readonly maxPending: number;
  private readonly maxSubscriptions: number;
  private readonly maxInvocations: number;
  private readonly maxCompletedInvocations: number;
  private readonly maxCompletedRequestIds: number;
  private readonly maxBufferedEvents: number;
  private readonly requestIdFactory: () => string;
  private pending = new Map<string, PendingRequest>();
  private completedRequestIds = new Set<string>();
  private completedRequestOrder: string[] = [];
  private registrySubscriptions = new Map<string, RegistrySubscriptionState>();
  private invocations = new Map<string, InvocationState>();
  private settledInvocationOrder: Array<{ id: string; state: InvocationState }> = [];
  private bufferedEvents: RuntimeControlEvent[] = [];
  private pendingInvocationReservations = 0;
  private pendingSubscriptionReservations = 0;
  private requestGeneration = 0;
  private closed = false;
  private readonly onMessage = (event: MessageEvent): void => {
    if (this.closed || event.source !== this.parent || event.origin !== this.origin) return;
    if (isRuntimeControlResponse(event.data)) {
      const response = event.data;
      const pending = this.pending.get(response.requestId);
      if (!pending || pending.method !== response.method) return;
      this.pending.delete(response.requestId);
      this.rememberCompletedRequest(response.requestId);
      if (response.ok) pending.resolve(response.payload);
      else pending.reject(new RuntimeControlClientError(response.error.code, response.error.message));
      return;
    }
    if (!isRuntimeControlEvent(event.data)) return;
    this.routeEvent(event.data);
  };

  constructor(options: RuntimeControlClientOptions = {}) {
    this.target = options.window ?? window;
    this.parent = options.parent ?? this.target.parent;
    this.origin = options.origin ?? this.target.location.origin;
    if (!this.safeOrigin(this.origin)) {
      throw new RuntimeControlClientError('invalid_request', 'Runtime control target origin must be explicit');
    }
    this.maxPending = Math.max(1, options.maxPending ?? 64);
    this.maxSubscriptions = Math.max(0, options.maxSubscriptions ?? 16);
    this.maxInvocations = Math.max(1, options.maxInvocations ?? 64);
    this.maxCompletedInvocations = Math.max(0, options.maxCompletedInvocations ?? 32);
    this.maxCompletedRequestIds = Math.max(0, options.maxCompletedRequestIds ?? 256);
    this.maxBufferedEvents = Math.max(1, options.maxBufferedEvents ?? 128);
    this.requestIdFactory = options.requestIdFactory ?? defaultRequestId;
    this.target.addEventListener('message', this.onMessage);
  }

  list(): Promise<ControlRegistrySnapshot> {
    return this.request('list', {});
  }

  describe(operationId: string): Promise<ControlOperationDescriptor | null> {
    return this.request('describe', { operationId });
  }

  resolve(request: ControlResolveRequest): Promise<ControlResolvedOperation | null> {
    return this.request('resolve', request);
  }

  complete(request: ControlCompletionRequest): Promise<ControlCompletionResult> {
    return this.request('complete', request);
  }

  getInvocation(invocationId: string): Promise<ControlInvocationSnapshot | null> {
    return this.request('getInvocation', { invocationId });
  }

  cancel(invocationId: string): Promise<boolean> {
    return this.request('cancel', { invocationId }).then(result => result.cancelled);
  }

  async invoke(request: ControlInvocationRequest): Promise<RuntimeControlInvocationHandle> {
    if (this.activeInvocationCount() + this.pendingInvocationReservations >= this.maxInvocations) {
      throw new RuntimeControlClientError('too_many_pending', 'Too many active control invocations');
    }
    this.pendingInvocationReservations += 1;
    let response: RuntimeControlMethodMap['invoke']['response'];
    try {
      response = await this.request('invoke', request);
    } finally {
      this.pendingInvocationReservations = Math.max(0, this.pendingInvocationReservations - 1);
    }
    if (this.closed) throw new RuntimeControlClientError('disconnected', 'Runtime control client is closed');
    if (this.invocations.has(response.invocationId)) {
      throw new RuntimeControlClientError('host_error', 'Duplicate host invocation ID');
    }
    let resolveResult!: (snapshot: ControlInvocationSnapshot) => void;
    let rejectResult!: (error: RuntimeControlClientError) => void;
    const result = new Promise<ControlInvocationSnapshot>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const state: InvocationState = {
      resolve: resolveResult,
      reject: rejectResult,
      listeners: new Set(),
      history: [],
      lastSequence: -1,
      settled: false,
    };
    this.invocations.set(response.invocationId, state);
    this.drainBufferedEvents(message =>
      message.event !== 'registry' && message.invocationId === response.invocationId);
    const handle: RuntimeControlInvocationHandle = {
      id: response.invocationId,
      cancellable: response.cancellable,
      result,
      cancel: () => this.cancel(response.invocationId),
      subscribe: listener => {
        if (!this.invocations.has(response.invocationId)) return () => {};
        state.listeners.add(listener);
        for (const event of state.history) this.notifyInvocationListener(listener, event);
        return () => { state.listeners.delete(listener); };
      },
      unsubscribe: () => this.unsubscribeInvocation(response.invocationId, state),
    };
    return handle;
  }

  async subscribeRegistry(
    listener: (snapshot: ControlRegistrySnapshot) => void,
  ): Promise<RuntimeControlRegistrySubscription> {
    if (this.registrySubscriptions.size + this.pendingSubscriptionReservations >= this.maxSubscriptions) {
      throw new RuntimeControlClientError('too_many_pending', 'Too many registry subscriptions');
    }
    this.pendingSubscriptionReservations += 1;
    let response: RuntimeControlMethodMap['subscribeRegistry']['response'];
    try {
      response = await this.request('subscribeRegistry', {});
    } finally {
      this.pendingSubscriptionReservations = Math.max(0, this.pendingSubscriptionReservations - 1);
    }
    if (this.closed) throw new RuntimeControlClientError('disconnected', 'Runtime control client is closed');
    if (this.registrySubscriptions.has(response.subscriptionId)) {
      throw new RuntimeControlClientError('host_error', 'Duplicate host registry subscription ID');
    }
    const state: RegistrySubscriptionState = {
      listener,
      lastRevision: response.snapshot.revision,
    };
    this.registrySubscriptions.set(response.subscriptionId, state);
    this.notifyRegistryListener(listener, response.snapshot);
    this.drainBufferedEvents(message =>
      message.event === 'registry' && message.subscriptionId === response.subscriptionId);
    let active = true;
    return {
      id: response.subscriptionId,
      unsubscribe: async () => {
        if (!active) return;
        active = false;
        this.registrySubscriptions.delete(response.subscriptionId);
        if (this.closed) return;
        await this.request('unsubscribeRegistry', { subscriptionId: response.subscriptionId });
      },
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.target.removeEventListener('message', this.onMessage);
    const error = new RuntimeControlClientError('disconnected', 'Runtime control client is closed');
    for (const pending of this.pending.values()) pending.reject(error);
    for (const invocation of this.invocations.values()) {
      invocation.listeners.clear();
      invocation.reject(error);
    }
    this.pending.clear();
    this.invocations.clear();
    this.settledInvocationOrder = [];
    this.registrySubscriptions.clear();
    this.bufferedEvents = [];
    this.pendingInvocationReservations = 0;
    this.pendingSubscriptionReservations = 0;
    this.completedRequestIds.clear();
    this.completedRequestOrder = [];
  }

  private request<M extends RuntimeControlMethod>(
    method: M,
    payload: RuntimeControlMethodMap[M]['request'],
  ): Promise<RuntimeControlMethodMap[M]['response']> {
    if (this.closed) throw new RuntimeControlClientError('disconnected', 'Runtime control client is closed');
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new RuntimeControlClientError('too_many_pending', 'Too many pending control requests'));
    }
    const requestId = this.nextRequestId();
    const request = {
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'request',
      requestId,
      method,
      payload,
    } as RuntimeControlRequest;
    if (!isRuntimeControlRequest(request)) {
      this.rememberCompletedRequest(requestId);
      return Promise.reject(new RuntimeControlClientError('invalid_request', 'Invalid runtime control request'));
    }
    const promise = new Promise<RuntimeControlMethodMap[M]['response']>((resolve, reject) => {
      this.pending.set(requestId, {
        method,
        resolve: value => resolve(value as RuntimeControlMethodMap[M]['response']),
        reject,
      });
    });
    try {
      this.parent.postMessage(request, this.origin);
    } catch {
      this.pending.delete(requestId);
      this.rememberCompletedRequest(requestId);
      return Promise.reject(new RuntimeControlClientError('host_error', 'Unable to send control request'));
    }
    return promise;
  }

  private nextRequestId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const base = this.requestIdFactory();
      this.requestGeneration += 1;
      if (!validLocalId(base)) continue;
      const suffix = `:${this.requestGeneration.toString(36)}`;
      const id = `${base.slice(0, RUNTIME_CONTROL_MAX_ID_LENGTH - suffix.length)}${suffix}`;
      if (!this.pending.has(id) && !this.completedRequestIds.has(id)) return id;
    }
    throw new RuntimeControlClientError('too_many_pending', 'Unable to allocate request ID');
  }

  private safeOrigin(value: string): boolean {
    if (!value || value === '*' || value === 'null') return false;
    try {
      const parsed = new URL(value);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === value;
    } catch {
      return false;
    }
  }

  private routeEvent(message: RuntimeControlEvent): void {
    if (message.event === 'registry') {
      const subscription = this.registrySubscriptions.get(message.subscriptionId);
      if (!subscription) {
        if (this.pendingSubscriptionReservations > 0) this.bufferEvent(message);
        return;
      }
      if (message.snapshot.revision <= subscription.lastRevision) return;
      subscription.lastRevision = message.snapshot.revision;
      this.notifyRegistryListener(subscription.listener, message.snapshot);
      return;
    }

    const invocation = this.invocations.get(message.invocationId);
    if (!invocation) {
      if (this.pendingInvocationReservations > 0) this.bufferEvent(message);
      return;
    }
    if (message.event === 'invocation') {
      if (invocation.settled || message.payload.sequence <= invocation.lastSequence) return;
      invocation.lastSequence = message.payload.sequence;
      invocation.history.push(structuredClone(message.payload));
      if (invocation.history.length > this.maxBufferedEvents) invocation.history.shift();
      for (const listener of [...invocation.listeners]) this.notifyInvocationListener(listener, message.payload);
      return;
    }
    if (invocation.settled) return;
    invocation.settled = true;
    invocation.resolve(structuredClone(message.snapshot));
    this.retainSettledInvocation(message.invocationId, invocation);
  }

  private bufferEvent(message: RuntimeControlEvent): void {
    this.bufferedEvents.push(structuredClone(message));
    if (this.bufferedEvents.length > this.maxBufferedEvents) this.bufferedEvents.shift();
  }

  private drainBufferedEvents(matches: (message: RuntimeControlEvent) => boolean): void {
    const matching: RuntimeControlEvent[] = [];
    const remaining: RuntimeControlEvent[] = [];
    for (const message of this.bufferedEvents) {
      if (matches(message)) matching.push(message);
      else remaining.push(message);
    }
    this.bufferedEvents = remaining;
    for (const message of matching) this.routeEvent(message);
  }

  private notifyRegistryListener(
    listener: (snapshot: ControlRegistrySnapshot) => void,
    snapshot: ControlRegistrySnapshot,
  ): void {
    try {
      listener(structuredClone(snapshot));
    } catch {
      // Local observers cannot break transport correlation.
    }
  }

  private notifyInvocationListener(
    listener: (event: ControlInvocationEvent) => void,
    event: ControlInvocationEvent,
  ): void {
    try {
      listener(structuredClone(event));
    } catch {
      // Local observers cannot break transport correlation.
    }
  }

  private unsubscribeInvocation(invocationId: string, state: InvocationState): Promise<void> {
    if (state.unsubscribePromise) return state.unsubscribePromise;
    state.listeners.clear();
    state.history = [];
    if (this.closed) {
      this.invocations.delete(invocationId);
      state.unsubscribePromise = Promise.resolve();
      return state.unsubscribePromise;
    }
    state.unsubscribePromise = this.request('unsubscribeInvocation', { invocationId })
      .then(() => undefined)
      .finally(() => {
        if (this.invocations.get(invocationId) === state) this.invocations.delete(invocationId);
        this.settledInvocationOrder = this.settledInvocationOrder.filter(entry => entry.state !== state);
        if (!state.settled) {
          state.settled = true;
          state.reject(new RuntimeControlClientError('disconnected', 'Invocation stream was unsubscribed'));
        }
      });
    return state.unsubscribePromise;
  }

  private activeInvocationCount(): number {
    let count = 0;
    for (const invocation of this.invocations.values()) {
      if (!invocation.settled) count += 1;
    }
    return count;
  }

  private retainSettledInvocation(invocationId: string, state: InvocationState): void {
    this.settledInvocationOrder.push({ id: invocationId, state });
    while (this.settledInvocationOrder.length > this.maxCompletedInvocations) {
      const oldest = this.settledInvocationOrder.shift();
      if (oldest && this.invocations.get(oldest.id) === oldest.state) this.invocations.delete(oldest.id);
    }
    if (this.maxCompletedInvocations === 0 && this.invocations.get(invocationId) === state) {
      this.invocations.delete(invocationId);
    }
  }

  private rememberCompletedRequest(id: string): void {
    if (this.maxCompletedRequestIds === 0) return;
    this.completedRequestIds.add(id);
    this.completedRequestOrder.push(id);
    while (this.completedRequestOrder.length > this.maxCompletedRequestIds) {
      const oldest = this.completedRequestOrder.shift();
      if (oldest) this.completedRequestIds.delete(oldest);
    }
  }
}
