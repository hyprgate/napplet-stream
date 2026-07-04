import type { Theme, ThemeGetResultMessage } from '@napplet/nap/theme/types';
import {
  isThemeCatalogEnvelope,
  isThemeEnvelope,
  normalizeBuiltInTheme,
  normalizeBuiltInThemeCatalogItem,
} from './theme-normalize.js';
import { applyBuiltInTheme } from './theme-css.js';
import {
  BUILT_IN_THEME_FALLBACK,
  DEFAULT_REQUEST_TIMEOUT_MS,
  THEME_CATALOG_LIST,
  THEME_CATALOG_LIST_RESULT,
  THEME_CHANGED,
  THEME_GET,
  THEME_GET_RESULT,
  type BuiltInThemeCatalogItem,
  type BuiltInThemeCatalogResult,
  type BuiltInThemeClient,
  type BuiltInThemeSnapshot,
  type BuiltInThemeSource,
  type InstallBuiltInThemeClientOptions,
  type RequestBuiltInThemeCatalogOptions,
  type RequestBuiltInThemeOptions,
} from './theme-constants.js';

// Re-export the public theme API so `@hyprgate/utils` and the
// `./theme-client.js` import path keep exporting the same symbols.
export * from './theme-constants.js';
export {
  normalizeBuiltInTheme,
  isSafeUrl,
  isSafeImageUrl,
  normalizeBuiltInThemeCatalogItem,
} from './theme-normalize.js';
export {
  deriveBuiltInThemeCssVariables,
  fontStackFor,
  buildThemeFontFaceCss,
  applyBuiltInTheme,
} from './theme-css.js';

function getBrowserWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  return window;
}

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function requestBuiltInTheme(options: RequestBuiltInThemeOptions = {}): Promise<Theme | null> {
  const win = getBrowserWindow();
  if (!win?.parent) return Promise.resolve(null);

  const id = createRequestId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  return new Promise<Theme | null>((resolve) => {
    let settled = false;

    const settle = (theme: Theme | null): void => {
      if (settled) return;
      settled = true;
      win.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
      resolve(theme);
    };

    const handleMessage = (event: MessageEvent): void => {
      if (event.source !== win.parent) return;
      if (!isThemeEnvelope(event.data)) return;
      if (event.data.type !== THEME_GET_RESULT || event.data.id !== id) return;
      const result = event.data as ThemeGetResultMessage;
      if (result.error) {
        settle(null);
        return;
      }
      settle(normalizeBuiltInTheme(result.theme));
    };

    const timeout = setTimeout(() => settle(null), timeoutMs);
    win.addEventListener('message', handleMessage);

    try {
      win.parent.postMessage({ type: THEME_GET, id }, '*');
    } catch {
      settle(null);
    }
  });
}

export function requestBuiltInThemeCatalog(
  options: RequestBuiltInThemeCatalogOptions = {},
): Promise<BuiltInThemeCatalogResult | null> {
  const win = getBrowserWindow();
  if (!win?.parent) return Promise.resolve(null);

  const id = createRequestId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  return new Promise<BuiltInThemeCatalogResult | null>((resolve) => {
    let settled = false;

    const settle = (result: BuiltInThemeCatalogResult | null): void => {
      if (settled) return;
      settled = true;
      win.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
      resolve(result);
    };

    const handleMessage = (event: MessageEvent): void => {
      if (event.source !== win.parent) return;
      if (!isThemeCatalogEnvelope(event.data)) return;
      if (event.data.type !== THEME_CATALOG_LIST_RESULT || event.data.id !== id) return;
      if (event.data.error) {
        settle(null);
        return;
      }

      const entries = Array.isArray(event.data.entries)
        ? event.data.entries.map(normalizeBuiltInThemeCatalogItem).filter((entry): entry is BuiltInThemeCatalogItem => entry !== null)
        : [];
      const activeId = typeof event.data.activeId === 'string' ? event.data.activeId : undefined;
      settle({ entries, activeId });
    };

    const timeout = setTimeout(() => settle(null), timeoutMs);
    win.addEventListener('message', handleMessage);

    try {
      win.parent.postMessage({ type: THEME_CATALOG_LIST, id }, '*');
    } catch {
      settle(null);
    }
  });
}

export function installBuiltInThemeClient(options: InstallBuiltInThemeClientOptions = {}): BuiltInThemeClient {
  const win = getBrowserWindow();
  const fallback = normalizeBuiltInTheme(options.fallbackTheme) ?? BUILT_IN_THEME_FALLBACK;
  let currentTheme = applyBuiltInTheme(fallback, options);
  let closed = false;

  const publishSnapshot = (snapshot: BuiltInThemeSnapshot): void => {
    options.onThemeApplied?.(snapshot);
  };

  publishSnapshot({ theme: currentTheme, source: 'fallback' });

  const applySnapshot = (theme: Theme, source: BuiltInThemeSource): BuiltInThemeSnapshot => {
    currentTheme = applyBuiltInTheme(theme, options);
    const snapshot: BuiltInThemeSnapshot = { theme: currentTheme, source };
    publishSnapshot(snapshot);
    return snapshot;
  };

  const handleMessage = (event: MessageEvent): void => {
    if (closed || event.source !== win?.parent) return;
    if (!isThemeEnvelope(event.data) || event.data.type !== THEME_CHANGED) return;
    const theme = normalizeBuiltInTheme(event.data.theme);
    if (!theme) return;
    applySnapshot(theme, 'changed');
  };

  if (win) {
    win.addEventListener('message', handleMessage);
  }

  const ready = requestBuiltInTheme({ timeoutMs: options.timeoutMs }).then((theme) => {
    if (closed || !theme) return { theme: currentTheme, source: 'fallback' as const };
    return applySnapshot(theme, 'service');
  });

  return {
    ready,
    get currentTheme() {
      return currentTheme;
    },
    close() {
      closed = true;
      win?.removeEventListener('message', handleMessage);
    },
  };
}
