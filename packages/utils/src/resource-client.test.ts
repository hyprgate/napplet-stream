import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearResourceObjectUrlCache,
  loadResourceObjectUrl,
  loadResourceObjectUrls,
  preloadResourceObjectUrl,
  resourceImageBatch,
  resourceBackgroundImage,
  resourceImage,
  shouldUseResourceNub,
} from './resource-client.js';
import { resourceBytesAsObjectURL, resourceBytesMany } from '@napplet/nap/resource';

vi.mock('@napplet/nap/resource', () => ({
  resourceBytesAsObjectURL: vi.fn(),
  resourceBytesMany: vi.fn(),
}));

function stubObjectUrls(): { createObjectURL: ReturnType<typeof vi.fn>; revokeObjectURL: ReturnType<typeof vi.fn> } {
  let count = 0;
  const createObjectURL = vi.fn(() => {
    count += 1;
    return `blob:batched-${count}`;
  });
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  });
  return { createObjectURL, revokeObjectURL };
}

describe('resource-client', () => {
  beforeEach(() => {
    clearResourceObjectUrlCache();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearResourceObjectUrlCache();
  });

  it('routes remote absolute URLs through NUB-RESOURCE only', () => {
    expect(shouldUseResourceNub('https://example.com/avatar.png')).toBe(true);
    expect(shouldUseResourceNub('nostr:nevent1example')).toBe(true);
    expect(shouldUseResourceNub('data:image/png;base64,AAAA')).toBe(false);
    expect(shouldUseResourceNub('blob:https://shell.local/abc')).toBe(false);
    expect(shouldUseResourceNub('/local.png')).toBe(false);
  });

  it('resolves object URLs and keeps them cached after close', async () => {
    let resolveReady: (() => void) | undefined;
    const handle = {
      url: '',
      revoke: vi.fn(),
      ready: new Promise<void>((resolve) => {
        resolveReady = () => {
          handle.url = 'blob:avatar';
          resolve();
        };
      }),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);
    const changes: Array<string | null> = [];

    const subscription = loadResourceObjectUrl('https://example.com/avatar.png', (url) => changes.push(url));
    resolveReady?.();
    await handle.ready;

    expect(changes).toEqual([null, 'blob:avatar']);
    subscription.close();
    expect(handle.revoke).not.toHaveBeenCalled();

    const cachedChanges: Array<string | null> = [];
    const cachedSubscription = loadResourceObjectUrl('https://example.com/avatar.png', (url) => {
      cachedChanges.push(url);
    });
    expect(cachedChanges).toEqual(['blob:avatar']);
    expect(resourceBytesAsObjectURL).toHaveBeenCalledOnce();

    cachedSubscription.close();
    clearResourceObjectUrlCache();
    expect(handle.revoke).toHaveBeenCalledOnce();
  });

  it('preloads resource object URLs for later synchronous image use', async () => {
    let resolveReady: (() => void) | undefined;
    const handle = {
      url: '',
      revoke: vi.fn(),
      ready: new Promise<void>((resolve) => {
        resolveReady = () => {
          handle.url = 'blob:preloaded-thumb';
          resolve();
        };
      }),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);

    const preload = preloadResourceObjectUrl('https://example.com/thumb.jpg');
    resolveReady?.();
    await handle.ready;
    preload.close();

    const changes: Array<string | null> = [];
    loadResourceObjectUrl('https://example.com/thumb.jpg', (url) => changes.push(url));

    expect(changes).toEqual(['blob:preloaded-thumb']);
    expect(resourceBytesAsObjectURL).toHaveBeenCalledOnce();
  });

  it('evicts least-recently-used inactive resource object URLs', async () => {
    const handles = Array.from({ length: 193 }, (_, index) => ({
      url: `blob:thumb-${index}`,
      revoke: vi.fn(),
      ready: Promise.resolve(),
    }));
    for (const handle of handles) vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);

    for (let index = 0; index < handles.length; index++) {
      preloadResourceObjectUrl(`https://example.com/thumb-${index}.jpg`).close();
      await handles[index]!.ready;
    }

    expect(handles[0]!.revoke).toHaveBeenCalledOnce();
    expect(handles[192]!.revoke).not.toHaveBeenCalled();
  });

  it('can expose the original browser-loadable URL while waiting for the resource object URL', async () => {
    let resolveReady: (() => void) | undefined;
    const handle = {
      url: '',
      revoke: vi.fn(),
      ready: new Promise<void>((resolve) => {
        resolveReady = () => {
          handle.url = 'blob:avatar';
          resolve();
        };
      }),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);
    const changes: Array<string | null> = [];

    loadResourceObjectUrl('https://example.com/avatar.png', (url) => changes.push(url), {
      fallbackToOriginal: true,
    });
    resolveReady?.();
    await handle.ready;

    expect(changes).toEqual(['https://example.com/avatar.png', 'blob:avatar']);
  });

  it('batches resource object URL resolution and primes the single-resource cache', async () => {
    const objectUrls = stubObjectUrls();
    vi.mocked(resourceBytesMany).mockResolvedValueOnce([
      {
        url: 'https://example.com/a.png',
        ok: true,
        blob: new Blob(['a'], { type: 'image/png' }),
        mime: 'image/png',
      },
      {
        url: 'https://example.com/b.png',
        ok: true,
        blob: new Blob(['b'], { type: 'image/png' }),
        mime: 'image/png',
      },
    ]);
    const changes: Array<[string, string | null]> = [];

    const subscription = loadResourceObjectUrls([
      'https://example.com/a.png',
      'https://example.com/b.png',
      'https://example.com/a.png',
    ], (source, url) => changes.push([source, url]));
    await Promise.resolve();

    expect(resourceBytesMany).toHaveBeenCalledWith([
      'https://example.com/a.png',
      'https://example.com/b.png',
    ], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(resourceBytesAsObjectURL).not.toHaveBeenCalled();
    expect(changes).toEqual([
      ['https://example.com/a.png', 'blob:batched-1'],
      ['https://example.com/b.png', 'blob:batched-2'],
    ]);

    const cachedChanges: Array<string | null> = [];
    loadResourceObjectUrl('https://example.com/a.png', (url) => cachedChanges.push(url));

    expect(resourceBytesAsObjectURL).not.toHaveBeenCalled();
    expect(cachedChanges).toEqual(['blob:batched-1']);
    subscription.close();
    clearResourceObjectUrlCache();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:batched-1');
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:batched-2');
  });

  it('chunks batched resource object URL resolution by requested size', async () => {
    stubObjectUrls();
    const sources = Array.from({ length: 23 }, (_, index) => `https://example.com/${index}.png`);
    vi.mocked(resourceBytesMany).mockImplementation(async (chunk) => chunk.map((url) => ({
      url,
      ok: true,
      blob: new Blob([url], { type: 'image/png' }),
      mime: 'image/png',
    })));
    const changes: Array<[string, string | null]> = [];

    loadResourceObjectUrls(sources, (source, url) => changes.push([source, url]), { chunkSize: 10 });

    await vi.waitFor(() => expect(changes).toHaveLength(23));
    expect(resourceBytesMany).toHaveBeenCalledTimes(3);
    expect(resourceBytesMany).toHaveBeenNthCalledWith(
      1,
      sources.slice(0, 10),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(resourceBytesMany).toHaveBeenNthCalledWith(
      2,
      sources.slice(10, 20),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(resourceBytesMany).toHaveBeenNthCalledWith(
      3,
      sources.slice(20),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(changes.map(([source]) => source)).toEqual(sources);
  });

  it('keeps successful resource batch items when sibling URLs fail', async () => {
    stubObjectUrls();
    const onError = vi.fn();
    vi.mocked(resourceBytesMany).mockResolvedValueOnce([
      {
        url: 'https://example.com/ok.png',
        ok: true,
        blob: new Blob(['ok'], { type: 'image/png' }),
        mime: 'image/png',
      },
      {
        url: 'https://example.com/missing.png',
        ok: false,
        error: 'not-found',
        message: 'gone',
      },
    ]);
    const changes: Array<[string, string | null]> = [];

    loadResourceObjectUrls([
      'https://example.com/ok.png',
      'https://example.com/missing.png',
    ], (source, url) => changes.push([source, url]), { onError });
    await Promise.resolve();

    expect(changes).toEqual([
      ['https://example.com/ok.png', 'blob:batched-1'],
      ['https://example.com/missing.png', null],
    ]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'not-found: gone',
    }));
  });

  it('aborts an in-flight resource batch when the subscription closes', () => {
    let signal: AbortSignal | undefined;
    vi.mocked(resourceBytesMany).mockImplementationOnce((_sources, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });

    const subscription = loadResourceObjectUrls(['https://example.com/a.png'], () => {});
    subscription.close();

    expect(signal?.aborted).toBe(true);
  });

  it('leaves data/blob/relative URLs untouched', () => {
    const changes: Array<string | null> = [];

    loadResourceObjectUrl('data:image/png;base64,AAAA', (url) => changes.push(url));
    loadResourceObjectUrl('/local.png', (url) => changes.push(url));

    expect(vi.mocked(resourceBytesAsObjectURL)).not.toHaveBeenCalled();
    expect(changes).toEqual(['data:image/png;base64,AAAA', '/local.png']);
  });

  it('reports resource object URL failures to callers', async () => {
    const error = new Error('blocked');
    const handle = {
      url: '',
      revoke: vi.fn(),
      ready: Promise.reject(error),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);
    const onError = vi.fn();
    const changes: Array<string | null> = [];

    loadResourceObjectUrl('https://example.com/movie.mp4', (url) => changes.push(url), { onError });
    await handle.ready.catch(() => undefined);
    await Promise.resolve();

    expect(changes).toEqual([null, null]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('keeps resourceImage inside the resource sidecar path when object URL resolution fails', async () => {
    const error = new Error('missing sidecar');
    const handle = {
      url: '',
      revoke: vi.fn(),
      ready: Promise.reject(error),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);
    const img = document.createElement('img');

    resourceImage(img, 'https://example.com/thumb.jpg');
    await handle.ready.catch(() => undefined);
    await Promise.resolve();

    expect(img.hasAttribute('src')).toBe(false);
  });

  it('does not expose an initial remote resource handle URL to resourceImage', async () => {
    let resolveReady: (() => void) | undefined;
    const handle = {
      url: 'https://example.com/thumb.jpg',
      revoke: vi.fn(),
      ready: new Promise<void>((resolve) => {
        resolveReady = () => {
          handle.url = 'blob:thumb';
          resolve();
        };
      }),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);
    const img = document.createElement('img');

    resourceImage(img, 'https://example.com/thumb.jpg');
    expect(img.hasAttribute('src')).toBe(false);

    resolveReady?.();
    await handle.ready;

    expect(img.getAttribute('src')).toBe('blob:thumb');
  });

  it('retries resourceImage sidecar failures before leaving an image unresolved', async () => {
    vi.useFakeTimers();
    const failing = {
      url: '',
      revoke: vi.fn(),
      ready: Promise.reject(new Error('transient')),
    };
    const retry = {
      url: 'blob:retry-thumb',
      revoke: vi.fn(),
      ready: Promise.resolve(),
    };
    vi.mocked(resourceBytesAsObjectURL)
      .mockReturnValueOnce(failing)
      .mockReturnValueOnce(retry);
    const img = document.createElement('img');

    resourceImage(img, 'https://example.com/thumb.jpg');
    await failing.ready.catch(() => undefined);
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    await retry.ready;

    expect(resourceBytesAsObjectURL).toHaveBeenCalledTimes(2);
    expect(img.getAttribute('src')).toBe('blob:retry-thumb');
  });

  it('shares a pending resource handle instead of duplicating thumbnail fetches', () => {
    const stalled = {
      url: '',
      revoke: vi.fn(),
      ready: new Promise<void>(() => { /* pending */ }),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(stalled);
    const first = document.createElement('img');
    const second = document.createElement('img');

    resourceImage(first, 'https://example.com/thumb.jpg');
    resourceImage(second, 'https://example.com/thumb.jpg');

    expect(resourceBytesAsObjectURL).toHaveBeenCalledOnce();
    expect(first.hasAttribute('src')).toBe(false);
    expect(second.hasAttribute('src')).toBe(false);
  });

  it('resourceImage action writes only the resolved object URL to img.src', async () => {
    const handle = {
      url: 'blob:ready-avatar',
      revoke: vi.fn(),
      ready: Promise.resolve(),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);
    const img = document.createElement('img');

    const action = resourceImage(img, 'https://example.com/avatar.png');
    await handle.ready;

    expect(img.getAttribute('src')).toBe('blob:ready-avatar');
    action.destroy?.();
    expect(handle.revoke).not.toHaveBeenCalled();
    clearResourceObjectUrlCache();
    expect(handle.revoke).toHaveBeenCalledOnce();
    expect(img.hasAttribute('src')).toBe(false);
  });

  it('resourceImageBatch action coalesces mounted images into one bytesMany request', async () => {
    stubObjectUrls();
    vi.mocked(resourceBytesMany).mockResolvedValueOnce([
      {
        url: 'https://example.com/a.png',
        ok: true,
        blob: new Blob(['a'], { type: 'image/png' }),
        mime: 'image/png',
      },
      {
        url: 'https://example.com/b.png',
        ok: true,
        blob: new Blob(['b'], { type: 'image/png' }),
        mime: 'image/png',
      },
    ]);
    const first = document.createElement('img');
    const second = document.createElement('img');

    const firstAction = resourceImageBatch(first, { source: 'https://example.com/a.png', chunkSize: 10 });
    const secondAction = resourceImageBatch(second, { source: 'https://example.com/b.png', chunkSize: 10 });

    await vi.waitFor(() => expect(first.getAttribute('src')).toBe('blob:batched-1'));
    expect(second.getAttribute('src')).toBe('blob:batched-2');
    expect(resourceBytesMany).toHaveBeenCalledOnce();
    expect(resourceBytesMany).toHaveBeenCalledWith([
      'https://example.com/a.png',
      'https://example.com/b.png',
    ], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(resourceBytesAsObjectURL).not.toHaveBeenCalled();

    firstAction.destroy?.();
    secondAction.destroy?.();
  });

  it('resourceBackgroundImage action writes only the resolved object URL to CSS', async () => {
    const handle = {
      url: 'blob:ready-banner',
      revoke: vi.fn(),
      ready: Promise.resolve(),
    };
    vi.mocked(resourceBytesAsObjectURL).mockReturnValueOnce(handle);
    const div = document.createElement('div');

    const action = resourceBackgroundImage(div, 'https://example.com/banner.png');
    await handle.ready;

    expect(div.style.backgroundImage).toBe('url("blob:ready-banner")');
    action.destroy?.();
    expect(handle.revoke).not.toHaveBeenCalled();
    clearResourceObjectUrlCache();
    expect(handle.revoke).toHaveBeenCalledOnce();
    expect(div.style.backgroundImage).toBe('');
  });
});
