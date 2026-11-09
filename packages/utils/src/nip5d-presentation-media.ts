import type { NostrEvent } from '@hyprgate/types';
import {
  fetchVerifiedBlossomBlob,
  isSha256Hex,
  isValidBlossomOrigin,
  VERIFIED_IMAGE_FORMATS,
  VERIFIED_VIDEO_FORMATS,
  type VerifiedBlobFormat,
} from './verified-blossom-blob.js';
import { decodesImage } from './verified-nip5d-icon.js';

/**
 * NIP-5D presentation media: `screenshot` and `preview` manifest tags carry
 * NIP-92 style `key value` fields describing one content-addressed blob.
 * Exactly one `x` field is required; `m`, `dim`, `size`, `alt` and (video)
 * `duration` are optional. Tags with missing, malformed or repeated `x`
 * fields are ignored; repeated optional fields are dropped.
 */
export interface Nip5dMediaDeclaration {
  kind: 'screenshot' | 'preview';
  hash: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  alt?: string;
  duration?: number;
  servers: string[];
}

export interface Nip5dPresentationMedia {
  screenshots: Nip5dMediaDeclaration[];
  preview: Nip5dMediaDeclaration | null;
}

const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 48 * 1024 * 1024;

export function nip5dBlossomServers(event: Pick<NostrEvent, 'tags'>): string[] {
  return [...new Set(event.tags
    .filter((tag) => tag[0] === 'server' && tag.length === 2)
    .map((tag) => tag[1]!)
    .filter(isValidBlossomOrigin))];
}

export function parseNip5dPresentationMedia(event: Pick<NostrEvent, 'tags'>): Nip5dPresentationMedia {
  const servers = nip5dBlossomServers(event);
  const screenshots = event.tags
    .filter((tag) => tag[0] === 'screenshot')
    .map((tag) => parseMediaTag('screenshot', tag, servers))
    .filter((media): media is Nip5dMediaDeclaration => media !== null);
  const previewTags = event.tags.filter((tag) => tag[0] === 'preview');
  const preview = previewTags.length === 1 ? parseMediaTag('preview', previewTags[0]!, servers) : null;
  return { screenshots, preview };
}

function parseMediaTag(kind: Nip5dMediaDeclaration['kind'], tag: string[], servers: string[]): Nip5dMediaDeclaration | null {
  const seen = new Map<string, number>();
  const fields = new Map<string, string>();
  for (const field of tag.slice(1)) {
    const index = field.indexOf(' ');
    if (index <= 0) continue;
    const key = field.slice(0, index);
    const value = field.slice(index + 1);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    fields.set(key, value);
  }
  const hash = fields.get('x');
  if (seen.get('x') !== 1 || !isSha256Hex(hash)) return null;
  const single = (key: string): string | undefined => (seen.get(key) === 1 ? fields.get(key) : undefined);
  const mimeType = single('m');
  const acceptedTypes = kind === 'preview' ? VERIFIED_VIDEO_FORMATS : VERIFIED_IMAGE_FORMATS;
  const dim = single('dim')?.match(/^(\d{1,5})x(\d{1,5})$/);
  const size = Number(single('size'));
  const duration = Number(single('duration'));
  const alt = single('alt')?.trim();
  return {
    kind,
    hash,
    ...(mimeType && acceptedTypes.includes(mimeType as VerifiedBlobFormat) ? { mimeType } : {}),
    ...(dim ? { width: Number(dim[1]), height: Number(dim[2]) } : {}),
    ...(Number.isInteger(size) && size > 0 ? { size } : {}),
    ...(alt ? { alt: alt.slice(0, 280) } : {}),
    ...(kind === 'preview' && Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    servers,
  };
}

const cache = new Map<string, Promise<string | null>>();

/**
 * Resolve a declared screenshot or preview to a renderable object URL. Bytes are
 * fetched from the declared Blossom servers, hash-verified, sniffed and decoded
 * before the URL is returned. Unusable media resolves to null and must not block
 * other media or app discovery.
 */
export function verifiedAppMedia(media: Nip5dMediaDeclaration): Promise<string | null> {
  const key = `${media.kind}:${media.hash}:${media.mimeType ?? ''}:${media.servers.join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = fetchVerifiedMedia(media);
  if (cache.size >= 96) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

async function fetchVerifiedMedia(media: Nip5dMediaDeclaration): Promise<string | null> {
  const video = media.kind === 'preview';
  const blob = await fetchVerifiedBlossomBlob({
    hash: media.hash,
    servers: media.servers,
    ...(media.mimeType ? { mimeType: media.mimeType } : {}),
    accept: video ? VERIFIED_VIDEO_FORMATS : VERIFIED_IMAGE_FORMATS,
    maxBytes: video ? MAX_PREVIEW_BYTES : MAX_SCREENSHOT_BYTES,
  });
  if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const buffer = new ArrayBuffer(blob.bytes.byteLength);
  new Uint8Array(buffer).set(blob.bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: blob.format }));
  const decodes = video ? await decodesVideo(url) : await decodesImage(url);
  if (decodes) return url;
  URL.revokeObjectURL(url);
  return null;
}

function decodesVideo(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(true); return; }
    const video = document.createElement('video');
    const finish = (value: boolean): void => { video.removeAttribute('src'); resolve(value); };
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(video.videoWidth > 0 && video.videoHeight > 0);
    video.onerror = () => finish(false);
    video.src = url;
  });
}
