import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from 'nostr-tools/core';
import { inc, relay } from '@napplet/sdk';
import {
  controlRuntimePlayback,
  invokeNappletIntent,
  requestRuntimePlayback,
  subscribeRuntimePlayback,
} from '@hyprgate/utils';
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
  createProfileIntentRequest: vi.fn((payload) => ({ archetype: 'profile', payload })),
  createStreamChannelSwitchPayload: vi.fn((payload) => payload),
  createStreamCurrentContextPayload: vi.fn((context, payload) => ({ context, payload })),
  hasNsfwTag: vi.fn(() => false),
  invokeNappletIntent: vi.fn().mockResolvedValue({ ok: true }),
  pubkeyReadableColor: vi.fn(() => '#445566'),
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

const NOW = Math.floor(Date.now() / 1000);

function makeStreamEvent(dTag: string, title: string, extraTags: string[][] = [], status = 'live'): NostrEvent {
  return {
    kind: 30311,
    id: `${dTag}-event`,
    pubkey: 'shared-publisher',
    created_at: NOW - 60 + dTag.length,
    content: '',
    sig: 'sig',
    tags: [
      ['d', dTag],
      ['title', title],
      ['status', status],
      ['streaming', `https://stream.example.test/${dTag}.m3u8`],
      ['p', 'shared-host', '', 'host'],
      ...extraTags,
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

    expect(document.body.textContent).toContain("Nobody's live right now");
    expect(document.body.textContent).not.toContain('Looking for streams');

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
    const button = document.querySelector<HTMLElement>('[aria-label="Watch Takeover Stream"]')!;
    const card = button.closest('.stream-card')!;
    button.click();
    await vi.waitFor(() => expect(subscribeRuntimePlayback).toHaveBeenCalled());
    await tick();
    expect(document.body.textContent).toContain('Watching: Takeover Stream');
    const onState = vi.mocked(subscribeRuntimePlayback).mock.calls[0]![1];
    const subscription = vi.mocked(subscribeRuntimePlayback).mock.results[0]!.value;
    onState(status === null ? null : {
      sessionId: 'stream-session', windowId: '', state: status,
      position: 0, duration: null, volume: 1, muted: false,
    });
    await tick();
    expect(card.classList.contains('active')).toBe(false);
    expect(document.body.textContent).not.toContain('Watching: Takeover Stream');
    expect(subscription.close).toHaveBeenCalled();

    const [, onContext] = vi.mocked(inc.on).mock.calls.find(([topic]) => topic === 'stream:current-context-get')!;
    onContext!({ topic: 'stream:current-context-get', sender: 'chat', payload: {} });
    expect(inc.emit).toHaveBeenLastCalledWith('stream:current-context', JSON.stringify({
      context: { streamAddr: null, title: null, chatRelays: [] }, payload: {},
    }));
    button.click();
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
    const button = document.querySelector<HTMLElement>('[aria-label="Watch Paused Stream"]')!;
    const card = button.closest('.stream-card')!;
    button.click();
    await vi.waitFor(() => expect(subscribeRuntimePlayback).toHaveBeenCalled());
    vi.mocked(subscribeRuntimePlayback).mock.calls[0]![1]({
      sessionId: 'stream-session', windowId: '', state: 'paused',
      position: 10, duration: null, volume: 0.5, muted: false,
    });
    await tick();
    expect(card.classList.contains('active')).toBe(true);
    expect(document.body.textContent).toContain('Watching: Paused Stream');
    expect(document.body.textContent).not.toContain('playing: Paused Stream');
    button.click();
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
    const button = document.querySelector<HTMLElement>('[aria-label="Watch Queued Stream"]')!;
    const card = button.closest('.stream-card')!;
    button.click();
    await vi.waitFor(() => expect(subscribeRuntimePlayback).toHaveBeenCalled());
    const subscription = vi.mocked(subscribeRuntimePlayback).mock.results[0]!.value;
    subscription.close.mockClear();
    vi.mocked(subscribeRuntimePlayback).mock.calls[0]![1]({
      sessionId: 'queued-stream', windowId: '', state: 'loading',
      position: 0, duration: null, volume: 1, muted: false,
    });
    await tick();
    expect(card.classList.contains('active')).toBe(true);
    expect(document.body.textContent).toContain('Watching: Queued Stream');
    expect(subscription.close).not.toHaveBeenCalled();
    await unmount(component);
  });

  it('groups streams by phase and only counts what is actually live', async () => {
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    eventCallback({ event: makeStreamEvent('on-now', 'On Now') });
    eventCallback({ event: makeStreamEvent('later', 'Later', [['starts', String(NOW + 7_200)]], 'planned') });
    eventCallback({ event: makeStreamEvent('over', 'Over', [['recording', 'https://stream.example.test/over.mp4']], 'ended') });
    eventCallback({ event: { ...makeStreamEvent('ghost', 'Ghost'), created_at: NOW - 10_800 } });
    (vi.mocked(relay.subscribe).mock.calls[0]![2] as () => void)();
    await tick();

    const sectionText = (label: string) => document.querySelector(`section[aria-label="${label}"]`)?.textContent ?? '';
    expect(document.body.textContent).toContain('1 live');
    expect(sectionText('Live now')).toContain('On Now');
    expect(sectionText('Upcoming')).toContain('Later');
    expect(sectionText('Upcoming')).toContain('Starts in 2h');
    expect(sectionText('Ended')).toContain('Over');
    expect(sectionText('Ended')).toContain('REPLAY');
    expect(sectionText('Ended')).toContain('Ghost');
    expect(sectionText('Ended')).toContain('No update for 3h');

    await unmount(component);
  });

  it('removes a stream from live when a newer version says it ended', async () => {
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    const live = makeStreamEvent('show', 'Show');
    eventCallback({ event: live });
    eventCallback({ event: { ...makeStreamEvent('show', 'Show', [], 'ended'), id: 'show-ended', created_at: live.created_at + 10 } });
    (vi.mocked(relay.subscribe).mock.calls[0]![2] as () => void)();
    await tick();

    expect(document.body.textContent).toContain('0 live');
    expect(document.querySelector('section[aria-label="Live now"]')).toBeNull();
    expect(document.querySelector('section[aria-label="Ended"]')?.textContent).toContain('Show');

    await unmount(component);
  });

  it('does not offer to play an upcoming stream, and leaves replays out of the live queue', async () => {
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    eventCallback({ event: makeStreamEvent('on-now', 'On Now') });
    eventCallback({ event: makeStreamEvent('later', 'Later', [], 'planned') });
    eventCallback({ event: makeStreamEvent('over', 'Over', [['recording', 'https://stream.example.test/over.mp4']], 'ended') });
    await tick();

    const later = [...document.querySelectorAll<HTMLButtonElement>('.card-main')].find((b) => b.textContent?.includes('Later'))!;
    expect(later.disabled).toBe(true);
    later.click();
    expect(requestRuntimePlayback).not.toHaveBeenCalled();

    document.querySelector<HTMLElement>('[aria-label="Watch Over"]')!.click();
    await vi.waitFor(() => expect(requestRuntimePlayback).toHaveBeenCalled());
    const request = vi.mocked(requestRuntimePlayback).mock.calls[0]![0];
    expect(request).toEqual(expect.objectContaining({ url: 'https://stream.example.test/over.mp4', kind: 'video', live: false }));
    expect(request.queue?.map((item) => item.title)).toEqual(['On Now']);

    await unmount(component);
  });

  it('marks the card when the player reports an error, then allows a retry', async () => {
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    eventCallback({ event: makeStreamEvent('broken', 'Broken') });
    await tick();
    const button = document.querySelector<HTMLElement>('[aria-label="Watch Broken"]')!;
    button.click();
    await vi.waitFor(() => expect(subscribeRuntimePlayback).toHaveBeenCalled());
    vi.mocked(subscribeRuntimePlayback).mock.calls[0]![1]({
      sessionId: 'stream-session', windowId: '', state: 'error',
      position: 0, duration: null, volume: 1, muted: false,
    });
    await tick();

    expect(button.closest('.stream-card')?.classList.contains('error')).toBe(true);
    expect(document.querySelector('.state-pill')?.textContent).toBe("Can't play this one");

    button.click();
    await vi.waitFor(() => expect(requestRuntimePlayback).toHaveBeenCalledTimes(2));
    await unmount(component);
  });

  it('treats dropping back to idle before ever playing as a failure', async () => {
    vi.mocked(requestRuntimePlayback).mockResolvedValueOnce({ sessionId: 'stream-session' });
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    eventCallback({ event: makeStreamEvent('stub', 'Stub') });
    await tick();
    const button = document.querySelector<HTMLElement>('[aria-label="Watch Stub"]')!;
    button.click();
    await vi.waitFor(() => expect(subscribeRuntimePlayback).toHaveBeenCalled());
    vi.mocked(subscribeRuntimePlayback).mock.calls[0]![1]({
      sessionId: 'stream-session', windowId: '', state: 'idle',
      position: 0, duration: null, volume: 1, muted: false,
    });
    await tick();

    expect(document.querySelector('.state-pill')?.textContent).toBe("Can't play this one");
    await unmount(component);
  });

  it('asks for the host profile when the name is clicked, without starting playback', async () => {
    const component = mount(App, { target: document.body });
    await tick();
    const eventCallback = vi.mocked(relay.subscribe).mock.calls[0]![1] as (result: RelayEventResult) => void;
    eventCallback({ event: makeStreamEvent('show', 'Show') });
    await tick();

    document.querySelector<HTMLElement>('.host')!.click();

    expect(invokeNappletIntent).toHaveBeenCalledWith({ archetype: 'profile', payload: { pubkey: 'shared-host' } });
    expect(requestRuntimePlayback).not.toHaveBeenCalled();
    await unmount(component);
  });
});
