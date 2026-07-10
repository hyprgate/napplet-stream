import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from 'nostr-tools/core';
import type { LiveStream } from '../lib/stream-store';
import StreamCard from './StreamCard.svelte';

vi.mock('@hyprgate/utils', () => ({
  pubkeyColorStyle: () => '',
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
}));

const mounted: Array<ReturnType<typeof mount>> = [];

function makeStream(overrides: Partial<LiveStream> = {}): LiveStream {
  const event: NostrEvent = {
    kind: 30311,
    id: 'stream-event',
    pubkey: 'host-pubkey',
    created_at: 1_700_000_000,
    content: '',
    tags: [],
    sig: 'sig',
  };

  return {
    id: 'stream-event',
    streamAddr: '30311:host-pubkey:stream',
    chatRelays: [],
    title: 'Test Stream',
    streamUrl: 'https://stream.example.test/live.m3u8',
    status: 'live',
    hostPubkey: 'host-pubkey',
    viewerCount: 0,
    image: 'https://stream.example.test/thumb.jpg',
    summary: '',
    service: 'zap.stream',
    tags: [],
    createdAt: 1_700_000_000,
    event,
    ...overrides,
  };
}

function mountCard(stream: LiveStream) {
  const component = mount(StreamCard, {
    target: document.body,
    props: {
      stream,
      onselect: vi.fn(),
    },
  });
  mounted.push(component);
  return component;
}

function placeholder(): HTMLElement | null {
  return document.querySelector('[data-stream-thumbnail-placeholder]');
}

afterEach(() => {
  for (const component of mounted.splice(0)) unmount(component);
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('StreamCard thumbnail states', () => {
  it('shows a static placeholder while a thumbnail is loading', async () => {
    mountCard(makeStream());
    await tick();

    const image = document.querySelector<HTMLImageElement>('[data-stream-thumbnail]');
    expect(image?.getAttribute('src')).toBe('https://stream.example.test/thumb.jpg');
    expect(placeholder()?.getAttribute('data-thumbnail-state')).toBe('loading');
    expect(placeholder()?.className).not.toContain('animate');
  });

  it('removes the placeholder after the thumbnail loads', async () => {
    mountCard(makeStream());
    await tick();

    const image = document.querySelector<HTMLImageElement>('[data-stream-thumbnail]');
    image?.dispatchEvent(new Event('load'));
    await tick();

    expect(placeholder()).toBeNull();
    expect(image?.classList.contains('loaded')).toBe(true);
  });

  it('uses the fallback placeholder when no thumbnail is available', async () => {
    mountCard(makeStream({ image: '' }));
    await tick();

    expect(document.querySelector('[data-stream-thumbnail]')).toBeNull();
    expect(placeholder()?.getAttribute('data-thumbnail-state')).toBe('fallback');
    expect(placeholder()?.className).not.toContain('animate');
  });

  it('uses the fallback placeholder when a thumbnail errors', async () => {
    mountCard(makeStream());
    await tick();

    document.querySelector<HTMLImageElement>('[data-stream-thumbnail]')?.dispatchEvent(new Event('error'));
    await tick();

    expect(document.querySelector('[data-stream-thumbnail]')).toBeNull();
    expect(placeholder()?.getAttribute('data-thumbnail-state')).toBe('fallback');
  });

  it('uses the fallback placeholder after a slow thumbnail timeout', async () => {
    vi.useFakeTimers();
    mountCard(makeStream());
    await tick();

    expect(placeholder()?.getAttribute('data-thumbnail-state')).toBe('loading');

    await vi.advanceTimersByTimeAsync(30_000);
    await tick();

    expect(document.querySelector('[data-stream-thumbnail]')).toBeNull();
    expect(placeholder()?.getAttribute('data-thumbnail-state')).toBe('fallback');
  });
});
