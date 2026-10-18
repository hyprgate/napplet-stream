import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_CONTROL_PROTOCOL,
  RUNTIME_CONTROL_VERSION,
  type ControlOperationDescriptor,
  type RuntimeControlRequest,
  type RuntimeControlResponse,
} from './control-plane.js';
import { runtimeAppletApi, runtimeCommands, runtimeControls, runtimeIdentity, runtimeRelay, type RuntimeAppletHostApi, type RuntimeAppletSubscription } from './runtime-applet-api.js';

function descriptor(): ControlOperationDescriptor {
  return {
    id: 'window.open-test',
    source: { domain: 'window', module: 'window-controller.ts', symbol: 'openTest' },
    summary: 'Open test window',
    help: 'Open the test window.',
    usage: 'window.open-test [target]',
    examples: ['window.open-test feed'],
    arguments: [{ name: 'target', description: 'Window target.', type: 'string' }],
    result: { schema: { type: 'object', properties: {} } },
    availability: { state: 'available' },
    effects: ['read'],
    policy: { access: 'allowed', confirmation: 'never' },
    classification: 'control-backed',
  };
}

function response(request: RuntimeControlRequest, payload: unknown): RuntimeControlResponse {
  return {
    protocol: RUNTIME_CONTROL_PROTOCOL,
    version: RUNTIME_CONTROL_VERSION,
    kind: 'response',
    requestId: request.requestId,
    method: request.method,
    ok: true,
    payload,
  } as RuntimeControlResponse;
}

function dispatch(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window.parent,
    origin: window.location.origin,
    data,
  }));
}

function isSubscription(value: unknown): value is RuntimeAppletSubscription {
  return typeof value === 'object' && value !== null && 'close' in value && typeof value.close === 'function';
}

afterEach(() => {
  runtimeControls.close();
  delete window.__HYPRGATE_RUNTIME_APPLET_API__;
  vi.restoreAllMocks();
});

