import type { Theme } from '@napplet/nap/theme/types';

/**
 * Stable public Google Fonts CDN URLs for the built-in fallback theme fonts.
 * These are canonical, versioned gstatic asset URLs (not deployment/env URLs).
 */
// aislop-ignore-next-line ai-slop/hardcoded-url -- stable public Google Fonts CDN asset URL
export const FALLBACK_BODY_FONT_URL =
  'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxTOlOQ.ttf';
// aislop-ignore-next-line ai-slop/hardcoded-url -- stable public Google Fonts CDN asset URL
export const FALLBACK_TITLE_FONT_URL =
  'https://fonts.gstatic.com/s/atkinsonhyperlegible/v11/9Bt23C1KxNDXMspQ1lPyU89-1h6ONRlW45GE5ZgpewSSbQ.ttf';

/**
 * Synthetic base origin used only to resolve relative URLs during validation.
 * Never fetched; `.local` is a non-routable reserved TLD.
 */
// aislop-ignore-next-line ai-slop/hardcoded-url -- synthetic non-routable base for URL parsing only, never fetched
export const URL_VALIDATION_BASE = 'https://hyprgate.local';

/**
 * Opt-in client for Hyprgate-owned built-in napplets.
 *
 * The shell still uses the standard NUB-THEME envelopes for every napplet.
 * Third-party napplets can request `theme.get` or receive `theme.changed`, but
 * Hyprgate does not force their DOM to consume these variables.
 */
export const BUILT_IN_THEME_FALLBACK: Theme = {
  title: 'Hyprgate Ditto Dark',
  colors: {
    background: '#151923',
    text: '#eef2f7',
    primary: '#7fb37a',
  },
  fonts: {
    body: {
      name: 'JetBrains Mono',
      url: FALLBACK_BODY_FONT_URL,
    },
    title: {
      name: 'Atkinson Hyperlegible',
      url: FALLBACK_TITLE_FONT_URL,
    },
  },
};

/** Default font stacks used when a theme does not define a font. */
export const DEFAULT_BODY_FONT_STACK = "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace";
export const DEFAULT_TITLE_FONT_STACK = DEFAULT_BODY_FONT_STACK;

export const BUILT_IN_THEME_STYLE_ELEMENT_ID = 'hyprgate-built-in-theme-client';
export const BUILT_IN_THEME_FONTS_ELEMENT_ID = 'hyprgate-built-in-theme-fonts';

export const BUILT_IN_THEME_CSS_TOKENS = [
  '--hg-theme-background',
  '--hg-theme-text',
  '--hg-theme-primary',
  '--hg-theme-background-image',
  '--hg-theme-background-size',
  '--hg-theme-background-repeat',
  '--hg-theme-background-position',
  '--hg-bg',
  '--hg-bg-base',
  '--hg-bg-base-rgb',
  '--hg-surface',
  '--hg-bg-surface',
  '--hg-bg-surface-rgb',
  '--hg-bg-elevated',
  '--hg-bg-elevated-rgb',
  '--hg-bg-overlay',
  '--hg-bg-overlay-rgb',
  '--hg-border',
  '--hg-border-default',
  '--hg-border-dim',
  '--hg-border-muted',
  '--hg-border-default-rgb',
  '--hg-border-muted-rgb',
  '--hg-border-accent',
  '--hg-window-border-active',
  '--hg-window-border-inactive',
  '--hg-accent',
  '--hg-accent-primary',
  '--hg-accent-primary-rgb',
  '--hg-accent-success',
  '--hg-terminal-selection-bg',
  '--hg-terminal-selection-text',
  '--hg-accent-green',
  '--hg-accent-cyan',
  '--hg-accent-warning',
  '--hg-accent-warning-rgb',
  '--hg-accent-yellow',
  '--hg-warn',
  '--hg-accent-danger',
  '--hg-accent-danger-rgb',
  '--hg-accent-red',
  '--hg-danger',
  '--hg-text',
  '--hg-text-primary',
  '--hg-text-primary-rgb',
  '--hg-text-secondary',
  '--hg-text-secondary-rgb',
  '--hg-text-muted',
  '--hg-text-muted-rgb',
  '--hg-text-dim',
  '--hg-text-dim-rgb',
  '--hg-font-body',
  '--hg-font-title',
  '--un-color-bg-base',
  '--un-color-bg-surface',
  '--un-color-bg-elevated',
  '--un-color-bg-overlay',
  '--un-color-border',
  '--un-color-border-default',
  '--un-color-border-dim',
  '--un-color-accent-green',
  '--un-color-accent-cyan',
  '--un-color-accent-amber',
  '--un-color-accent-red',
  '--un-color-text-primary',
  '--un-color-text-secondary',
  '--un-color-text-muted',
  '--un-color-text-dim',
] as const;

export type BuiltInThemeCssToken = typeof BUILT_IN_THEME_CSS_TOKENS[number];
export type BuiltInThemeCssVariables = Record<BuiltInThemeCssToken, string>;
export type BuiltInThemeSource = 'fallback' | 'service' | 'changed';

