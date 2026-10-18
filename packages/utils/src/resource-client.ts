import { resourceBytes, resourceBytesMany } from '@napplet/nap/resource';
import type { ResourceBytesErrorItem, ResourceBytesItem } from '@napplet/nap/resource';

export interface ResourceObjectUrlSubscription {
  close(): void;
}

export interface ResourceObjectUrlOptions {
  chunkSize?: number;
  fallbackToOriginal?: boolean;
  onError?: (error: unknown) => void;
  refresh?: boolean;
}

export interface ResourceImageBatchOptions {
  source: string | null | undefined;
  chunkSize?: number;
}

export type ResourceObjectUrlsChange = (source: string, url: string | null) => void;

interface ResourceObjectUrlHandle {
  url: string;
  revoke(): void;
  ready: Promise<unknown>;
}

type ResourceActionReturn<Parameter> = {
  update?(parameter: Parameter): void;
  destroy?(): void;
};

type ResourceImageBatchParameter = string | null | undefined | ResourceImageBatchOptions;

const ABSOLUTE_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const NOOP_SUBSCRIPTION: ResourceObjectUrlSubscription = { close: () => { /* no-op */ } };
const RESOURCE_IMAGE_STALLED_RETRY_MS = 5_000;
const RESOURCE_IMAGE_RETRY_DELAYS_MS = [500, 1_500, 3_000, 5_000] as const;
const RESOURCE_IMAGE_BATCH_SIZE = 10;
const RESOURCE_IMAGE_BATCH_DEBOUNCE_MS = 500;
const RESOURCE_OBJECT_URL_CACHE_LIMIT = 192;

type ResourceImageState = 'empty' | 'loading' | 'ready' | 'error';

interface ResourceImagePresentation {
  clear(state: Exclude<ResourceImageState, 'ready'>): void;
  show(source: string): void;
  destroy(): void;
}

interface CachedResourceObjectUrlEntry {
  source: string;
  handle: ResourceObjectUrlHandle;
  resolvedUrl: string | null;
  refCount: number;
  lastUsed: number;
}

const resourceObjectUrlCache = new Map<string, CachedResourceObjectUrlEntry>();
let resourceObjectUrlClock = 0;

interface BatchedResourceImageJob {
  active: boolean;
  chunkSize: number;
  refresh: boolean;
  source: string;
  group: BatchedResourceImageGroup | null;
  onChange(url: string | null): void;
}

interface BatchedResourceImageGroup {
  jobs: Set<BatchedResourceImageJob>;
  subscription: ResourceObjectUrlSubscription;
}

const pendingBatchedResourceImageJobs: BatchedResourceImageJob[] = [];
let batchedResourceImageFlushTimer: ReturnType<typeof setTimeout> | null = null;

function createResourceImagePresentation(
  node: HTMLImageElement,
  onNativeError: () => void,
): ResourceImagePresentation {
  const initialState = node.getAttribute('data-resource-image-state');
  const initialVisibility = node.style.visibility;
  let assignedSource: string | null = null;

  function setState(state: ResourceImageState): void {
    node.dataset.resourceImageState = state;
    node.style.visibility = state === 'ready' ? initialVisibility : 'hidden';
  }

  function clear(state: Exclude<ResourceImageState, 'ready'>): void {
    assignedSource = null;
    node.removeAttribute('src');
    setState(state);
  }

  function handleLoad(): void {
    if (!assignedSource || node.getAttribute('src') !== assignedSource) return;
    setState('ready');
  }

  function handleError(): void {
    if (!assignedSource || node.getAttribute('src') !== assignedSource) return;
    clear('error');
    onNativeError();
  }

  function show(source: string): void {
    assignedSource = source;
    setState('loading');
    node.src = source;
    if (node.complete && node.naturalWidth > 0) handleLoad();
  }

  node.addEventListener('load', handleLoad);
  node.addEventListener('error', handleError);

  return {
    clear,
    show,
    destroy(): void {
      assignedSource = null;
      node.removeEventListener('load', handleLoad);
      node.removeEventListener('error', handleError);
      if (initialState === null) node.removeAttribute('data-resource-image-state');
      else node.setAttribute('data-resource-image-state', initialState);
      node.style.visibility = initialVisibility;
    },
  };
}

