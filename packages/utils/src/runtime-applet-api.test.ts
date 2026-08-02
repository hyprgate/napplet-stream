import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_CONTROL_PROTOCOL,
  RUNTIME_CONTROL_VERSION,
  type ControlOperationDescriptor,
  type RuntimeControlRequest,
  type RuntimeControlResponse,
} from './control-plane.js';
import { runtimeAppletApi, runtimeCommands, runtimeControls } from './runtime-applet-api.js';

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

afterEach(() => {
  runtimeControls.close();
  vi.restoreAllMocks();
});

describe('runtime applet public control API', () => {
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
    dispatch(response(getRequest, descriptor()));
    await expect(command).resolves.toEqual(expect.objectContaining({
      id: 'window.open-test',
      name: 'Open test window',
      category: 'window',
      executable: true,
    }));

    const execution = runtimeCommands.execute('window.open-test', ['feed']);
    const describeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(describeRequest.method).toBe('describe');
    dispatch(response(describeRequest, descriptor()));
    await Promise.resolve();
    const invokeRequest = postMessage.mock.calls.at(-1)?.[0] as RuntimeControlRequest;
    expect(invokeRequest).toMatchObject({
      method: 'invoke',
      payload: { operationId: 'window.open-test', arguments: { target: 'feed' } },
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
        id: 'host-command-1', operationId: 'window.open-test', operationRevision: 1,
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
    dispatch(response(describeRequest, descriptor()));
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
        id: 'host-command-failed', operationId: 'window.open-test', operationRevision: 1,
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
