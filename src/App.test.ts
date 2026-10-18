import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from 'nostr-tools/core';
import { inc, relay } from '@napplet/sdk';
import { controlRuntimePlayback, requestRuntimePlayback, subscribeRuntimePlayback } from '@hyprgate/utils';
import App from './App.svelte';

type RelayEventResult = { event: NostrEvent };

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
  },
  inc: {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue({ close: vi.fn() }),
  },
}));

vi.mock('@hyprgate/utils', () => ({
  controlRuntimePlayback: vi.fn(),
  createStreamChannelSwitchPayload: vi.fn((payload) => payload),
  createStreamCurrentContextPayload: vi.fn((context, payload) => ({ context, payload })),
  hasNsfwTag: vi.fn(() => false),
  pubkeyColorStyle: vi.fn(() => ''),
  releaseRuntimePlayback: vi.fn().mockResolvedValue(undefined),
  requestRuntimePlayback: vi.fn().mockResolvedValue({ sessionId: 'stream-session', state: { state: 'playing' } }),
  resourceImage(node: HTMLImageElement, url: string) {
    if (url) node.setAttribute('src', url);
    return {
      update(nextUrl: string) {
        if (nextUrl) node.setAttribute('src', nextUrl);
        else node.removeAttribute('src');
      },
      destroy() {},
    };
  },
  subscribeRuntimePlayback: vi.fn().mockReturnValue({ close: vi.fn() }),
}));

function makeStreamEvent(dTag: string, title: string): NostrEvent {
  return {
    kind: 30311,
    id: `${dTag}-event`,
    pubkey: 'shared-publisher',
    created_at: 1_700_000_000 + dTag.length,
    content: '',
    sig: 'sig',
    tags: [
      ['d', dTag],
      ['title', title],
      ['status', 'live'],
      ['streaming', `https://stream.example.test/${dTag}.m3u8`],
      ['p', 'shared-host', '', 'host'],
    ],
  };
}

describe('stream app live discovery', () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('counts multiple live stream addresses from the same publisher', async () => {
    const component = mount(App, { target: document.body });
    await Promise.resolve();

    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    const eoseCallback = vi.mocked(relay.subscribe).mock.calls[0]![2] as () => void;

    eventCallback({ event: makeStreamEvent('first-stream', 'First Stream') });
    eventCallback({ event: makeStreamEvent('second-stream', 'Second Stream') });
    eoseCallback();
    await tick();

    expect(document.body.textContent).toContain('2 live');
    expect(document.body.textContent).toContain('First Stream');
    expect(document.body.textContent).toContain('Second Stream');

    unmount(component);
  });

  it('degrades to the empty state when relay subscription is unavailable', async () => {
    vi.mocked(relay.subscribe).mockImplementationOnce(() => {
      throw new Error('relay unavailable');
    });

    const component = mount(App, { target: document.body });
    await tick();

    expect(document.body.textContent).toContain('no live streams found');
    expect(document.body.textContent).not.toContain('scanning...');

    unmount(component);
  });

  it('answers a canonical stream-context event with only the optional payload', async () => {
    const component = mount(App, { target: document.body });
    await Promise.resolve();

    const [, callback] = vi.mocked(inc.on).mock.calls.find(
      ([topic]) => topic === 'stream:current-context-get',
    )!;
    const payload = { requestId: 'cold-context-request' };
    callback!({
      topic: 'stream:current-context-get',
      sender: 'runtime-attested-chat',
      payload,
    });

    expect(inc.emit).toHaveBeenCalledWith(
      'stream:current-context',
      JSON.stringify({
        context: { streamAddr: null, title: null, chatRelays: [] },
        payload,
      }),
    );

    unmount(component);
  });

  it.each(['idle', null] as const)('clears a stopped/released stream and creates a fresh session on the next click (%s)', async (status) => {
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    eventCallback({ event: makeStreamEvent('takeover', 'Takeover Stream') });
    await tick();
    const card = document.querySelector<HTMLElement>('[aria-label="Watch Takeover Stream"]')!;
    card.click();
    await vi.waitFor(() => expect(subscribeRuntimePlayback).toHaveBeenCalled());
    await tick();
    expect(document.body.textContent).toContain('selected: Takeover Stream');
    const onState = vi.mocked(subscribeRuntimePlayback).mock.calls[0]![1];
    const subscription = vi.mocked(subscribeRuntimePlayback).mock.results[0]!.value;
    onState(status === null ? null : {
      sessionId: 'stream-session', windowId: '', state: status,
      position: 0, duration: null, volume: 1, muted: false,
    });
    await tick();
    expect(card.classList.contains('active')).toBe(false);
    expect(document.body.textContent).not.toContain('selected: Takeover Stream');
    expect(subscription.close).toHaveBeenCalled();

    const [, onContext] = vi.mocked(inc.on).mock.calls.find(([topic]) => topic === 'stream:current-context-get')!;
    onContext!({ topic: 'stream:current-context-get', sender: 'chat', payload: {} });
    expect(inc.emit).toHaveBeenLastCalledWith('stream:current-context', JSON.stringify({
      context: { streamAddr: null, title: null, chatRelays: [] }, payload: {},
    }));
    card.click();
    await vi.waitFor(() => expect(requestRuntimePlayback).toHaveBeenCalledTimes(2));
    expect(controlRuntimePlayback).not.toHaveBeenCalled();
    await unmount(component);
  });

  it('keeps a paused stream selected so the next click resumes its retained session', async () => {
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    eventCallback({ event: makeStreamEvent('paused', 'Paused Stream') });
    await tick();
    const card = document.querySelector<HTMLElement>('[aria-label="Watch Paused Stream"]')!;
    card.click();
    await vi.waitFor(() => expect(subscribeRuntimePlayback).toHaveBeenCalled());
    vi.mocked(subscribeRuntimePlayback).mock.calls[0]![1]({
      sessionId: 'stream-session', windowId: '', state: 'paused',
      position: 10, duration: null, volume: 0.5, muted: false,
    });
    await tick();
    expect(card.classList.contains('active')).toBe(true);
    expect(document.body.textContent).toContain('selected: Paused Stream');
    expect(document.body.textContent).not.toContain('playing: Paused Stream');
    card.click();
    await vi.waitFor(() => expect(controlRuntimePlayback).toHaveBeenCalledWith('stream-session', 'play'));
    expect(requestRuntimePlayback).toHaveBeenCalledTimes(1);
    await unmount(component);
  });

  it('keeps the selected stream while autoplay is queued before its video element attaches', async () => {
    vi.mocked(requestRuntimePlayback).mockResolvedValueOnce({ sessionId: 'queued-stream' });
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    eventCallback({ event: makeStreamEvent('queued', 'Queued Stream') });
    await tick();
    const card = document.querySelector<HTMLElement>('[aria-label="Watch Queued Stream"]')!;
    card.click();
    await vi.waitFor(() => expect(subscribeRuntimePlayback).toHaveBeenCalled());
    const subscription = vi.mocked(subscribeRuntimePlayback).mock.results[0]!.value;
    subscription.close.mockClear();
    vi.mocked(subscribeRuntimePlayback).mock.calls[0]![1]({
      sessionId: 'queued-stream', windowId: '', state: 'loading',
      position: 0, duration: null, volume: 1, muted: false,
    });
    await tick();
    expect(card.classList.contains('active')).toBe(true);
    expect(document.body.textContent).toContain('selected: Queued Stream');
    expect(subscription.close).not.toHaveBeenCalled();
    await unmount(component);
  });
});
