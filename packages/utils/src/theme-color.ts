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

export function compositeSrgb(foregroundHex: string, backgroundHex: string, alpha: number): string {
  const foreground = hexToRgb(foregroundHex);
  const background = hexToRgb(backgroundHex);
  const amount = Math.min(1, Math.max(0, alpha));
  return rgbToHex({
    r: foreground.r * amount + background.r * (1 - amount),
    g: foreground.g * amount + background.g * (1 - amount),
    b: foreground.b * amount + background.b * (1 - amount),
  });
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const linear = [r, g, b].map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

export function contrastRatio(leftHex: string, rightHex: string): number {
  const left = relativeLuminance(leftHex);
  const right = relativeLuminance(rightHex);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

export function ensureContrast(candidate: string, background: string, minimum: number): string {
  if (contrastRatio(candidate, background) >= minimum) return candidate;
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff';
}

export function ensureContrastAcross(
  candidate: string,
  backgrounds: string[],
  minimum: number,
): string | null {
  if (backgrounds.every(background => contrastRatio(candidate, background) >= minimum)) {
    return candidate;
  }
  const fallbacks = ['#000000', '#ffffff'] as const;
  const passing = fallbacks.filter(fallback => backgrounds.every(
    background => contrastRatio(fallback, background) >= minimum,
  ));
  if (passing.length === 0) return null;
  return passing.reduce((best, candidateFallback) => {
    const bestMinimum = Math.min(...backgrounds.map(background => contrastRatio(best, background)));
    const candidateMinimum = Math.min(...backgrounds.map(
      background => contrastRatio(candidateFallback, background),
    ));
    return candidateMinimum > bestMinimum ? candidateFallback : best;
  });
}
