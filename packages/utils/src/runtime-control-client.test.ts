import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_CONTROL_PROTOCOL,
  RUNTIME_CONTROL_VERSION,
  RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH,
  RUNTIME_CONTROL_MAX_WIRE_DEPTH,
  RUNTIME_CONTROL_MAX_WIRE_NODES,
  RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES,
  RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH,
  isRuntimeControlEvent,
  isRuntimeControlRequest,
  isRuntimeControlResponse,
  type ControlOperationDescriptor,
  type RuntimeControlRequest,
  type RuntimeControlResponse,
  type RuntimeControlEvent,
} from './control-plane.js';
import { RuntimeControlClient, RuntimeControlClientError } from './runtime-control-client.js';

function descriptor(id = 'apps.list'): ControlOperationDescriptor {
  return {
    id,
    source: { domain: 'apps', module: 'apps.ts', symbol: 'list' },
    summary: 'List apps',
    help: 'List apps.',
    usage: id,
    examples: [id],
    arguments: [],
    result: { schema: { type: 'object', properties: {} } },
    availability: { state: 'available' },
    effects: ['read'],
    policy: { access: 'allowed', confirmation: 'never' },
    classification: 'control-backed',
  };
}

function response(
  requestId: string,
  method: RuntimeControlResponse['method'],
  payload: unknown,
): RuntimeControlResponse {
  return {
    protocol: RUNTIME_CONTROL_PROTOCOL,
    version: RUNTIME_CONTROL_VERSION,
    kind: 'response',
    requestId,
    method,
    ok: true,
    payload,
  } as RuntimeControlResponse;
}

function errorResponse(
  requestId: string,
  method: RuntimeControlResponse['method'],
): RuntimeControlResponse {
  return {
    protocol: RUNTIME_CONTROL_PROTOCOL,
    version: RUNTIME_CONTROL_VERSION,
    kind: 'response',
    requestId,
    method,
    ok: false,
    error: { code: 'host_error', message: 'host rejected request' },
  };
}

