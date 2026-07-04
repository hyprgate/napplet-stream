import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  controlRuntimePlayback,
  releaseRuntimePlayback,
  requestRuntimePlayback,
  subscribeRuntimePlayback,
} from './runtime-player.js';

type TestNappletWindow = typeof window & {
  napplet?: {
    shell?: {
      supports?: (capability: string, protocol?: string) => boolean;
    };
    media?: {
      createSession: ReturnType<typeof vi.fn>;
      destroySession: ReturnType<typeof vi.fn>;
      sendCommand: ReturnType<typeof vi.fn>;
      onState: ReturnType<typeof vi.fn>;
    };
  };
};

function testWindow(): TestNappletWindow {
  return window as TestNappletWindow;
}

beforeEach(() => {
  delete testWindow().napplet;
  vi.clearAllMocks();
});

describe('runtime-player NAP-MEDIA path', () => {
  it('requests shell-owned playback through NAP-MEDIA when available', async () => {
    const media = {
      createSession: vi.fn(async () => ({ sessionId: 'media-1', owner: 'shell' })),
      destroySession: vi.fn(),
      sendCommand: vi.fn(),
      onState: vi.fn(() => ({ close: vi.fn() })),
    };
    testWindow().napplet = {
      shell: { supports: vi.fn(() => true) },
      media,
    };

    const result = await requestRuntimePlayback({
      url: 'https://media.example.test/movie.m3u8',
      kind: 'hls',
      title: 'Movie',
      artist: 'Director',
      album: 'Featured Films',
      artworkUrl: 'https://media.example.test/movie.jpg',
      duration: 7200,
      aspectRatio: 16 / 9,
      context: { label: 'NIP-71 Videos', detail: 'Featured Films', index: 0, total: 2 },
      queue: [
        {
          url: 'https://media.example.test/movie.m3u8',
          kind: 'hls',
          title: 'Movie',
          artist: 'Director',
          album: 'Featured Films',
          artworkUrl: 'https://media.example.test/movie.jpg',
          duration: 7200,
          aspectRatio: 16 / 9,
          live: false,
          loop: false,
          context: { label: 'NIP-71 Videos', detail: 'Featured Films', index: 0, total: 2 },
        },
        {
          url: 'https://media.example.test/sequel.m3u8',
          kind: 'hls',
          title: 'Sequel',
          artist: 'Director',
          album: 'Featured Films',
          artworkUrl: 'https://media.example.test/sequel.jpg',
          duration: 7000,
          aspectRatio: 16 / 9,
          live: false,
          loop: false,
          context: { label: 'NIP-71 Videos', detail: 'Featured Films', index: 1, total: 2 },
        },
      ],
      queueIndex: 0,
      capabilities: ['play', 'pause', 'prev', 'next', 'seek', 'setVolume', 'setMuted'],
      autoplay: true,
      live: false,
      loop: true,
    });

    expect(result).toEqual({ sessionId: 'media-1' });
    expect(media.createSession).toHaveBeenCalledWith({
      owner: 'shell',
      source: {
        url: 'https://media.example.test/movie.m3u8',
        mimeType: 'application/vnd.apple.mpegurl',
      },
      metadata: {
        title: 'Movie',
        artist: 'Director',
        album: 'Featured Films',
        artwork: { url: 'https://media.example.test/movie.jpg' },
        duration: 7200,
        mediaType: 'video',
      },
      context: { label: 'NIP-71 Videos', detail: 'Featured Films', index: 0, total: 2 },
      aspectRatio: 16 / 9,
      queue: [
        {
          url: 'https://media.example.test/movie.m3u8',
          kind: 'hls',
          title: 'Movie',
          artist: 'Director',
          album: 'Featured Films',
          artworkUrl: 'https://media.example.test/movie.jpg',
          duration: 7200,
          aspectRatio: 16 / 9,
          live: false,
          loop: false,
          context: { label: 'NIP-71 Videos', detail: 'Featured Films', index: 0, total: 2 },
        },
        {
          url: 'https://media.example.test/sequel.m3u8',
          kind: 'hls',
          title: 'Sequel',
          artist: 'Director',
          album: 'Featured Films',
          artworkUrl: 'https://media.example.test/sequel.jpg',
          duration: 7000,
          aspectRatio: 16 / 9,
          live: false,
          loop: false,
          context: { label: 'NIP-71 Videos', detail: 'Featured Films', index: 1, total: 2 },
        },
      ],
      queueIndex: 0,
      capabilities: ['play', 'pause', 'prev', 'next', 'seek', 'volume'],
      autoplay: true,
      live: false,
      loop: true,
    });

    await controlRuntimePlayback('media-1', 'next');
    await controlRuntimePlayback('media-1', 'prev');
    expect(media.sendCommand).toHaveBeenCalledWith('media-1', 'next', undefined);
    expect(media.sendCommand).toHaveBeenCalledWith('media-1', 'prev', undefined);
  });

  it('forwards live chat context through NAP-MEDIA requests', async () => {
    const media = {
      createSession: vi.fn(async () => ({ sessionId: 'media-chat', owner: 'shell' })),
      destroySession: vi.fn(),
      sendCommand: vi.fn(),
      onState: vi.fn(() => ({ close: vi.fn() })),
    };
    testWindow().napplet = {
      shell: { supports: vi.fn(() => true) },
      media,
    };

    await requestRuntimePlayback({
      url: 'https://media.example.test/live.m3u8',
      kind: 'hls',
      title: 'Live Stream',
      context: {
        label: 'Live streams',
        chat: {
          streamAddr: '30311:host:stream',
          title: 'Live Stream',
          chatRelays: ['wss://relay.example'],
        },
      },
      autoplay: true,
      live: true,
    });

    expect(media.createSession).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        label: 'Live streams',
        chat: {
          streamAddr: '30311:host:stream',
          title: 'Live Stream',
          chatRelays: ['wss://relay.example'],
        },
      },
    }));
  });

  it('forwards live chat context without relay hints through NAP-MEDIA requests', async () => {
    const media = {
      createSession: vi.fn(async () => ({ sessionId: 'media-chat-outbox', owner: 'shell' })),
      destroySession: vi.fn(),
      sendCommand: vi.fn(),
      onState: vi.fn(() => ({ close: vi.fn() })),
    };
    testWindow().napplet = {
      shell: { supports: vi.fn(() => true) },
      media,
    };

    await requestRuntimePlayback({
      url: 'https://media.example.test/live.mp3',
      kind: 'icecast',
      title: 'Live Radio',
      context: {
        label: 'Radio stations',
        chat: {
          streamAddr: '30311:host:radio',
          title: 'Live Radio',
        },
      },
      autoplay: true,
      live: true,
    });

    expect(media.createSession).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        label: 'Radio stations',
        chat: {
          streamAddr: '30311:host:radio',
          title: 'Live Radio',
        },
      },
    }));
  });

  it('maps NAP-MEDIA state subscriptions and destroys media sessions', async () => {
    let onState: (state: { status: 'buffering'; position: number; duration: number; volume: number }) => void = () => {};
    const close = vi.fn();
    const media = {
      createSession: vi.fn(async () => ({ sessionId: 'media-2', owner: 'shell' })),
      destroySession: vi.fn(),
      sendCommand: vi.fn(),
      onState: vi.fn((_sessionId: string, callback: typeof onState) => {
        onState = callback;
        return { close };
      }),
    };
    testWindow().napplet = {
      shell: { supports: vi.fn(() => true) },
      media,
    };

    await requestRuntimePlayback({
      url: 'https://media.example.test/live.mp3',
      kind: 'icecast',
      capabilities: ['play', 'pause', 'stop', 'setVolume'],
      autoplay: true,
      live: true,
    });

    const handler = vi.fn();
    const subscription = subscribeRuntimePlayback('media-2', handler);
    onState({ status: 'buffering', position: 7, duration: 120, volume: 0.75 });

    expect(handler).toHaveBeenCalledWith({
      sessionId: 'media-2',
      windowId: '',
      state: 'loading',
      position: 7,
      duration: 120,
      volume: 0.75,
      muted: false,
    });

    subscription.close();
    expect(close).toHaveBeenCalledOnce();

    await releaseRuntimePlayback('media-2');
    expect(media.destroySession).toHaveBeenCalledWith('media-2');
  });
});
