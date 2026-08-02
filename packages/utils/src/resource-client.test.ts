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
import { resourceBytes, resourceBytesMany } from '@napplet/nap/resource';

vi.mock('@napplet/nap/resource', () => ({
  resourceBytes: vi.fn(),
  resourceBytesMany: vi.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function stubObjectUrls(
  resolvedUrls: string[] = [],
): { createObjectURL: ReturnType<typeof vi.fn>; revokeObjectURL: ReturnType<typeof vi.fn> } {
  let count = 0;
  const createObjectURL = vi.fn(() => {
    count += 1;
    return resolvedUrls[count - 1] ?? `blob:batched-${count}`;
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
    const objectUrls = stubObjectUrls(['blob:avatar']);
    const bytes = deferred<Blob>();
    vi.mocked(resourceBytes).mockReturnValueOnce(bytes.promise);
    const changes: Array<string | null> = [];

    const subscription = loadResourceObjectUrl('https://example.com/avatar.png', (url) => changes.push(url));
    bytes.resolve(new Blob(['avatar'], { type: 'image/png' }));
    await vi.waitFor(() => expect(changes).toEqual([null, 'blob:avatar']));

    subscription.close();
    expect(objectUrls.revokeObjectURL).not.toHaveBeenCalled();

    const cachedChanges: Array<string | null> = [];
    const cachedSubscription = loadResourceObjectUrl('https://example.com/avatar.png', (url) => {
      cachedChanges.push(url);
    });
    expect(cachedChanges).toEqual(['blob:avatar']);
    expect(resourceBytes).toHaveBeenCalledOnce();

    cachedSubscription.close();
    clearResourceObjectUrlCache();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:avatar');
  });

  it('preloads resource object URLs for later synchronous image use', async () => {
    stubObjectUrls(['blob:preloaded-thumb']);
    const bytes = deferred<Blob>();
    vi.mocked(resourceBytes).mockReturnValueOnce(bytes.promise);

    const preload = preloadResourceObjectUrl('https://example.com/thumb.jpg');
    bytes.resolve(new Blob(['thumb'], { type: 'image/jpeg' }));
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
    preload.close();

    const changes: Array<string | null> = [];
    loadResourceObjectUrl('https://example.com/thumb.jpg', (url) => changes.push(url));

    expect(changes).toEqual(['blob:preloaded-thumb']);
    expect(resourceBytes).toHaveBeenCalledOnce();
  });

  it('evicts least-recently-used inactive resource object URLs', async () => {
    const objectUrls = stubObjectUrls();
    vi.mocked(resourceBytes).mockResolvedValue(new Blob(['thumb'], { type: 'image/jpeg' }));

    for (let index = 0; index < 193; index++) {
      preloadResourceObjectUrl(`https://example.com/thumb-${index}.jpg`).close();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:batched-1');
    expect(objectUrls.revokeObjectURL).not.toHaveBeenCalledWith('blob:batched-193');
  });

  it('can expose the original browser-loadable URL while waiting for the resource object URL', async () => {
    stubObjectUrls(['blob:avatar']);
    const bytes = deferred<Blob>();
    vi.mocked(resourceBytes).mockReturnValueOnce(bytes.promise);
    const changes: Array<string | null> = [];

    loadResourceObjectUrl('https://example.com/avatar.png', (url) => changes.push(url), {
      fallbackToOriginal: true,
    });
    bytes.resolve(new Blob(['avatar'], { type: 'image/png' }));
    await vi.waitFor(() => expect(changes).toHaveLength(2));

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
    expect(resourceBytes).not.toHaveBeenCalled();
    expect(changes).toEqual([
      ['https://example.com/a.png', 'blob:batched-1'],
      ['https://example.com/b.png', 'blob:batched-2'],
    ]);

    const cachedChanges: Array<string | null> = [];
    loadResourceObjectUrl('https://example.com/a.png', (url) => cachedChanges.push(url));

    expect(resourceBytes).not.toHaveBeenCalled();
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

    expect(vi.mocked(resourceBytes)).not.toHaveBeenCalled();
    expect(changes).toEqual(['data:image/png;base64,AAAA', '/local.png']);
  });

  it('reports resource object URL failures to callers', async () => {
    const error = new Error('blocked');
    vi.mocked(resourceBytes).mockRejectedValueOnce(error);
    const onError = vi.fn();
    const changes: Array<string | null> = [];

    loadResourceObjectUrl('https://example.com/movie.mp4', (url) => changes.push(url), { onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));

    expect(changes).toEqual([null, null]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('keeps resourceImage inside the resource sidecar path when object URL resolution fails', async () => {
    const error = new Error('missing sidecar');
    vi.mocked(resourceBytes).mockRejectedValueOnce(error);
    const img = document.createElement('img');

    resourceImage(img, 'https://example.com/thumb.jpg');
    await vi.waitFor(() => expect(resourceBytes).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(img.hasAttribute('src')).toBe(false);
  });

  it('keeps remote images unset until resource bytes resolve', async () => {
    stubObjectUrls(['blob:thumb']);
    const bytes = deferred<Blob>();
    vi.mocked(resourceBytes).mockReturnValueOnce(bytes.promise);
    const img = document.createElement('img');

    resourceImage(img, 'https://example.com/thumb.jpg');
    expect(img.hasAttribute('src')).toBe(false);

    bytes.resolve(new Blob(['thumb'], { type: 'image/jpeg' }));
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:thumb'));

    expect(resourceBytes).toHaveBeenCalledWith('https://example.com/thumb.jpg');
  });

  it('retries resourceImage sidecar failures before leaving an image unresolved', async () => {
    vi.useFakeTimers();
    stubObjectUrls(['blob:retry-thumb']);
    vi.mocked(resourceBytes)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(new Blob(['thumb'], { type: 'image/jpeg' }));
    const img = document.createElement('img');

    resourceImage(img, 'https://example.com/thumb.jpg');
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(resourceBytes).toHaveBeenCalledTimes(2);
    expect(img.getAttribute('src')).toBe('blob:retry-thumb');
  });

  it('shares a pending resource handle instead of duplicating thumbnail fetches', () => {
    vi.mocked(resourceBytes).mockReturnValueOnce(new Promise<Blob>(() => { /* pending */ }));
    const first = document.createElement('img');
    const second = document.createElement('img');

    resourceImage(first, 'https://example.com/thumb.jpg');
    resourceImage(second, 'https://example.com/thumb.jpg');

    expect(resourceBytes).toHaveBeenCalledOnce();
    expect(first.hasAttribute('src')).toBe(false);
    expect(second.hasAttribute('src')).toBe(false);
  });

  it('resourceImage action writes only the resolved object URL to img.src', async () => {
    const objectUrls = stubObjectUrls(['blob:ready-avatar']);
    vi.mocked(resourceBytes).mockResolvedValueOnce(new Blob(['avatar'], { type: 'image/png' }));
    const img = document.createElement('img');

    const action = resourceImage(img, 'https://example.com/avatar.png');
    await vi.waitFor(() => expect(img.getAttribute('src')).toBe('blob:ready-avatar'));

    action.destroy?.();
    expect(objectUrls.revokeObjectURL).not.toHaveBeenCalled();
    clearResourceObjectUrlCache();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:ready-avatar');
    expect(img.hasAttribute('src')).toBe(false);
  });

  it('resourceImageBatch action coalesces mounted images into one bytesMany request', async () => {
    vi.useFakeTimers();
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

    await vi.advanceTimersByTimeAsync(499);
    expect(resourceBytesMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(first.getAttribute('src')).toBe('blob:batched-1');
    expect(second.getAttribute('src')).toBe('blob:batched-2');
    expect(resourceBytesMany).toHaveBeenCalledOnce();
    expect(resourceBytesMany).toHaveBeenCalledWith([
      'https://example.com/a.png',
      'https://example.com/b.png',
    ], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(resourceBytes).not.toHaveBeenCalled();

    firstAction.destroy?.();
    secondAction.destroy?.();
  });

  it('resourceImageBatch keeps staggered image mounts in one debounced bytesMany request', async () => {
    vi.useFakeTimers();
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
    await vi.advanceTimersByTimeAsync(250);
    expect(resourceBytesMany).not.toHaveBeenCalled();

    const secondAction = resourceImageBatch(second, { source: 'https://example.com/b.png', chunkSize: 10 });
    await vi.advanceTimersByTimeAsync(249);
    expect(resourceBytesMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(resourceBytesMany).toHaveBeenCalledOnce();
    expect(resourceBytesMany).toHaveBeenCalledWith([
      'https://example.com/a.png',
      'https://example.com/b.png',
    ], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(first.getAttribute('src')).toBe('blob:batched-1');
    expect(second.getAttribute('src')).toBe('blob:batched-2');

    firstAction.destroy?.();
    secondAction.destroy?.();
  });

  it('resourceBackgroundImage action writes only the resolved object URL to CSS', async () => {
    const objectUrls = stubObjectUrls(['blob:ready-banner']);
    vi.mocked(resourceBytes).mockResolvedValueOnce(new Blob(['banner'], { type: 'image/png' }));
    const div = document.createElement('div');

    const action = resourceBackgroundImage(div, 'https://example.com/banner.png');
    await vi.waitFor(() => expect(div.style.backgroundImage).toBe('url("blob:ready-banner")'));

    action.destroy?.();
    expect(objectUrls.revokeObjectURL).not.toHaveBeenCalled();
    clearResourceObjectUrlCache();
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:ready-banner');
    expect(div.style.backgroundImage).toBe('');
  });
});
