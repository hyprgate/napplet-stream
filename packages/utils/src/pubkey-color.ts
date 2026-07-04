export interface PubkeyColorOptions {
  saturation?: number;
  lightness?: number;
}

const HEX_64_RE = /^[0-9a-f]{64}$/i;
const DEFAULT_SATURATION = 72;
const DEFAULT_LIGHTNESS = 66;
const FALLBACK_COLOR = 'hsl(180 60% 68%)';

export function pubkeyReadableColor(pubkey: string, options: PubkeyColorOptions = {}): string {
  const normalized = pubkey.trim().toLowerCase();
  if (!HEX_64_RE.test(normalized)) return FALLBACK_COLOR;

  const start = normalized.slice(0, 16);
  const end = normalized.slice(-16);
  const hue = mixedPubkeyHue(start, end);
  const saturation = clamp(options.saturation ?? DEFAULT_SATURATION, 52, 82);
  const lightness = clamp(options.lightness ?? DEFAULT_LIGHTNESS, 58, 74);

  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function pubkeyColorStyle(pubkey: string): string {
  return `color: ${pubkeyReadableColor(pubkey)}`;
}

function mixedPubkeyHue(startHex: string, endHex: string): number {
  let hash = 0x811c9dc5;
  const mixed = `${startHex}${endHex}`;
  for (let i = 0; i < mixed.length; i++) {
    hash ^= mixed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
