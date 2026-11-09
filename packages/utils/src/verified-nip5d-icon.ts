import {
  bytesToDataUrl,
  fetchVerifiedBlossomBlob,
  isValidBlossomOrigin,
  VERIFIED_IMAGE_FORMATS,
} from './verified-blossom-blob.js';

export { isValidBlossomOrigin };

export interface Nip5dIconDeclaration {
  hash: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  servers: string[];
}

type Icon = Nip5dIconDeclaration;
const MAX_ICON_BYTES = 1024 * 1024;
const cache = new Map<string, Promise<string | null>>();

export function verifiedAppIcon(icon: Icon): Promise<string | null> {
  const key = `${icon.hash}:${icon.mimeType}:${icon.servers.join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = fetchVerifiedIcon(icon);
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

async function fetchVerifiedIcon(icon: Icon): Promise<string | null> {
  if (!VERIFIED_IMAGE_FORMATS.includes(icon.mimeType)) return null;
  const blob = await fetchVerifiedBlossomBlob({
    hash: icon.hash, servers: icon.servers, mimeType: icon.mimeType, accept: VERIFIED_IMAGE_FORMATS, maxBytes: MAX_ICON_BYTES,
  });
  if (!blob) return null;
  const dataUrl = bytesToDataUrl(blob.bytes, blob.format);
  return (await decodesImage(dataUrl)) ? dataUrl : null;
}

export function decodesImage(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
}
