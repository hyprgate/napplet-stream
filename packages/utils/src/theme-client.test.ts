import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_THEME_FALLBACK,
  BUILT_IN_THEME_STYLE_ELEMENT_ID,
  applyBuiltInTheme,
  deriveBuiltInThemeCssVariables,
  installBuiltInThemeClient,
  normalizeBuiltInTheme,
  requestBuiltInThemeCatalog,
  requestBuiltInTheme,
  type BuiltInThemeSnapshot,
} from './theme-client.js';
import type { Theme } from '@napplet/nap/theme/types';

const serviceTheme: Theme = {
  title: 'Service Theme',
  colors: {
    background: '#20242f',
    text: '#f4f0e8',
    primary: '#8ab17d',
  },
};

const backgroundTheme: Theme = {
  ...serviceTheme,
  background: {
    url: 'https://example.test/background.jpg',
    mode: 'cover',
    mime: 'image/jpeg',
  },
};

function dispatchParentMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', {
    data,
    source: window.parent,
  }));
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.hgThemeClient;
  delete document.documentElement.dataset.hgThemeTitle;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('normalizeBuiltInTheme', () => {
  it('accepts only the existing NUB Theme payload shape', () => {
    expect(normalizeBuiltInTheme({
      title: 'LOUD',
      colors: {
        background: '#ABCDEF',
        text: '#123456',
        primary: '#FEDCBA',
      },
      rawCss: 'body { display: none }',
    })).toEqual({
      title: 'LOUD',
      colors: {
        background: '#abcdef',
        text: '#123456',
        primary: '#fedcba',
      },
    });

    expect(normalizeBuiltInTheme({
      colors: {
        background: 'black',
        text: '#123456',
        primary: '#fedcba',
      },
    })).toBeNull();
  });

  it('accepts http(s) and base64 data: font URLs but rejects other schemes', () => {
    const colors = { background: '#111111', text: '#eeeeee', primary: '#7fb37a' };

    // http(s) URL passes (length-capped at 1000 chars).
    const httpFont = normalizeBuiltInTheme({
      colors,
      fonts: { body: { name: 'JetBrains Mono', url: 'https://fonts.example/jbm.ttf' } },
    });
    expect(httpFont?.fonts?.body?.url).toBe('https://fonts.example/jbm.ttf');

    // A long base64 data: font URL (shell-inlined) is accepted despite exceeding
    // the 1000-char http cap — napplets run under `font-src data:` CSP.
    const dataUrl = `data:font/ttf;base64,${'A'.repeat(40_000)}`;
    const dataFont = normalizeBuiltInTheme({
      colors,
      fonts: { title: { name: 'Atkinson Hyperlegible', url: dataUrl } },
    });
    expect(dataFont?.fonts?.title?.url).toBe(dataUrl);

    // Non-font data: URLs and other schemes are rejected.
    const unsafe = normalizeBuiltInTheme({
      colors,
      fonts: { body: { name: 'Evil', url: 'data:text/html;base64,PHNjcmlwdD4=' } },
    });
    expect(unsafe?.fonts).toBeUndefined();
  });
});

describe('deriveBuiltInThemeCssVariables', () => {
  it('maps Theme colors to a fixed CSS variable allowlist', () => {
    const variables = deriveBuiltInThemeCssVariables(serviceTheme);

    expect(variables['--hg-theme-background']).toBe('#20242f');
    expect(variables['--hg-theme-text']).toBe('#f4f0e8');
    expect(variables['--hg-theme-primary']).toBe('#8ab17d');
    expect(variables['--hg-theme-background-image']).toBe('none');
    expect(variables['--hg-accent-primary']).toBe('#8ab17d');
    expect(variables['--hg-bg']).toBe('#20242f');
    expect(variables['--hg-text']).toBe('#f4f0e8');
    expect(variables['--hg-surface']).toBe(variables['--hg-bg-surface']);
    expect(variables['--hg-border']).toBe(variables['--hg-border-default']);
    expect(variables['--hg-border-accent']).toBe('rgba(138, 177, 125, 0.5)');
    expect(variables['--hg-window-border-active']).toBe('rgba(138, 177, 125, 0.72)');
    expect(variables['--hg-window-border-inactive']).toBe('rgba(244, 240, 232, 0.12)');
    expect(variables['--hg-accent']).toBe('#8ab17d');
    expect(variables['--hg-accent-cyan']).toBe('#8ab17d');
    expect(variables['--hg-accent-yellow']).toBe(variables['--hg-accent-warning']);
    expect(variables['--hg-danger']).toBe(variables['--hg-accent-danger']);
    expect(variables['--un-color-bg-base']).toBe('#20242f');
  });

  it('maps Theme.background to safe CSS background tokens', () => {
    const variables = deriveBuiltInThemeCssVariables(backgroundTheme);

    expect(variables['--hg-theme-background-image']).toBe('url("https://example.test/background.jpg")');
    expect(variables['--hg-theme-background-size']).toBe('cover');
    expect(variables['--hg-theme-background-repeat']).toBe('no-repeat');
    expect(variables['--hg-theme-background-position']).toBe('center');
  });
});

describe('applyBuiltInTheme', () => {
  it('applies CSS variables and installs the compatibility stylesheet', () => {
    const normalized = applyBuiltInTheme(serviceTheme);

    expect(normalized).toEqual(serviceTheme);
    expect(document.documentElement.style.getPropertyValue('--hg-theme-background')).toBe('#20242f');
    expect(document.documentElement.style.getPropertyValue('--hg-accent-primary')).toBe('#8ab17d');
    expect(document.documentElement.dataset.hgThemeClient).toBe('active');
    expect(document.getElementById(BUILT_IN_THEME_STYLE_ELEMENT_ID)?.textContent).toContain('.bg-bg-base');
  });
});