describe('runtime applet public control API', () => {
  it.each([
    ['selected relay helper', 'relay.runtime.identity-relays', { code: 'disconnected' }, (_onEvent: ReturnType<typeof vi.fn>) => runtimeIdentity.getRelays()],
    ['selected relay subscription', 'relay.runtime.subscribe', undefined, (onEvent: (result: unknown) => void) => runtimeRelay.subscribe([{ kinds: [1] }], onEvent)],
    ['selected relay query', 'relay.runtime.query', { code: 'disconnected' }, (_onEvent: ReturnType<typeof vi.fn>) => runtimeRelay.query([{ kinds: [1] }])],
    ['selected compatibility command', 'window.open-test', { code: 'disconnected', status: 'failed' }, (_onEvent: ReturnType<typeof vi.fn>) => runtimeCommands.execute('window.open-test', [])],
  ])('does not replace the client after close between selection and invocation: %s', async (_label, operationId, expectedError, start) => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const received = vi.fn();
    const operation = start(received);
    const subscription = isSubscription(operation) ? operation : undefined;
    const settled = subscription ? undefined : (operation as Promise<unknown>).catch(error => error);
    const selected = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(selected).toMatchObject({ method: 'describe', payload: { operationId } });
    dispatch(response(selected, { revision: 40, registrationRevision: 7, descriptor: { ...descriptor(), id: operationId } }));
    runtimeControls.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(postMessage.mock.calls).toHaveLength(1);
    if (subscription) {
      subscription.close();
      expect(received).not.toHaveBeenCalled();
    } else {
      expect(expectedError).toBeDefined();
      expect(await settled).toMatchObject(expectedError!);
    }
  });

  it('reassembles declared relay query progress and ignores queued events after a subscription closes', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const relayDescriptor = { ...descriptor(), id: 'relay.runtime.query' };
    const event = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128), kind: 1, created_at: 1, content: 'relay event', tags: [] };

    const query = runtimeRelay.query([{ kinds: [1] }]);
    const queryDescribe = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(queryDescribe, { revision: 40, registrationRevision: 7, descriptor: relayDescriptor }));
    await Promise.resolve();
    const queryInvoke = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(queryInvoke).toMatchObject({ method: 'invoke', payload: { operationId: 'relay.runtime.query', expectedRegistrationRevision: 7 } });
    dispatch(response(queryInvoke, { invocationId: 'relay-query', cancellable: false }));
    await Promise.resolve();
    const progress = { kind: 'progress' as const, invocationId: 'relay-query', sequence: 1, timestamp: 1, message: 'Runtime relay query chunk', data: { streamId: 'query-0', chunkIndex: 0, totalChunks: 1, payload: JSON.stringify({ event, relayHints: ['wss://relay.example'] }) } };
    dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation', invocationId: 'relay-query', payload: progress });
    dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation-result', invocationId: 'relay-query', snapshot: { id: 'relay-query', operationId: 'relay.runtime.query', operationRevision: 7, status: 'succeeded', cancellable: false, startedAt: 1, completedAt: 2, progress: [progress], value: { count: 1, truncated: false } } });
    await expect(query).resolves.toEqual([{ event, relayHints: ['wss://relay.example'] }]);

    const received = vi.fn();
    const subscription = runtimeRelay.subscribe([{ kinds: [1] }], received);
    const subscribeDescribe = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(subscribeDescribe, { revision: 41, registrationRevision: 8, descriptor: { ...relayDescriptor, id: 'relay.runtime.subscribe' } }));
    await Promise.resolve();
    const subscribeInvoke = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(subscribeInvoke).toMatchObject({ method: 'invoke', payload: { operationId: 'relay.runtime.subscribe', expectedRegistrationRevision: 8 } });
    dispatch(response(subscribeInvoke, { invocationId: 'relay-subscribe', cancellable: true }));
    await Promise.resolve();
    subscription.close();
    await Promise.resolve();
    await Promise.resolve();
    const cancelRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(cancelRequest, { cancelled: true }));
    dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation', invocationId: 'relay-subscribe', payload: { kind: 'progress', invocationId: 'relay-subscribe', sequence: 1, timestamp: 1, message: 'Runtime relay event chunk', data: { streamId: 'subscription-0', chunkIndex: 0, totalChunks: 1, payload: JSON.stringify({ event }) } } });
    dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation-result', invocationId: 'relay-subscribe', snapshot: { id: 'relay-subscribe', operationId: 'relay.runtime.subscribe', operationRevision: 8, status: 'succeeded', cancellable: true, startedAt: 1, completedAt: 2, progress: [] } });
    expect(received).not.toHaveBeenCalled();
  });

  it('forwards a host-owned identity profile subscription and its close handle', () => {
    const listener = vi.fn();
    const close = vi.fn();
    const subscribeProfile = vi.fn(() => ({ close }));
    const host: RuntimeAppletHostApi = {
      identity: {
        getPublicKey: async () => 'a'.repeat(64),
        getProfile: async () => null,
        getFollows: async () => [],
        subscribeProfile,
      },
      intent: { invoke: async (_appId, request) => ({
        ok: false,
        archetype: request.archetype,
        action: request.action ?? 'open',
        handled: false,
        error: 'unavailable',
      }) },
    };
    window.__HYPRGATE_RUNTIME_APPLET_API__ = host;

    const subscription = runtimeIdentity.subscribeProfile(listener);

    expect(subscribeProfile).toHaveBeenCalledWith(listener);
    subscription.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('projects command compatibility over the lazy secure control client and awaits truthful results', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    expect(runtimeAppletApi.control).toBe(runtimeControls);

    const listed = runtimeCommands.list();
    const listRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(listRequest, { revision: 1, operations: [descriptor()] }));
    await expect(listed).resolves.toEqual([expect.objectContaining({
      id: 'window.open-test',
      name: 'Open test window',
      category: 'window',
      args: [{ name: 'target', description: 'Window target.' }],
      executable: true,
    })]);

    const command = runtimeCommands.get('window.open-test');
    const getRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(getRequest).toMatchObject({
      method: 'describe',
      payload: { operationId: 'window.open-test' },
    });
    dispatch(response(getRequest, { revision: 40, registrationRevision: 7, descriptor: descriptor() }));
    await expect(command).resolves.toEqual(expect.objectContaining({
      id: 'window.open-test',
      name: 'Open test window',
      category: 'window',
      executable: true,
    }));

    const execution = runtimeCommands.execute('window.open-test', ['feed']);
    const describeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(describeRequest.method).toBe('describe');
    dispatch(response(describeRequest, { revision: 40, registrationRevision: 7, descriptor: descriptor() }));
    await Promise.resolve();
    const invokeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(invokeRequest).toMatchObject({
      method: 'invoke',
      payload: {
        operationId: 'window.open-test',
        arguments: { target: 'feed' },
        expectedRegistrationRevision: 7,
      },
    });
    dispatch(response(invokeRequest, { invocationId: 'host-command-1', cancellable: false }));
    await Promise.resolve();
    dispatch({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'event',
      event: 'invocation-result',
      invocationId: 'host-command-1',
      snapshot: {
        id: 'host-command-1', operationId: 'window.open-test', operationRevision: 7,
        status: 'succeeded', cancellable: false, startedAt: 1, completedAt: 2,
        progress: [], value: {},
      },
    });
    await expect(execution).resolves.toEqual({ id: 'window.open-test', executed: true });
  });

  it('throws sanitized compatibility failures without exposing host result details', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const execution = runtimeCommands.execute('window.open-test', []);
    const describeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(describeRequest, { revision: 40, registrationRevision: 7, descriptor: descriptor() }));
    await Promise.resolve();
    const invokeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    dispatch(response(invokeRequest, { invocationId: 'host-command-failed', cancellable: false }));
    await Promise.resolve();
    dispatch({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'event',
      event: 'invocation-result',
      invocationId: 'host-command-failed',
      snapshot: {
        id: 'host-command-failed', operationId: 'window.open-test', operationRevision: 7,
        status: 'failed', cancellable: false, startedAt: 1, completedAt: 2, progress: [],
        error: { code: 'controller_error', message: 'do-not-echo-secret' },
      },
    });

    await expect(execution).rejects.toMatchObject({
      name: 'RuntimeAppletCommandError',
      code: 'controller_error',
      operationId: 'window.open-test',
    });
    await expect(execution).rejects.not.toThrow('do-not-echo-secret');
  });
});

