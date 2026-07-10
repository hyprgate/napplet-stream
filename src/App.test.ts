import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from 'nostr-tools/core';
import { relay } from '@napplet/sdk';
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
});