function normalizeSource(source: string | null | undefined): string | null {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeResourceChunkSize(chunkSize: number | undefined, fallback?: number): number | undefined {
  if (chunkSize === undefined) return fallback;
  if (!Number.isFinite(chunkSize)) return fallback;
  return Math.max(1, Math.floor(chunkSize));
}

function chunkItems<T>(items: readonly T[], chunkSize: number | undefined): T[][] {
  if (chunkSize === undefined || items.length <= chunkSize) return [Array.from(items)];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export function shouldUseResourceNub(source: string): boolean {
  const normalized = normalizeSource(source);
  if (!normalized || !ABSOLUTE_SCHEME_RE.test(normalized)) return false;

  try {
    const protocol = new URL(normalized).protocol.toLowerCase();
    return protocol !== 'data:' && protocol !== 'blob:';
  } catch {
    return false;
  }
}

function browserLoadableFallback(source: string, options: ResourceObjectUrlOptions): string | null {
  if (!options.fallbackToOriginal) return null;
  try {
    const protocol = new URL(source).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:' ? source : null;
  } catch {
    return null;
  }
}

function resourceHandleUrl(handle: ResourceObjectUrlHandle | null, fallbackUrl: string | null): string | null {
  const url = handle?.url;
  if (!url) return fallbackUrl;
  return shouldUseResourceNub(url) ? fallbackUrl : url;
}

function touchResourceObjectUrlEntry(entry: CachedResourceObjectUrlEntry): void {
  resourceObjectUrlClock += 1;
  entry.lastUsed = resourceObjectUrlClock;
}

function evictResourceObjectUrlCache(): void {
  if (resourceObjectUrlCache.size <= RESOURCE_OBJECT_URL_CACHE_LIMIT) return;

  const inactive = Array.from(resourceObjectUrlCache.values())
    .filter((entry) => entry.refCount <= 0)
    .sort((a, b) => a.lastUsed - b.lastUsed);

  for (const entry of inactive) {
    if (resourceObjectUrlCache.size <= RESOURCE_OBJECT_URL_CACHE_LIMIT) break;
    resourceObjectUrlCache.delete(entry.source);
    entry.handle.revoke();
  }
}

function deleteCachedResourceObjectUrlEntry(entry: CachedResourceObjectUrlEntry): void {
  if (resourceObjectUrlCache.get(entry.source) !== entry) return;
  resourceObjectUrlCache.delete(entry.source);
  entry.handle.revoke();
}

function createResolvedResourceObjectUrlHandle(blob: Blob): ResourceObjectUrlHandle {
  const url = URL.createObjectURL(blob);
  let revoked = false;
  return {
    url,
    ready: Promise.resolve(url),
    revoke(): void {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(url);
    },
  };
}

function createPendingResourceObjectUrlHandle(source: string): ResourceObjectUrlHandle {
  let objectUrl: string | null = null;
  let revoked = false;
  const handle: ResourceObjectUrlHandle = {
    url: '',
    ready: Promise.resolve(),
    revoke(): void {
      if (revoked) return;
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      handle.url = '';
    },
  };

  handle.ready = resourceBytes(source).then((blob) => {
    if (revoked) return;
    objectUrl = URL.createObjectURL(blob);
    handle.url = objectUrl;
    return objectUrl;
  });

  return handle;
}

function cacheResourceObjectUrlHandle(source: string, handle: ResourceObjectUrlHandle): CachedResourceObjectUrlEntry {
  const existing = resourceObjectUrlCache.get(source);
  if (existing) deleteCachedResourceObjectUrlEntry(existing);

  const entry: CachedResourceObjectUrlEntry = {
    source,
    handle,
    resolvedUrl: resourceHandleUrl(handle, null),
    refCount: 0,
    lastUsed: 0,
  };
  touchResourceObjectUrlEntry(entry);
  resourceObjectUrlCache.set(source, entry);
  evictResourceObjectUrlCache();
  return entry;
}

function getCachedResourceObjectUrlEntry(
  source: string,
  options: Pick<ResourceObjectUrlOptions, 'refresh'> = {},
): CachedResourceObjectUrlEntry {
  const existing = resourceObjectUrlCache.get(source);
  if (existing && !options.refresh) {
    touchResourceObjectUrlEntry(existing);
    return existing;
  }

  if (existing && options.refresh) deleteCachedResourceObjectUrlEntry(existing);

  const handle = createPendingResourceObjectUrlHandle(source);
  const entry = cacheResourceObjectUrlHandle(source, handle);

  Promise.resolve(handle.ready)
    .then(() => {
      if (resourceObjectUrlCache.get(source) !== entry) return;
      entry.resolvedUrl = resourceHandleUrl(handle, null);
      touchResourceObjectUrlEntry(entry);
    })
    .catch(() => {
      deleteCachedResourceObjectUrlEntry(entry);
    })
    .finally(evictResourceObjectUrlCache);

  evictResourceObjectUrlCache();
  return entry;
}

function resourceBytesManyItemError(item: ResourceBytesErrorItem): Error {
  return new Error(item.message ? `${item.error}: ${item.message}` : item.error);
}

function parseResourceImageBatchParameter(parameter: ResourceImageBatchParameter): ResourceImageBatchOptions {
  if (typeof parameter === 'object' && parameter !== null && 'source' in parameter) {
    return parameter;
  }
  return { source: parameter };
}

function cancelBatchedResourceImageJob(job: BatchedResourceImageJob): void {
  if (!job.active) return;
  job.active = false;
  const group = job.group;
  if (!group) return;
  group.jobs.delete(job);
  job.group = null;
  if (group.jobs.size === 0) group.subscription.close();
}

function queueBatchedResourceImageFlush(): void {
  if (batchedResourceImageFlushTimer !== null) return;
  batchedResourceImageFlushTimer = setTimeout(() => {
    batchedResourceImageFlushTimer = null;
    flushBatchedResourceImageJobs();
  }, RESOURCE_IMAGE_BATCH_DEBOUNCE_MS);
}

function enqueueBatchedResourceImageJob(job: BatchedResourceImageJob): void {
  pendingBatchedResourceImageJobs.push(job);
  queueBatchedResourceImageFlush();
}

function flushBatchedResourceImageJobs(): void {
  batchedResourceImageFlushTimer = null;
  const jobs = pendingBatchedResourceImageJobs.splice(0).filter((job) => job.active);
  if (jobs.length === 0) return;

  const jobsByChunkSize = new Map<number, BatchedResourceImageJob[]>();
  for (const job of jobs) {
    const group = jobsByChunkSize.get(job.chunkSize) ?? [];
    group.push(job);
    jobsByChunkSize.set(job.chunkSize, group);
  }

  for (const [chunkSize, groupedJobs] of jobsByChunkSize) {
    const jobsBySource = new Map<string, BatchedResourceImageJob[]>();
    for (const job of groupedJobs) {
      const sourceJobs = jobsBySource.get(job.source) ?? [];
      sourceJobs.push(job);
      jobsBySource.set(job.source, sourceJobs);
    }

    const group: BatchedResourceImageGroup = {
      jobs: new Set(groupedJobs),
      subscription: NOOP_SUBSCRIPTION,
    };
    for (const job of groupedJobs) job.group = group;

    const subscription = loadResourceObjectUrls(
      [...jobsBySource.keys()],
      (source, url) => {
        for (const job of jobsBySource.get(source) ?? []) {
          if (job.active && job.source === source) job.onChange(url);
        }
      },
      {
        chunkSize,
        refresh: groupedJobs.some((job) => job.refresh),
      },
    );
    group.subscription = subscription;

    if (![...group.jobs].some((job) => job.active)) subscription.close();
  }
}

export function clearResourceObjectUrlCache(): void {
  for (const entry of resourceObjectUrlCache.values()) entry.handle.revoke();
  resourceObjectUrlCache.clear();
}

export function preloadResourceObjectUrl(source: string | null | undefined): ResourceObjectUrlSubscription {
  const normalized = normalizeSource(source);
  if (!normalized || !shouldUseResourceNub(normalized)) return NOOP_SUBSCRIPTION;

  let closed = false;
  const entry = getCachedResourceObjectUrlEntry(normalized);
  Promise.resolve(entry.handle.ready).catch(() => undefined);

  return {
    close(): void {
      if (closed) return;
      closed = true;
      touchResourceObjectUrlEntry(entry);
      evictResourceObjectUrlCache();
    },
  };
}

export function loadResourceObjectUrl(
  source: string | null | undefined,
  onChange: (url: string | null) => void,
  options: ResourceObjectUrlOptions = {},
): ResourceObjectUrlSubscription {
  const normalized = normalizeSource(source);
  if (!normalized) {
    onChange(null);
    return NOOP_SUBSCRIPTION;
  }

  if (!shouldUseResourceNub(normalized)) {
    onChange(normalized);
    return NOOP_SUBSCRIPTION;
  }

  let closed = false;
  let entry: CachedResourceObjectUrlEntry | null = null;
  const fallbackUrl = browserLoadableFallback(normalized, options);

  try {
    entry = getCachedResourceObjectUrlEntry(normalized, { refresh: options.refresh });
    entry.refCount += 1;
    touchResourceObjectUrlEntry(entry);
  } catch (error) {
    onChange(fallbackUrl);
    options.onError?.(error);
    return NOOP_SUBSCRIPTION;
  }

  onChange(entry.resolvedUrl ?? fallbackUrl);

  Promise.resolve(entry.handle.ready)
    .then(() => {
      if (closed) return;
      onChange(resourceHandleUrl(entry?.handle ?? null, fallbackUrl));
    })
    .catch((error: unknown) => {
      if (closed) return;
      onChange(fallbackUrl);
      options.onError?.(error);
    });

  return {
    close(): void {
      if (closed) return;
      closed = true;
      if (entry) {
        entry.refCount = Math.max(0, entry.refCount - 1);
        touchResourceObjectUrlEntry(entry);
        evictResourceObjectUrlCache();
      }
      entry = null;
    },
  };
}

export function loadResourceObjectUrls(
  sources: readonly (string | null | undefined)[],
  onChange: ResourceObjectUrlsChange,
  options: ResourceObjectUrlOptions = {},
): ResourceObjectUrlSubscription {
  const trackedEntries = new Map<string, CachedResourceObjectUrlEntry>();
  const fetchSources: string[] = [];
  const seenSources = new Set<string>();
  const abortController = new AbortController();
  let closed = false;

  function trackEntry(entry: CachedResourceObjectUrlEntry): void {
    if (trackedEntries.has(entry.source)) return;
    entry.refCount += 1;
    touchResourceObjectUrlEntry(entry);
    trackedEntries.set(entry.source, entry);
  }

  function notifyCachedEntry(source: string, entry: CachedResourceObjectUrlEntry): void {
    const fallbackUrl = browserLoadableFallback(source, options);
    const currentUrl = entry.resolvedUrl ?? fallbackUrl;
    onChange(source, currentUrl);

    Promise.resolve(entry.handle.ready)
      .then(() => {
        if (closed) return;
        const nextUrl = resourceHandleUrl(entry.handle, fallbackUrl);
        if (nextUrl !== currentUrl) onChange(source, nextUrl);
      })
      .catch((error: unknown) => {
        if (closed) return;
        onChange(source, fallbackUrl);
        options.onError?.(error);
      });
  }

  function notifyFetchError(source: string, error: unknown): void {
    if (closed) return;
    onChange(source, browserLoadableFallback(source, options));
    options.onError?.(error);
  }

  for (const source of sources) {
    const normalized = normalizeSource(source);
    if (!normalized || seenSources.has(normalized)) continue;
    seenSources.add(normalized);

    if (!shouldUseResourceNub(normalized)) {
      onChange(normalized, normalized);
      continue;
    }

    const existing = resourceObjectUrlCache.get(normalized);
    if (existing && !options.refresh) {
      trackEntry(existing);
      notifyCachedEntry(normalized, existing);
      continue;
    }

    if (existing && options.refresh) deleteCachedResourceObjectUrlEntry(existing);
    fetchSources.push(normalized);
  }

  if (fetchSources.length > 0) {
    for (const fetchChunk of chunkItems(fetchSources, normalizeResourceChunkSize(options.chunkSize))) {
      let request: Promise<ResourceBytesItem[]>;
      try {
        request = resourceBytesMany(
          fetchChunk.map((url) => ({ url })),
          { signal: abortController.signal },
        );
      } catch (error) {
        for (const source of fetchChunk) notifyFetchError(source, error);
        continue;
      }

      void request
        .then((items: ResourceBytesItem[]) => {
          if (closed) return;
          items.forEach((item, index) => {
            const source = fetchChunk[index] ?? item.url;
            if (!source) return;

            if (item.ok) {
              const entry = cacheResourceObjectUrlHandle(source, createResolvedResourceObjectUrlHandle(item.blob));
              trackEntry(entry);
              notifyCachedEntry(source, entry);
            } else {
              notifyFetchError(source, resourceBytesManyItemError(item));
            }
          });
        })
        .catch((error: unknown) => {
          if (closed) return;
          for (const source of fetchChunk) notifyFetchError(source, error);
        });
    }
  }

  return {
    close(): void {
      if (closed) return;
      closed = true;
      abortController.abort();
      for (const entry of trackedEntries.values()) {
        entry.refCount = Math.max(0, entry.refCount - 1);
        touchResourceObjectUrlEntry(entry);
      }
      trackedEntries.clear();
      evictResourceObjectUrlCache();
    },
  };
}

export function resourceImage(
  node: HTMLImageElement,
  source: string | null | undefined,
): ResourceActionReturn<string | null | undefined> {
  let currentSource: string | null | undefined;
  let subscription: ResourceObjectUrlSubscription = NOOP_SUBSCRIPTION;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let resourceResolved = false;

  const presentation = createResourceImagePresentation(node, () => {
    resourceResolved = false;
    const normalized = normalizeSource(currentSource);
    if (!normalized || !shouldUseResourceNub(normalized)) return;
    const delay =
      RESOURCE_IMAGE_RETRY_DELAYS_MS[Math.min(attempt, RESOURCE_IMAGE_RETRY_DELAYS_MS.length - 1)]!;
    attempt++;
    scheduleRetry(delay);
  });

  function clearRetry(): void {
    if (retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry(delay: number): void {
    if (resourceResolved || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      subscribe(currentSource, true);
    }, delay);
  }

  function subscribe(nextSource: string | null | undefined, refresh = false): void {
    const normalized = normalizeSource(nextSource);
    resourceResolved = false;
    presentation.clear(normalized ? 'loading' : 'empty');

    subscription.close();
    subscription = loadResourceObjectUrl(nextSource, (resolvedUrl) => {
      if (resolvedUrl) {
        resourceResolved = true;
        clearRetry();
        presentation.show(resolvedUrl);
      }
    }, {
      refresh,
      onError: () => {
        presentation.clear('error');
        const delay =
          RESOURCE_IMAGE_RETRY_DELAYS_MS[Math.min(attempt, RESOURCE_IMAGE_RETRY_DELAYS_MS.length - 1)]!;
        attempt++;
        clearRetry();
        scheduleRetry(delay);
      },
    });
    if (normalized && shouldUseResourceNub(normalized)) scheduleRetry(RESOURCE_IMAGE_STALLED_RETRY_MS);
  }

  function setSource(nextSource: string | null | undefined): void {
    if (nextSource === currentSource) return;
    currentSource = nextSource;
    attempt = 0;
    clearRetry();
    subscribe(nextSource);
  }

  setSource(source);

  return {
    update: setSource,
    destroy(): void {
      clearRetry();
      subscription.close();
      node.removeAttribute('src');
      presentation.destroy();
    },
  };
}

export function resourceImageBatch(
  node: HTMLImageElement,
  parameter: ResourceImageBatchParameter,
): ResourceActionReturn<ResourceImageBatchParameter> {
  let currentSource: string | null = null;
  let currentChunkSize = RESOURCE_IMAGE_BATCH_SIZE;
  let activeJob: BatchedResourceImageJob | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let resolved = false;

  const presentation = createResourceImagePresentation(node, () => {
    resolved = false;
    if (!currentSource || !shouldUseResourceNub(currentSource)) return;
    const delay =
      RESOURCE_IMAGE_RETRY_DELAYS_MS[Math.min(attempt, RESOURCE_IMAGE_RETRY_DELAYS_MS.length - 1)]!;
    attempt++;
    scheduleRetry(delay);
  });

  function clearRetry(): void {
    if (retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  function cancelActiveJob(): void {
    if (!activeJob) return;
    cancelBatchedResourceImageJob(activeJob);
    activeJob = null;
  }

  function scheduleRetry(delay: number): void {
    if (resolved || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      subscribe(true);
    }, delay);
  }

  function subscribe(refresh = false): void {
    cancelActiveJob();
    resolved = false;

    if (!currentSource) {
      presentation.clear('empty');
      return;
    }

    presentation.clear('loading');

    if (!shouldUseResourceNub(currentSource)) {
      resolved = true;
      presentation.show(currentSource);
      return;
    }

    const source = currentSource;
    const job: BatchedResourceImageJob = {
      active: true,
      chunkSize: currentChunkSize,
      refresh,
      source,
      group: null,
      onChange: (resolvedUrl) => {
        if (!job.active || currentSource !== source) return;
        if (resolvedUrl) {
          resolved = true;
          clearRetry();
          presentation.show(resolvedUrl);
          return;
        }

        presentation.clear('error');
        const delay =
          RESOURCE_IMAGE_RETRY_DELAYS_MS[Math.min(attempt, RESOURCE_IMAGE_RETRY_DELAYS_MS.length - 1)]!;
        attempt++;
        scheduleRetry(delay);
      },
    };
    activeJob = job;
    enqueueBatchedResourceImageJob(job);
    scheduleRetry(RESOURCE_IMAGE_STALLED_RETRY_MS);
  }

  function setParameter(nextParameter: ResourceImageBatchParameter): void {
    const next = parseResourceImageBatchParameter(nextParameter);
    const nextSource = normalizeSource(next.source);
    const nextChunkSize = normalizeResourceChunkSize(next.chunkSize, RESOURCE_IMAGE_BATCH_SIZE)!;
    if (nextSource === currentSource && nextChunkSize === currentChunkSize) return;

    currentSource = nextSource;
    currentChunkSize = nextChunkSize;
    attempt = 0;
    clearRetry();
    subscribe();
  }

  setParameter(parameter);

  return {
    update: setParameter,
    destroy(): void {
      clearRetry();
      cancelActiveJob();
      node.removeAttribute('src');
      presentation.destroy();
    },
  };
}

export function resourceBackgroundImage(
  node: HTMLElement,
  source: string | null | undefined,
): ResourceActionReturn<string | null | undefined> {
  let currentSource: string | null | undefined;
  let subscription: ResourceObjectUrlSubscription = NOOP_SUBSCRIPTION;

  function setSource(nextSource: string | null | undefined): void {
    if (nextSource === currentSource) return;
    currentSource = nextSource;
    subscription.close();
    subscription = loadResourceObjectUrl(nextSource, (resolvedUrl) => {
      if (resolvedUrl) {
        node.style.backgroundImage = `url(${JSON.stringify(resolvedUrl)})`;
        node.style.backgroundSize = 'cover';
        node.style.backgroundPosition = 'center';
      } else {
        node.style.removeProperty('background-image');
      }
    });
  }

  setSource(source);

  return {
    update: setSource,
    destroy(): void {
      subscription.close();
      node.style.removeProperty('background-image');
    },
  };
}