it('forwards separately selected identity-relay and publish revisions through the shared helper', async () => {
  const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  const relays = runtimeIdentity.getRelays();
  const described = postMessage.mock.calls.at(-1)![0] as RuntimeControlRequest;
  expect(described).toMatchObject({ method: 'describe', payload: { operationId: 'relay.runtime.identity-relays' } });
  dispatch(response(described, { revision: 50, registrationRevision: 9, descriptor: { ...descriptor(), id: 'relay.runtime.identity-relays' } }));
  await Promise.resolve();
  const invoked = postMessage.mock.calls.at(-1)![0] as RuntimeControlRequest;
  expect(invoked).toMatchObject({ method: 'invoke', payload: { operationId: 'relay.runtime.identity-relays', arguments: {}, expectedRegistrationRevision: 9 } });
  dispatch(response(invoked, { invocationId: 'identity-relays', cancellable: false }));
  await Promise.resolve();
  dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation-result', invocationId: 'identity-relays', snapshot: {
    id: 'identity-relays', operationId: 'relay.runtime.identity-relays', operationRevision: 9, status: 'succeeded', cancellable: false, startedAt: 1, completedAt: 2, progress: [], value: { relays: [{ url: 'wss://relay.example', read: true, write: false }] },
  } });
  await expect(relays).resolves.toEqual({ 'wss://relay.example': { read: true, write: false } });

  const template = { kind: 1, content: 'Revision contract fixture', tags: [], created_at: 1 };
  const publish = runtimeRelay.publish(template);
  const publishDescribe = postMessage.mock.calls.at(-1)![0] as RuntimeControlRequest;
  dispatch(response(publishDescribe, { revision: 51, registrationRevision: 10, descriptor: { ...descriptor(), id: 'relay.runtime.publish' } }));
  await Promise.resolve();
  const publishInvoke = postMessage.mock.calls.at(-1)![0] as RuntimeControlRequest;
  expect(publishInvoke).toMatchObject({ method: 'invoke', payload: { operationId: 'relay.runtime.publish', arguments: { event: template }, expectedRegistrationRevision: 10 } });
  dispatch(response(publishInvoke, { invocationId: 'publish-stale', cancellable: false }));
  await Promise.resolve();
  dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation-result', invocationId: 'publish-stale', snapshot: {
    id: 'publish-stale', operationId: 'relay.runtime.publish', operationRevision: 11, status: 'failed', cancellable: false, startedAt: 1, completedAt: 2, progress: [],
    error: { code: 'stale_descriptor', message: 'Descriptor changed.', details: { revision: 52, guidance: 'Rediscover and retry explicitly.' } },
  } });
  await expect(publish).rejects.toMatchObject({ code: 'stale_descriptor', status: 'failed' });
  await Promise.resolve();
  expect(postMessage.mock.calls.filter(([request]) => request.method === 'invoke' && request.payload.operationId === 'relay.runtime.publish')).toHaveLength(1);
});
it('never replays a stale compatibility command and rediscovers only on a new explicit call', async () => {
  const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  const execution = runtimeCommands.execute('window.open-test', ['feed']);
  const selected = postMessage.mock.calls.at(-1)![0] as RuntimeControlRequest;
  dispatch(response(selected, { revision: 40, registrationRevision: 7, descriptor: descriptor() }));
  await Promise.resolve();
  const invoked = postMessage.mock.calls.at(-1)![0] as RuntimeControlRequest;
  expect(invoked).toMatchObject({ payload: { expectedRegistrationRevision: 7 } });
  dispatch(response(invoked, { invocationId: 'command-stale', cancellable: false }));
  await Promise.resolve();
  dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation-result', invocationId: 'command-stale', snapshot: {
    id: 'command-stale', operationId: 'window.open-test', operationRevision: 8, status: 'failed', cancellable: false, startedAt: 1, completedAt: 2, progress: [],
    error: { code: 'stale_descriptor', message: 'Descriptor changed.', details: { revision: 41, guidance: 'Rediscover and retry explicitly.' } },
  } });
  await expect(execution).rejects.toMatchObject({ code: 'stale_descriptor' });
  await Promise.resolve();
  expect(postMessage.mock.calls.filter(([request]) => request.method === 'invoke')).toHaveLength(1);
  expect(postMessage.mock.calls.filter(([request]) => request.method === 'describe')).toHaveLength(1);
  const retry = runtimeCommands.execute('window.open-test', ['feed']);
  const refreshed = postMessage.mock.calls.at(-1)![0] as RuntimeControlRequest;
  expect(refreshed.method).toBe('describe');
  dispatch(response(refreshed, { revision: 41, registrationRevision: 8, descriptor: descriptor() }));
  await Promise.resolve();
  const retryInvoke = postMessage.mock.calls.at(-1)![0] as RuntimeControlRequest;
  expect(retryInvoke).toMatchObject({ method: 'invoke', payload: { expectedRegistrationRevision: 8 } });
  expect(postMessage.mock.calls.filter(([request]) => request.method === 'invoke')).toHaveLength(2);
  dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'response', requestId: retryInvoke.requestId, method: 'invoke', ok: false, error: { code: 'host_error', message: 'Fixture rejection' } });
  await expect(retry).rejects.toMatchObject({ code: 'host_error' });
});

it('does not expose a generic storage compatibility bypass', () => {
  expect(runtimeAppletApi).not.toHaveProperty('storage');
});
