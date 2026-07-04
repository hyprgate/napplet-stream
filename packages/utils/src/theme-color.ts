type Rgb = {
  r: number;
  g: number;
  b: number;
};

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function hexToRgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function channelToHex(channel: number): string {
  return Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0');
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

export function mixColor(baseHex: string, overlayHex: string, overlayAmount: number): string {
  const base = hexToRgb(baseHex);
  const overlay = hexToRgb(overlayHex);
  return rgbToHex({
    r: base.r + (overlay.r - base.r) * overlayAmount,
    g: base.g + (overlay.g - base.g) * overlayAmount,
    b: base.b + (overlay.b - base.b) * overlayAmount,
  });
}

export function rgbaColor(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function rgbChannels(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}