function dispatch(data: unknown, options: { origin?: string; source?: MessageEventSource | null } = {}): void {
  window.dispatchEvent(new MessageEvent('message', {
    data,
    origin: options.origin ?? window.location.origin,
    source: options.source === undefined ? window.parent : options.source,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runtime control wire DTOs', () => {
  it('accepts only exact versioned caller-free request shapes with bounded JSON data', () => {
    const valid: RuntimeControlRequest = {
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'request',
      requestId: 'request-1',
      method: 'invoke',
      payload: { operationId: 'apps.list', arguments: {} },
    };
    expect(isRuntimeControlRequest(valid)).toBe(true);

    for (const field of ['caller', 'appId', 'windowId', 'role', 'capability', 'owner', 'confirmation']) {
      expect(isRuntimeControlRequest({ ...valid, [field]: 'spoofed' })).toBe(false);
      expect(isRuntimeControlRequest({ ...valid, payload: { ...valid.payload, [field]: 'spoofed' } })).toBe(false);
    }
    expect(isRuntimeControlRequest({ ...valid, version: 2 })).toBe(false);
    expect(isRuntimeControlRequest({ ...valid, requestId: 'x'.repeat(129) })).toBe(false);
    expect(isRuntimeControlRequest({ ...valid, payload: { ...valid.payload, arguments: { fn: () => {} } } }))
      .toBe(false);

    const accessor = {};
    Object.defineProperty(accessor, 'protocol', { enumerable: true, get: () => { throw new Error('getter ran'); } });
    expect(() => isRuntimeControlRequest(accessor)).not.toThrow();
    expect(isRuntimeControlRequest(accessor)).toBe(false);

    expect(isRuntimeControlResponse({
      ...response('request-1', 'list', { revision: 1, operations: [] }),
      payload: { revision: 1, operations: [], caller: 'spoofed' },
    })).toBe(false);
    expect(isRuntimeControlEvent({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'event',
      event: 'invocation',
      invocationId: 'host-1',
      payload: {
        kind: 'progress', invocationId: 'host-1', sequence: 1, timestamp: 1,
        message: 'working', caller: 'spoofed',
      },
    })).toBe(false);
  });

  it('recursively rejects malformed descriptors, snapshots, errors, and numeric fields', () => {
    const listed = response('request-1', 'list', { revision: 1, operations: [descriptor()] });
    const invalidDescriptors = [
      { ...descriptor(), source: { domain: 'apps', module: 'apps.ts', symbol: 'list', caller: 'bad' } },
      { ...descriptor(), arguments: [{ name: 'x', description: 'x', type: 'bogus' }] },
      { ...descriptor(), result: { schema: { type: 'array', items: { type: 'bogus' } } } },
      { ...descriptor(), result: { schema: { type: 'string' }, render: { kind: 'table', columns: [{ key: 1, label: 'x' }] } } },
      { ...descriptor(), availability: { state: 'maybe' } },
      { ...descriptor(), effects: ['read', 'eval'] },
      { ...descriptor(), policy: { access: 'root', confirmation: 'never' } },
      { ...descriptor(), classification: 'covered' },
    ];
    for (const invalid of invalidDescriptors) {
      expect(isRuntimeControlResponse({
        ...listed,
        payload: { revision: 1, operations: [invalid] },
      })).toBe(false);
    }

    const snapshot = {
      id: 'host-1', operationId: 'apps.list', operationRevision: 1, status: 'failed',
      cancellable: false, startedAt: 1, completedAt: 2, progress: [],
      error: { code: 'controller_error', message: 'failed' },
    };
    const runningSnapshot = {
      id: 'host-1', operationId: 'apps.list', operationRevision: 1, status: 'running',
      cancellable: true, startedAt: 1, progress: [],
    };
    for (const invalid of [
      { ...snapshot, operationRevision: -1 },
      { ...snapshot, startedAt: Number.NaN },
      { ...snapshot, status: 'mystery' },
      { ...snapshot, error: { code: 'mystery', message: 'failed' } },
      { ...runningSnapshot, completedAt: 2 },
      { ...runningSnapshot, error: { code: 'controller_error', message: 'failed' } },
      { ...snapshot, status: 'succeeded', error: { code: 'controller_error', message: 'failed' } },
      { ...snapshot, completedAt: 0 },
      { ...snapshot, progress: [{
        kind: 'progress', invocationId: 'host-1', sequence: -1, timestamp: 1, message: 'bad',
      }] },
      { ...snapshot, progress: [{
        kind: 'progress', invocationId: 'other-host', sequence: 1, timestamp: 1, message: 'bad',
      }] },
      { ...snapshot, progress: [
        { kind: 'progress', invocationId: 'host-1', sequence: 1, timestamp: 1, message: 'first' },
        { kind: 'progress', invocationId: 'host-1', sequence: 1, timestamp: 2, message: 'duplicate' },
      ] },
      { ...snapshot, progress: [
        { kind: 'progress', invocationId: 'host-1', sequence: 2, timestamp: 1, message: 'second' },
        { kind: 'progress', invocationId: 'host-1', sequence: 1, timestamp: 2, message: 'regressed' },
      ] },
    ]) {
      expect(isRuntimeControlEvent({
        protocol: RUNTIME_CONTROL_PROTOCOL,
        version: RUNTIME_CONTROL_VERSION,
        kind: 'event',
        event: 'invocation-result',
        invocationId: 'host-1',
        snapshot: invalid,
      })).toBe(false);
    }

    expect(isRuntimeControlResponse(response('request-running', 'getInvocation', runningSnapshot))).toBe(true);
  });

  it('allows bounded registry snapshots without relaxing invocation result budgets', () => {
    const operations = Array.from({ length: 240 }, (_, index) => descriptor(`apps.${index}`));
    expect(operations.length).toBeLessThan(RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH);
    expect(RUNTIME_CONTROL_MAX_REGISTRY_WIRE_NODES).toBeGreaterThan(RUNTIME_CONTROL_MAX_WIRE_NODES);
    const snapshot = { revision: 1, operations };

    expect(isRuntimeControlResponse(response('large-list', 'list', snapshot))).toBe(true);
    expect(isRuntimeControlResponse(response('large-subscription', 'subscribeRegistry', {
      subscriptionId: 'registry-large',
      snapshot,
    }))).toBe(true);
    expect(isRuntimeControlEvent({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'event',
      event: 'registry',
      subscriptionId: 'registry-large',
      snapshot,
    })).toBe(true);

    const nodesPerEntry = 5;
    const nodeHeavy = Array.from({ length: Math.ceil(RUNTIME_CONTROL_MAX_WIRE_NODES / nodesPerEntry) }, () => ({
      a: 1, b: 2, c: 3, d: 4,
    }));
    expect(isRuntimeControlResponse(response('large-result', 'getInvocation', {
      id: 'host-large',
      operationId: 'apps.list',
      operationRevision: 1,
      status: 'succeeded',
      cancellable: false,
      startedAt: 1,
      completedAt: 2,
      progress: [],
      value: { nodeHeavy },
    }))).toBe(false);
  });
});

describe('RuntimeControlClient', () => {
  it('never reuses request IDs during one client lifetime after replay tombstone eviction', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const client = new RuntimeControlClient({
      maxCompletedRequestIds: 1,
      requestIdFactory: () => 'same-base',
    });

    const first = client.list();
    const firstId = (postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest).requestId;
    dispatch(response(firstId, 'list', { revision: 1, operations: [] }));
    await first;
    const second = client.list();
    const secondId = (postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest).requestId;
    dispatch(response(secondId, 'list', { revision: 2, operations: [] }));
    await second;
    const third = client.list();
    const thirdId = (postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest).requestId;
    expect(new Set([firstId, secondId, thirdId]).size).toBe(3);

    let settled = false;
    void third.then(() => { settled = true; });
    dispatch(response(firstId, 'list', { revision: 999, operations: [] }));
    await Promise.resolve();
    expect(settled).toBe(false);
    dispatch(response(thirdId, 'list', { revision: 3, operations: [] }));
    await expect(third).resolves.toMatchObject({ revision: 3 });
    client.close();
  });

  it('reserves invocation and subscription capacity before host replies', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    let base = 0;
    const client = new RuntimeControlClient({
      maxPending: 8,
      maxInvocations: 1,
      maxSubscriptions: 1,
      requestIdFactory: () => `capacity-${++base}`,
    });
    const firstInvocation = client.invoke({ operationId: 'apps.list', arguments: {} });
    await expect(client.invoke({ operationId: 'apps.list', arguments: {} }))
      .rejects.toMatchObject({ code: 'too_many_pending' });
    const invokeRequest = postMessage.mock.calls.find(([item]) => (
      (item as RuntimeControlRequest).method === 'invoke'
    ))?.[0] as RuntimeControlRequest;
    dispatch(response(invokeRequest.requestId, 'invoke', { invocationId: 'host-capacity', cancellable: false }));
    const handle = await firstInvocation;

    const firstSubscription = client.subscribeRegistry(() => {});
    await expect(client.subscribeRegistry(() => {})).rejects.toMatchObject({ code: 'too_many_pending' });
    const subscribeRequest = postMessage.mock.calls.find(([item]) => (
      (item as RuntimeControlRequest).method === 'subscribeRegistry'
    ))?.[0] as RuntimeControlRequest;
    dispatch(response(subscribeRequest.requestId, 'subscribeRegistry', {
      subscriptionId: 'subscription-capacity', snapshot: { revision: 1, operations: [] },
    }));
    await firstSubscription;
    client.close();
    await expect(handle.result).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('releases invocation and subscription reservations after rejection and close', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    let base = 0;
    const client = new RuntimeControlClient({
      maxInvocations: 1,
      maxSubscriptions: 1,
      requestIdFactory: () => `release-${++base}`,
    });

    const rejectedInvocation = client.invoke({ operationId: 'apps.list', arguments: {} });
    const rejectedInvokeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(errorResponse(rejectedInvokeRequest.requestId, 'invoke'));
    await expect(rejectedInvocation).rejects.toMatchObject({ code: 'host_error' });
    const pendingInvocation = client.invoke({ operationId: 'apps.list', arguments: {} });

    const rejectedSubscription = client.subscribeRegistry(() => {});
    const rejectedSubscriptionRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(errorResponse(rejectedSubscriptionRequest.requestId, 'subscribeRegistry'));
    await expect(rejectedSubscription).rejects.toMatchObject({ code: 'host_error' });
    const pendingSubscription = client.subscribeRegistry(() => {});

    client.close();
    await expect(pendingInvocation).rejects.toMatchObject({ code: 'disconnected' });
    await expect(pendingSubscription).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('reuses invocation capacity after terminal results and bounds retained histories', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    let base = 0;
    const client = new RuntimeControlClient({
      maxInvocations: 1,
      maxCompletedInvocations: 2,
      requestIdFactory: () => `sequential-${++base}`,
    });
    const handles = [];

    for (let index = 1; index <= 3; index += 1) {
      const invocationPromise = client.invoke({ operationId: 'apps.list', arguments: {} });
      const invokeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
      const invocationId = `host-sequential-${index}`;
      dispatch(response(invokeRequest.requestId, 'invoke', { invocationId, cancellable: false }));
      const handle = await invocationPromise;
      handles.push(handle);
      dispatch({
        protocol: RUNTIME_CONTROL_PROTOCOL,
        version: RUNTIME_CONTROL_VERSION,
        kind: 'event',
        event: 'invocation',
        invocationId,
        payload: {
          kind: 'progress', invocationId, sequence: 1, timestamp: index, message: `step ${index}`,
        },
      });
      dispatch({
        protocol: RUNTIME_CONTROL_PROTOCOL,
        version: RUNTIME_CONTROL_VERSION,
        kind: 'event',
        event: 'invocation-result',
        invocationId,
        snapshot: {
          id: invocationId,
          operationId: 'apps.list',
          operationRevision: 1,
          status: 'succeeded',
          cancellable: false,
          startedAt: index,
          completedAt: index + 1,
          progress: [],
          value: {},
        },
      });
      await expect(handle.result).resolves.toMatchObject({ status: 'succeeded' });
    }

    const replayed: string[][] = [[], [], []];
    handles.forEach((handle, index) => {
      handle.subscribe(event => replayed[index]?.push(event.kind));
    });
    expect(replayed).toEqual([[], ['progress'], ['progress']]);
    client.close();
  });

  it('buffers pre-registration events, rejects replay/regression, and unsubscribes invocation streams once', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    let base = 0;
    const client = new RuntimeControlClient({ requestIdFactory: () => `ordering-${++base}` });

    const revisions: number[] = [];
    const subscriptionPromise = client.subscribeRegistry(snapshot => revisions.push(snapshot.revision));
    const subscribeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(subscribeRequest.requestId, 'subscribeRegistry', {
      subscriptionId: 'registry-order', snapshot: { revision: 1, operations: [] },
    }));
    for (const revision of [2, 2, 1]) {
      dispatch({
        protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'registry',
        subscriptionId: 'registry-order', snapshot: { revision, operations: [] },
      });
    }
    await subscriptionPromise;
    expect(revisions).toEqual([1, 2]);

    const invocationPromise = client.invoke({ operationId: 'apps.list', arguments: {} });
    const invokeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    for (const sequence of [2, 1, 2]) {
      dispatch({
        protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation',
        invocationId: 'host-order', payload: {
          kind: 'progress', invocationId: 'host-order', sequence, timestamp: sequence, message: `step ${sequence}`,
        },
      });
    }
    dispatch({
      protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event',
      event: 'invocation-result', invocationId: 'host-order', snapshot: {
        id: 'host-order', operationId: 'apps.list', operationRevision: 1, status: 'succeeded',
        cancellable: false, startedAt: 1, completedAt: 2, progress: [], value: {},
      },
    });
    dispatch(response(invokeRequest.requestId, 'invoke', { invocationId: 'host-order', cancellable: false }));
    const invocation = await invocationPromise;
    const sequences: number[] = [];
    invocation.subscribe(event => sequences.push(event.sequence));
    expect(sequences).toEqual([2]);
    await expect(invocation.result).resolves.toMatchObject({ status: 'succeeded' });

    const firstUnsubscribe = invocation.unsubscribe();
    const secondUnsubscribe = invocation.unsubscribe();
    const unsubscribeRequests = postMessage.mock.calls.filter(([item]) => (
      (item as RuntimeControlRequest).method === 'unsubscribeInvocation'
    ));
    expect(unsubscribeRequests).toHaveLength(1);
    const unsubscribeRequest = unsubscribeRequests[0]?.[0] as RuntimeControlRequest;
    dispatch(response(unsubscribeRequest.requestId, 'unsubscribeInvocation', { unsubscribed: true }));
    await Promise.all([firstUnsubscribe, secondUnsubscribe]);
    client.close();
  });

  it('rejects unsafe origins and oversized outgoing requests before postMessage', async () => {
    expect(() => new RuntimeControlClient({ origin: '*' })).toThrow(RuntimeControlClientError);
    expect(() => new RuntimeControlClient({ origin: '' })).toThrow(RuntimeControlClientError);

    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const client = new RuntimeControlClient();
    let deep: unknown = 'leaf';
    for (let index = 0; index <= RUNTIME_CONTROL_MAX_WIRE_DEPTH; index += 1) deep = { next: deep };
    await expect(client.invoke({ operationId: 'apps.list', arguments: { deep } } as never))
      .rejects.toMatchObject({ code: 'invalid_request' });
    await expect(client.invoke({
      operationId: 'apps.list',
      arguments: { value: 'x'.repeat(RUNTIME_CONTROL_MAX_WIRE_STRING_LENGTH + 1) },
    })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(client.invoke({
      operationId: 'apps.list',
      arguments: { values: Array.from({ length: RUNTIME_CONTROL_MAX_WIRE_COLLECTION_LENGTH + 1 }, () => null) },
    })).rejects.toMatchObject({ code: 'invalid_request' });
    const nodesPerEntry = 5;
    const nodeHeavy = Array.from({ length: Math.ceil(RUNTIME_CONTROL_MAX_WIRE_NODES / nodesPerEntry) }, () => ({
      a: 1, b: 2, c: 3, d: 4,
    }));
    await expect(client.invoke({ operationId: 'apps.list', arguments: { nodeHeavy } }))
      .rejects.toMatchObject({ code: 'invalid_request' });
    expect(postMessage).not.toHaveBeenCalled();
    client.close();
  });

  it('correlates out-of-order replies and ignores malformed, replayed, wrong-method, and foreign messages', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const ids = ['request-1', 'request-2', 'request-1', 'request-3'];
    const client = new RuntimeControlClient({ requestIdFactory: () => ids.shift() ?? 'fallback' });
    const listed = client.list();
    const described = client.describe('apps.list');
    const requests = postMessage.mock.calls.map(([message]) => message as RuntimeControlRequest);
    const listRequest = requests[0]!;
    const describeRequest = requests[1]!;

    dispatch(response(describeRequest.requestId, 'list', { revision: 99, operations: [] }));
    dispatch(response(describeRequest.requestId, 'describe', descriptor()));
    dispatch(response(listRequest.requestId, 'list', { revision: 88, operations: [] }), {
      source: {} as WindowProxy,
    });
    dispatch(response(listRequest.requestId, 'list', { revision: 1, operations: [descriptor()] }), {
      origin: 'https://foreign.example',
    });
    dispatch({ nonsense: true });
    dispatch(response(listRequest.requestId, 'list', { revision: 1, operations: [descriptor()] }));
    dispatch(response(listRequest.requestId, 'list', { revision: 500, operations: [] }));

    await expect(listed).resolves.toMatchObject({ revision: 1 });
    await expect(described).resolves.toMatchObject({ id: 'apps.list' });
    expect(new Set(requests.map(request => request.requestId)).size).toBe(2);
    expect(JSON.stringify(requests)).not.toMatch(/caller|appId|windowId|role|capability|owner|confirmation/);

    const resolved = client.resolve({ path: ['apps', 'list'] });
    const third = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(third.requestId).not.toBe(listRequest.requestId);
    expect(third.requestId).not.toBe(describeRequest.requestId);
    dispatch(response(third.requestId, 'resolve', { revision: 1, descriptor: descriptor() }));
    await expect(resolved).resolves.toMatchObject({ descriptor: { id: 'apps.list' } });
    client.close();
  });

  it('delivers bounded registry and invocation lifecycles and targets cancellation by host ID', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    let nextId = 0;
    const client = new RuntimeControlClient({ requestIdFactory: () => `request-${++nextId}` });
    const revisions: number[] = [];
    const subscriptionPromise = client.subscribeRegistry(snapshot => revisions.push(snapshot.revision));
    const subscribeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(subscribeRequest.requestId, 'subscribeRegistry', {
      subscriptionId: 'registry-1',
      snapshot: { revision: 1, operations: [] },
    }));
    const subscription = await subscriptionPromise;
    dispatch({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'event',
      event: 'registry',
      subscriptionId: 'registry-1',
      snapshot: { revision: 2, operations: [descriptor()] },
    } satisfies RuntimeControlEvent);
    expect(revisions).toEqual([1, 2]);

    const invocationPromise = client.invoke({ operationId: 'apps.list', arguments: {} });
    const invokeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(invokeRequest.requestId, 'invoke', { invocationId: 'host-1', cancellable: true }));
    const invocation = await invocationPromise;
    const events: string[] = [];
    invocation.subscribe(event => events.push(event.kind));
    dispatch({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'event',
      event: 'invocation',
      invocationId: 'host-1',
      payload: {
        kind: 'progress', invocationId: 'host-1', sequence: 1, timestamp: 1, message: 'working',
      },
    } satisfies RuntimeControlEvent);
    const cancel = invocation.cancel();
    const cancelRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(cancelRequest.requestId, 'cancel', { cancelled: true }));
    await expect(cancel).resolves.toBe(true);
    dispatch({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'event',
      event: 'invocation-result',
      invocationId: 'host-1',
      snapshot: {
        id: 'host-1', operationId: 'apps.list', operationRevision: 1, status: 'cancelled',
        cancellable: true, startedAt: 1, completedAt: 2, progress: [],
      },
    } satisfies RuntimeControlEvent);
    await expect(invocation.result).resolves.toMatchObject({ id: 'host-1', status: 'cancelled' });
    expect(events).toEqual(['progress']);

    const unsubscribe = subscription.unsubscribe();
    const unsubscribeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(unsubscribeRequest.requestId, 'unsubscribeRegistry', { unsubscribed: true }));
    await unsubscribe;
    expect(postMessage).toHaveBeenCalledTimes(4);
    client.close();
  });

  it('bounds pending calls and rejects pending work while removing its single listener on close', async () => {
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const remove = vi.spyOn(window, 'removeEventListener');
    let id = 0;
    const client = new RuntimeControlClient({ maxPending: 1, requestIdFactory: () => `bounded-${++id}` });
    const pending = client.list();
    await expect(client.describe('apps.list')).rejects.toMatchObject({ code: 'too_many_pending' });

    client.close();
    await expect(pending).rejects.toMatchObject({ code: 'disconnected' });
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    expect(() => client.list()).toThrow(RuntimeControlClientError);
  });
});
