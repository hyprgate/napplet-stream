import type { Theme, ThemeFont } from '@napplet/nap/theme/types';
import { mixColor, rgbaColor, rgbChannels } from './theme-color.js';
import { isSafeImageUrl, normalizeBuiltInTheme } from './theme-normalize.js';
import {
  BUILT_IN_THEME_CSS_TOKENS,
  BUILT_IN_THEME_FALLBACK,
  BUILT_IN_THEME_FONTS_ELEMENT_ID,
  BUILT_IN_THEME_STYLE_ELEMENT_ID,
  DEFAULT_BODY_FONT_STACK,
  DEFAULT_TITLE_FONT_STACK,
  THEME_CLIENT_STYLE,
  type ApplyBuiltInThemeOptions,
  type BuiltInThemeCssVariables,
} from './theme-constants.js';

function getBrowserWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  return window;
}

export function deriveBuiltInThemeCssVariables(theme: Theme): BuiltInThemeCssVariables {
  const normalized = normalizeBuiltInTheme(theme);
  const safeTheme = normalized ?? BUILT_IN_THEME_FALLBACK;
  const { background, text, primary } = safeTheme.colors;

  const surface = mixColor(background, text, 0.06);
  const elevated = mixColor(background, text, 0.1);
  const overlay = mixColor(background, text, 0.14);
  const border = mixColor(background, text, 0.18);
  const borderDim = mixColor(background, text, 0.11);
  const textSecondary = mixColor(background, text, 0.78);
  const textMuted = mixColor(background, text, 0.58);
  const textDim = mixColor(background, text, 0.42);

  return {
    '--hg-theme-background': background,
    '--hg-theme-text': text,
    '--hg-theme-primary': primary,
    ...deriveBuiltInThemeBackgroundCssVariables(safeTheme),
    '--hg-bg': background,
    '--hg-bg-base': background,
    '--hg-bg-base-rgb': rgbChannels(background),
    '--hg-surface': surface,
    '--hg-bg-surface': surface,
    '--hg-bg-surface-rgb': rgbChannels(surface),
    '--hg-bg-elevated': elevated,
    '--hg-bg-elevated-rgb': rgbChannels(elevated),
    '--hg-bg-overlay': overlay,
    '--hg-bg-overlay-rgb': rgbChannels(background),
    '--hg-border': border,
    '--hg-border-default': border,
    '--hg-border-dim': borderDim,
    '--hg-border-muted': borderDim,
    '--hg-border-default-rgb': rgbChannels(border),
    '--hg-border-muted-rgb': rgbChannels(borderDim),
    '--hg-border-accent': rgbaColor(primary, 0.5),
    '--hg-window-border-active': rgbaColor(primary, 0.72),
    '--hg-window-border-inactive': rgbaColor(text, 0.12),
    '--hg-accent': primary,
    '--hg-accent-primary': primary,
    '--hg-accent-primary-rgb': rgbChannels(primary),
    '--hg-accent-green': primary,
    '--hg-accent-cyan': primary,
    '--hg-accent-warning': '#d6ae68',
    '--hg-accent-warning-rgb': '214 174 104',
    '--hg-accent-yellow': '#d6ae68',
    '--hg-warn': '#d6ae68',
    '--hg-accent-danger': '#d7797d',
    '--hg-accent-danger-rgb': '215 121 125',
    '--hg-accent-red': '#d7797d',
    '--hg-danger': '#d7797d',
    '--hg-text': text,
    '--hg-text-primary': text,
    '--hg-text-primary-rgb': rgbChannels(text),
    '--hg-text-secondary': textSecondary,
    '--hg-text-secondary-rgb': rgbChannels(textSecondary),
    '--hg-text-muted': textMuted,
    '--hg-text-muted-rgb': rgbChannels(textMuted),
    '--hg-text-dim': textDim,
    '--hg-text-dim-rgb': rgbChannels(textDim),
    '--hg-font-body': fontStackFor(safeTheme.fonts?.body, DEFAULT_BODY_FONT_STACK),
    '--hg-font-title': fontStackFor(
      safeTheme.fonts?.title ?? safeTheme.fonts?.body,
      DEFAULT_TITLE_FONT_STACK,
    ),
    '--un-color-bg-base': background,
    '--un-color-bg-surface': surface,
    '--un-color-bg-elevated': elevated,
    '--un-color-bg-overlay': overlay,
    '--un-color-border': border,
    '--un-color-border-default': border,
    '--un-color-border-dim': borderDim,
    '--un-color-accent-green': primary,
    '--un-color-accent-cyan': primary,
    '--un-color-accent-amber': '#d6ae68',
    '--un-color-accent-red': '#d7797d',
    '--un-color-text-primary': text,
    '--un-color-text-secondary': textSecondary,
    '--un-color-text-muted': textMuted,
    '--un-color-text-dim': textDim,
  };
}