export interface BuiltInThemeSnapshot {
  theme: Theme;
  source: BuiltInThemeSource;
}

export interface BuiltInThemeClient {
  readonly ready: Promise<BuiltInThemeSnapshot>;
  readonly currentTheme: Theme;
  close(): void;
}

export interface RequestBuiltInThemeOptions {
  timeoutMs?: number;
}

export interface BuiltInThemeCatalogItem {
  id: string;
  title: string;
  source: string;
  sourceLabel: string;
  active: boolean;
  theme: Theme;
}

export interface BuiltInThemeCatalogResult {
  entries: BuiltInThemeCatalogItem[];
  activeId?: string;
}

export interface RequestBuiltInThemeCatalogOptions {
  timeoutMs?: number;
}

export interface ApplyBuiltInThemeOptions {
  root?: HTMLElement;
  document?: Document;
}

export interface InstallBuiltInThemeClientOptions extends ApplyBuiltInThemeOptions {
  timeoutMs?: number;
  fallbackTheme?: Theme;
  onThemeApplied?: (snapshot: BuiltInThemeSnapshot) => void;
}

export const THEME_GET = 'theme.get';
export const THEME_GET_RESULT = 'theme.get.result';
export const THEME_CHANGED = 'theme.changed';
export const THEME_CATALOG_LIST = 'hyprgate.themeCatalog.list';
export const THEME_CATALOG_LIST_RESULT = 'hyprgate.themeCatalog.list.result';
export const DEFAULT_REQUEST_TIMEOUT_MS = 1_500;

export const THEME_CLIENT_STYLE = `
:root[data-hg-theme-client="active"] ::selection {
  background-color: var(--hg-terminal-selection-bg);
  color: var(--hg-terminal-selection-text);
}

:root[data-hg-theme-client="active"] body,
:root[data-hg-theme-client="active"] #app,
:root[data-hg-theme-client="active"] .app,
:root[data-hg-theme-client="active"] main {
  background-color: var(--hg-bg-base) !important;
  color: var(--hg-text-primary) !important;
  font-family: var(--hg-font-body, ui-monospace, 'JetBrains Mono', monospace);
}

:root[data-hg-theme-client="active"] :where(h1, h2, h3, h4, h5, h6) {
  font-family: var(--hg-font-title, var(--hg-font-body, ui-monospace, monospace));
}

:root[data-hg-theme-client="active"] :where(.bg-bg-base) {
  background-color: var(--hg-bg-base) !important;
}

:root[data-hg-theme-client="active"] :where(.bg-bg-surface) {
  background-color: var(--hg-bg-surface) !important;
}

:root[data-hg-theme-client="active"] :where(.bg-bg-elevated) {
  background-color: var(--hg-bg-elevated) !important;
}

:root[data-hg-theme-client="active"] :where(.bg-bg-overlay) {
  background-color: var(--hg-bg-overlay) !important;
}

:root[data-hg-theme-client="active"] :where(.text-text-primary) {
  color: var(--hg-text-primary) !important;
}

:root[data-hg-theme-client="active"] :where(.text-text-secondary) {
  color: var(--hg-text-secondary) !important;
}

:root[data-hg-theme-client="active"] :where(.text-text-muted) {
  color: var(--hg-text-muted) !important;
}

:root[data-hg-theme-client="active"] :where(.text-text-dim) {
  color: var(--hg-text-dim) !important;
}

:root[data-hg-theme-client="active"] :where(.text-accent-green, .text-accent-cyan) {
  color: var(--hg-accent-primary) !important;
}

:root[data-hg-theme-client="active"] :where(.text-accent-amber) {
  color: var(--hg-accent-warning) !important;
}

:root[data-hg-theme-client="active"] :where(.text-accent-red) {
  color: var(--hg-accent-danger) !important;
}

:root[data-hg-theme-client="active"] :where(.border-border, .border-border-default) {
  border-color: var(--hg-border) !important;
}

:root[data-hg-theme-client="active"] :where(.border-border-dim) {
  border-color: var(--hg-border-dim) !important;
}

:root[data-hg-theme-client="active"] :where(.border-accent-green, .border-accent-cyan) {
  border-color: var(--hg-accent-primary) !important;
}

:root[data-hg-theme-client="active"] [class~="bg-accent-green"],
:root[data-hg-theme-client="active"] [class~="bg-accent-cyan"] {
  background-color: var(--hg-accent-primary) !important;
}

:root[data-hg-theme-client="active"] [class~="bg-accent-green/20"],
:root[data-hg-theme-client="active"] [class~="bg-accent-cyan/20"] {
  background-color: color-mix(in srgb, var(--hg-accent-primary) 20%, transparent) !important;
}

:root[data-hg-theme-client="active"] [class~="border-accent-green/40"],
:root[data-hg-theme-client="active"] [class~="border-accent-cyan/40"] {
  border-color: color-mix(in srgb, var(--hg-accent-primary) 40%, transparent) !important;
}
`.trim();
