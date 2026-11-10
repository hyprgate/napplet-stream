import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import {
  RUNTIME_CONTROL_PROTOCOL,
  RUNTIME_CONTROL_VERSION,
  type ControlOperationDescriptor,
  type RuntimeControlRequest,
} from './control-plane.js';
import { runtimeControls, runtimeOutbox, runtimeRelay } from './runtime-applet-api.js';

/**
 * Long-lived relay and outbox streams are control invocations that stay open
 * until the applet closes them. A runtime applet that follows a real social
 * graph holds dozens of them at once (the App Store home view settles around 58
 * with a ~1k-follow account), and one-shot commands such as a review publish or
 * an install must still go through.
 */

const STREAMS = 96;
const KIND_DRAFT_REVIEW = 31986;

function descriptor(id: string): ControlOperationDescriptor {
  return {
    id,
    source: { domain: 'relay', module: 'relay-runtime-control.ts', symbol: id },
    summary: id,
    help: id,
    usage: id,
    examples: [id],
    arguments: [],
    result: { schema: { type: 'object', properties: {} } },
    availability: { state: 'available' },
    effects: id === 'relay.runtime.publish' ? ['publish'] : ['read'],
    policy: { access: 'allowed', confirmation: 'never' },
    classification: 'control-backed',
  };
}

function dispatch(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin: window.location.origin, data }));
}

/** Shell stand-in: streams stay open forever, publishes settle with the published event. */
function installHost() {
  const invoked: RuntimeControlRequest[] = [];
  let nextInvocation = 0;
  vi.spyOn(window.parent, 'postMessage').mockImplementation((message: unknown) => {
    const request = message as RuntimeControlRequest;
    const reply = (payload: unknown) => queueMicrotask(() => dispatch({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'response',
      requestId: request.requestId,
      method: request.method,
      ok: true,
      payload,
    }));
    if (request.method === 'describe') {
      const { operationId } = request.payload as { operationId: string };
      reply({ revision: 1, registrationRevision: 1, descriptor: descriptor(operationId) });
      return;
    }
    if (request.method === 'cancel') return reply({ cancelled: true });
    if (request.method !== 'invoke') return reply({});
    invoked.push(request);
    const { operationId, arguments: args } = request.payload as { operationId: string; arguments: { event?: unknown } };
    const invocationId = `invocation-${nextInvocation += 1}`;
    const stream = operationId !== 'relay.runtime.publish';
    reply({ invocationId, cancellable: stream });
    if (stream) return;
    queueMicrotask(() => queueMicrotask(() => dispatch({
      protocol: RUNTIME_CONTROL_PROTOCOL,
      version: RUNTIME_CONTROL_VERSION,
      kind: 'event',
      event: 'invocation-result',
      invocationId,
      snapshot: {
        id: invocationId,
        operationId,
        operationRevision: 1,
        status: 'succeeded',
        cancellable: false,
        startedAt: 1,
        completedAt: 2,
        progress: [],
        value: { event: args.event, relays: ['wss://relay.example'] },
      },
    })));
  });
  return { invoked };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  runtimeControls.close();
  vi.restoreAllMocks();
});

describe('runtime applet control budget under realistic stream load', () => {
  const signed = finalizeEvent({
    kind: KIND_DRAFT_REVIEW,
    created_at: 1_760_000_000,
    tags: [['d', 'review:feed'], ['rating', '5']],
    content: 'Works well.',
  }, generateSecretKey());
  // A clean wire object: finalizeEvent attaches a non-JSON verification marker.
  const review = { id: signed.id, pubkey: signed.pubkey, created_at: signed.created_at, kind: signed.kind, tags: signed.tags, content: signed.content, sig: signed.sig };

  it('opens every requested outbox and relay stream instead of silently dropping the overflow', async () => {
    const host = installHost();
    const subs = Array.from({ length: STREAMS }, (_, index) => index % 4 === 0
      ? runtimeRelay.subscribe([{ kinds: [KIND_DRAFT_REVIEW], '#d': [`review:${index}`] }], () => undefined)
      : runtimeOutbox.subscribe([{ kinds: [KIND_DRAFT_REVIEW], '#d': [`review:${index}`] }], () => undefined));
    await settle();

    expect(host.invoked).toHaveLength(STREAMS);
    for (const sub of subs) sub.close();
  });

  it('publishes a review while the applet holds a realistic number of open streams', async () => {
    const host = installHost();
    const subs = Array.from({ length: STREAMS }, (_, index) =>
      runtimeOutbox.subscribe([{ kinds: [KIND_DRAFT_REVIEW], '#d': [`review:${index}`] }], () => undefined));
    await settle();

    await expect(runtimeRelay.publish(review)).resolves.toMatchObject({ id: review.id });
    expect(host.invoked.filter((request) => (request.payload as { operationId: string }).operationId === 'relay.runtime.publish')).toHaveLength(1);
    for (const sub of subs) sub.close();
  });

  it('reports a stream the shell refuses instead of dropping it', async () => {
    installHost();
    // Shell side refusal: the invoke is accepted, then the invocation fails at capacity.
    const original = window.parent.postMessage as unknown as ReturnType<typeof vi.fn>;
    const forward = original.getMockImplementation() as (message: unknown) => void;
    original.mockImplementation((message: unknown) => {
      const request = message as RuntimeControlRequest;
      if (request.method !== 'invoke') return forward(message);
      queueMicrotask(() => {
        dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'response', requestId: request.requestId, method: 'invoke', ok: true, payload: { invocationId: 'refused-stream', cancellable: false } });
        dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'event', event: 'invocation-result', invocationId: 'refused-stream', snapshot: { id: 'refused-stream', operationId: 'outbox.subscribe', operationRevision: 1, status: 'failed', cancellable: false, startedAt: 1, completedAt: 1, progress: [], error: { code: 'forbidden', message: 'Too many open control streams' } } });
      });
    });
    const onError = vi.fn();
    const onClosed = vi.fn();
    const sub = runtimeOutbox.subscribe([{ kinds: [KIND_DRAFT_REVIEW] }], () => undefined, { onError }, onClosed);
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ operationId: 'outbox.subscribe', code: 'forbidden', status: 'failed' });
    expect(onClosed).not.toHaveBeenCalled();
    sub.close();
  });

  it('warns about a refused stream when the caller gave no error handler', async () => {
    installHost();
    const original = window.parent.postMessage as unknown as ReturnType<typeof vi.fn>;
    const forward = original.getMockImplementation() as (message: unknown) => void;
    original.mockImplementation((message: unknown) => {
      const request = message as RuntimeControlRequest;
      if (request.method !== 'describe') return forward(message);
      queueMicrotask(() => dispatch({ protocol: RUNTIME_CONTROL_PROTOCOL, version: RUNTIME_CONTROL_VERSION, kind: 'response', requestId: request.requestId, method: 'describe', ok: true, payload: null }));
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sub = runtimeRelay.subscribe([{ kinds: [KIND_DRAFT_REVIEW] }], () => undefined);
    await settle();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('relay.runtime.subscribe stream refused'));
    sub.close();
  });
});
