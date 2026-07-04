import type { Theme, ThemeBackground, ThemeFont } from '@napplet/nap/theme/types';
import { normalizeHexColor } from './theme-color.js';
import { URL_VALIDATION_BASE, type BuiltInThemeCatalogItem } from './theme-constants.js';

export type ThemeEnvelope = {
  type: string;
  id?: string;
  theme?: unknown;
  error?: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isThemeEnvelope(value: unknown): value is ThemeEnvelope {
  return isRecord(value) && typeof value.type === 'string';
}

export function isThemeCatalogEnvelope(
  value: unknown,
): value is ThemeEnvelope & { entries?: unknown; activeId?: unknown } {
  return isThemeEnvelope(value);
}

export function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value, URL_VALIDATION_BASE);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Class-1 napplets run under a `font-src data:` CSP, so http(s) font URLs are
 * blocked. The shell inlines theme fonts as base64 `data:` URLs before
 * publishing them; accept those here in addition to plain http(s) URLs.
 */
const SAFE_DATA_FONT_URL =
  /^data:(?:font\/(?:ttf|otf|woff2?|sfnt|collection)|application\/(?:octet-stream|font-sfnt|font-woff|x-font-ttf|x-font-otf|x-font-woff));base64,[a-z0-9+/=]+$/i;

/** Cap for inlined data: font URLs (~3.7MB of font bytes once base64-decoded). */
const MAX_DATA_FONT_URL_LENGTH = 5_000_000;

function isSafeFontUrl(value: string): boolean {
  if (value.startsWith('data:')) return SAFE_DATA_FONT_URL.test(value);
  return isSafeUrl(value);
}

export function isSafeImageUrl(value: string): boolean {
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-zA-Z0-9+/=]+$/i.test(value)) return true;
  return isSafeUrl(value);
}

function normalizeThemeFont(value: unknown): ThemeFont | undefined {
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if (name.length === 0 || name.length > 80) return undefined;
  const maxUrlLength = url.startsWith('data:') ? MAX_DATA_FONT_URL_LENGTH : 1_000;
  if (url.length === 0 || url.length > maxUrlLength || !isSafeFontUrl(url)) return undefined;
  return { name, url };
}

function normalizeThemeBackground(value: unknown): ThemeBackground | undefined {
  if (!isRecord(value)) return undefined;
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const mode = typeof value.mode === 'string' ? value.mode.trim() : '';
  const mime = typeof value.mime === 'string' ? value.mime.trim().toLowerCase() : '';

  if (url.length === 0 || url.length > 1_000 || !isSafeUrl(url)) return undefined;
  if (mode.length === 0 || mode.length > 64 || !/^[a-zA-Z0-9_ .,%/-]+$/.test(mode)) return undefined;
  if (mime.length === 0 || mime.length > 120 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) return undefined;

  return { url, mode, mime };
}

export function normalizeBuiltInTheme(value: unknown): Theme | null {
  if (!isRecord(value)) return null;
  const colors = isRecord(value.colors) ? value.colors : null;
  if (!colors) return null;

  const background = normalizeHexColor(colors.background);
  const text = normalizeHexColor(colors.text);
  const primary = normalizeHexColor(colors.primary);
  if (!background || !text || !primary) return null;

  const theme: Theme = {
    colors: { background, text, primary },
  };

  if (typeof value.title === 'string') {
    const title = value.title.trim();
    if (title.length > 0) theme.title = title.slice(0, 120);
  }

  if (isRecord(value.fonts)) {
    const fonts: NonNullable<Theme['fonts']> = {};
    const body = normalizeThemeFont(value.fonts.body);
    const title = normalizeThemeFont(value.fonts.title);
    if (body) fonts.body = body;
    if (title) fonts.title = title;
    if (fonts.body || fonts.title) theme.fonts = fonts;
  }

  const backgroundMedia = normalizeThemeBackground(value.background);
  if (backgroundMedia) theme.background = backgroundMedia;

  return theme;
}

export function normalizeBuiltInThemeCatalogItem(value: unknown): BuiltInThemeCatalogItem | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const theme = normalizeBuiltInTheme(value.theme);
  if (!id || !theme) return null;

  return {
    id,
    title: typeof value.title === 'string' && value.title.trim()
      ? value.title.trim().slice(0, 120)
      : theme.title ?? id,
    source: typeof value.source === 'string' ? value.source.trim().slice(0, 80) : 'unknown',
    sourceLabel: typeof value.sourceLabel === 'string' ? value.sourceLabel.trim().slice(0, 120) : 'unknown',
    active: value.active === true,
    theme,
  };
}