function deriveBuiltInThemeBackgroundCssVariables(theme: Theme): Pick<
  BuiltInThemeCssVariables,
  | '--hg-theme-background-image'
  | '--hg-theme-background-size'
  | '--hg-theme-background-repeat'
  | '--hg-theme-background-position'
> {
  const image = theme.background?.url ? cssBackgroundImage(theme.background.url) : null;
  const mode = theme.background?.mode?.trim() ?? '';
  const tiled = mode.toLowerCase() === 'tile';

  return {
    '--hg-theme-background-image': image ?? 'none',
    '--hg-theme-background-size': tiled ? 'auto' : normalizeBackgroundSize(mode),
    '--hg-theme-background-repeat': tiled ? 'repeat' : 'no-repeat',
    '--hg-theme-background-position': 'center',
  };
}

function cssBackgroundImage(value: string): string | null {
  const url = value.trim();
  if (!isSafeImageUrl(url)) return null;
  return `url("${escapeCssString(url)}")`;
}

function normalizeBackgroundSize(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'theme') return 'cover';
  if (!/^[a-zA-Z0-9_ .,%/-]+$/.test(trimmed)) return 'cover';
  return trimmed;
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, '');
}

/** Quote a font family name for use in CSS, or null if it contains unsafe chars. */
function quoteFontName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || !/^[a-zA-Z0-9 _-]+$/.test(trimmed)) return null;
  return `"${trimmed}"`;
}

/** Build a font-family value: the theme font (if valid) prepended to a fallback stack. */
export function fontStackFor(font: ThemeFont | undefined, fallback: string): string {
  if (!font?.name) return fallback;
  const quoted = quoteFontName(font.name);
  return quoted ? `${quoted}, ${fallback}` : fallback;
}

/** Build @font-face rules for the theme's fonts so their URLs actually load. */
export function buildThemeFontFaceCss(theme: Theme): string {
  const faces: string[] = [];
  const seen = new Set<string>();
  for (const font of [theme.fonts?.body, theme.fonts?.title]) {
    if (!font?.name || !font?.url) continue;
    const quoted = quoteFontName(font.name);
    if (!quoted) continue;
    const key = `${font.name}|${font.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(
      `@font-face { font-family: ${quoted}; src: url("${escapeCssString(font.url)}"); font-display: swap; }`,
    );
  }
  return faces.join('\n');
}

function ensureThemeFontFaceStyle(doc: Document, theme: Theme): void {
  const css = buildThemeFontFaceCss(theme);
  let style = doc.getElementById(BUILT_IN_THEME_FONTS_ELEMENT_ID) as HTMLStyleElement | null;
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = doc.createElement('style');
    style.id = BUILT_IN_THEME_FONTS_ELEMENT_ID;
    doc.head.append(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function ensureThemeClientStyle(doc: Document): void {
  if (doc.getElementById(BUILT_IN_THEME_STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = BUILT_IN_THEME_STYLE_ELEMENT_ID;
  style.textContent = THEME_CLIENT_STYLE;
  doc.head.append(style);
}

export function applyBuiltInTheme(theme: Theme, options: ApplyBuiltInThemeOptions = {}): Theme {
  const doc = options.document ?? options.root?.ownerDocument ?? getBrowserWindow()?.document;
  const root = options.root ?? doc?.documentElement;
  const normalized = normalizeBuiltInTheme(theme) ?? BUILT_IN_THEME_FALLBACK;

  if (!doc || !root) return normalized;

  ensureThemeClientStyle(doc);
  ensureThemeFontFaceStyle(doc, normalized);
  const variables = deriveBuiltInThemeCssVariables(normalized);
  for (const token of BUILT_IN_THEME_CSS_TOKENS) {
    root.style.setProperty(token, variables[token]);
  }
  root.dataset.hgThemeClient = 'active';
  root.dataset.hgThemeTitle = normalized.title ?? '';

  return normalized;
}