describe('requestBuiltInTheme', () => {
  it('requests theme.get and resolves a valid theme.get.result payload', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

    const result = requestBuiltInTheme({ timeoutMs: 100 });
    const message = postMessage.mock.calls[0]?.[0] as { type: string; id: string };

    expect(message.type).toBe('theme.get');
    expect(message.id).toEqual(expect.any(String));
    expect(message.id.length).toBeGreaterThan(0);

    dispatchParentMessage({
      type: 'theme.get.result',
      id: message.id,
      theme: serviceTheme,
    });

    await expect(result).resolves.toEqual(serviceTheme);
  });

  it('returns null when the theme service is missing', async () => {
    vi.useFakeTimers();
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

    const result = requestBuiltInTheme({ timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBeNull();
  });
});

describe('requestBuiltInThemeCatalog', () => {
  it('requests cached theme catalog entries and normalizes the result', async () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

    const result = requestBuiltInThemeCatalog({ timeoutMs: 100 });
    const message = postMessage.mock.calls[0]?.[0] as { type: string; id: string };

    expect(message.type).toBe('hyprgate.themeCatalog.list');
    expect(message.id).toEqual(expect.any(String));

    dispatchParentMessage({
      type: 'hyprgate.themeCatalog.list.result',
      id: message.id,
      activeId: 'service-theme',
      entries: [{
        id: 'service-theme',
        title: 'Service Theme',
        source: 'relay',
        sourceLabel: 'relay theme',
        active: true,
        theme: backgroundTheme,
      }],
    });

    await expect(result).resolves.toEqual({
      activeId: 'service-theme',
      entries: [{
        id: 'service-theme',
        title: 'Service Theme',
        source: 'relay',
        sourceLabel: 'relay theme',
        active: true,
        theme: backgroundTheme,
      }],
    });
  });

  it('returns null when the catalog channel is unavailable', async () => {
    vi.useFakeTimers();
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

    const result = requestBuiltInThemeCatalog({ timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBeNull();
  });
});

describe('installBuiltInThemeClient', () => {
  it('keeps the bundled fallback when theme.get returns an invalid payload', async () => {
    const snapshots: BuiltInThemeSnapshot[] = [];
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

    const client = installBuiltInThemeClient({
      timeoutMs: 100,
      onThemeApplied: (snapshot) => snapshots.push(snapshot),
    });
    const message = postMessage.mock.calls[0]?.[0] as { id: string };

    dispatchParentMessage({
      type: 'theme.get.result',
      id: message.id,
      theme: {
        colors: {
          background: 'transparent',
          text: '#ffffff',
          primary: '#000000',
        },
      },
    });

    await expect(client.ready).resolves.toEqual({
      theme: BUILT_IN_THEME_FALLBACK,
      source: 'fallback',
    });
    expect(snapshots.map((snapshot) => snapshot.source)).toEqual(['fallback']);
    expect(document.documentElement.style.getPropertyValue('--hg-theme-background')).toBe('#151923');

    client.close();
  });

  it('applies delayed valid theme.get results after synchronous fallback', async () => {
    const snapshots: BuiltInThemeSnapshot[] = [];
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

    const client = installBuiltInThemeClient({
      timeoutMs: 100,
      onThemeApplied: (snapshot) => snapshots.push(snapshot),
    });

    expect(document.documentElement.style.getPropertyValue('--hg-theme-background')).toBe('#151923');

    const message = postMessage.mock.calls[0]?.[0] as { id: string };
    dispatchParentMessage({
      type: 'theme.get.result',
      id: message.id,
      theme: serviceTheme,
    });

    await expect(client.ready).resolves.toEqual({
      theme: serviceTheme,
      source: 'service',
    });
    expect(snapshots.map((snapshot) => snapshot.source)).toEqual(['fallback', 'service']);
    expect(document.documentElement.style.getPropertyValue('--hg-theme-background')).toBe('#20242f');

    client.close();
  });

  it('applies theme.changed without reinstalling or reloading the napplet', async () => {
    vi.useFakeTimers();
    const snapshots: BuiltInThemeSnapshot[] = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

    const client = installBuiltInThemeClient({
      timeoutMs: 10,
      onThemeApplied: (snapshot) => snapshots.push(snapshot),
    });
    const styleElement = document.getElementById(BUILT_IN_THEME_STYLE_ELEMENT_ID);

    dispatchParentMessage({
      type: 'theme.changed',
      theme: serviceTheme,
    });

    expect(document.getElementById(BUILT_IN_THEME_STYLE_ELEMENT_ID)).toBe(styleElement);
    expect(document.documentElement.style.getPropertyValue('--hg-theme-background')).toBe('#20242f');
    expect(snapshots.at(-1)).toEqual({ theme: serviceTheme, source: 'changed' });

    client.close();
    dispatchParentMessage({
      type: 'theme.changed',
      theme: {
        colors: {
          background: '#000000',
          text: '#ffffff',
          primary: '#ff0000',
        },
      },
    });

    expect(document.documentElement.style.getPropertyValue('--hg-theme-background')).toBe('#20242f');

    await vi.advanceTimersByTimeAsync(10);
    await expect(client.ready).resolves.toEqual({
      theme: serviceTheme,
      source: 'fallback',
    });
  });
});
