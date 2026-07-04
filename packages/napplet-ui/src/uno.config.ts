import { defineConfig, presetIcons, presetUno } from 'unocss';

export function createHyprGateUnoConfig(overrides?: Parameters<typeof defineConfig>[0]) {
  return defineConfig({
    presets: [presetUno(), presetIcons()],
    theme: {
      fontFamily: {
        // Follow the active theme's fonts set by the napplet theme client.
        mono: "var(--hg-font-body, ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace)",
        sans: "var(--hg-font-title, var(--hg-font-body, ui-monospace, monospace))",
        title: "var(--hg-font-title, var(--hg-font-body, ui-monospace, monospace))",
      },
      colors: {
        'bg-base': 'rgb(var(--hg-bg-base-rgb))',
        'bg-surface': 'rgb(var(--hg-bg-surface-rgb))',
        'bg-elevated': 'rgb(var(--hg-bg-elevated-rgb))',
        'bg-overlay': 'rgb(var(--hg-bg-overlay-rgb))',
        border: {
          DEFAULT: 'rgb(var(--hg-border-default-rgb))',
          default: 'rgb(var(--hg-border-default-rgb))',
          dim: 'rgb(var(--hg-border-muted-rgb))',
        },
        'accent-green': 'rgb(var(--hg-accent-primary-rgb))',
        'accent-cyan': 'rgb(var(--hg-accent-primary-rgb))',
        'accent-amber': 'rgb(var(--hg-accent-warning-rgb))',
        'accent-red': 'rgb(var(--hg-accent-danger-rgb))',
        'text-primary': 'rgb(var(--hg-text-primary-rgb))',
        'text-secondary': 'rgb(var(--hg-text-secondary-rgb))',
        'text-muted': 'rgb(var(--hg-text-muted-rgb))',
        'text-dim': 'rgb(var(--hg-text-dim-rgb))',
      },
    },
    shortcuts: {
      'pane-chrome': 'bg-bg-surface border border-border rounded text-text-primary',
      'pane-titlebar': 'bg-bg-elevated border-b border-border px-3 py-1 text-xs text-text-muted',
      'btn-primary': 'bg-accent-green text-bg-base font-mono text-sm px-3 py-1 rounded hover:opacity-80',
      'btn-secondary': 'bg-bg-elevated text-text-primary border border-border font-mono text-sm px-3 py-1 rounded hover:bg-bg-surface',
    },
    ...overrides,
  });
}
