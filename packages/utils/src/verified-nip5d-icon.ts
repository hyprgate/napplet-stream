export interface Nip5dIconDeclaration {
  hash: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  servers: string[];
}

export function isValidBlossomOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
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
  if (!/^[0-9a-f]{64}$/.test(icon.hash) || !['image/png', 'image/jpeg', 'image/webp'].includes(icon.mimeType)) return null;
  for (const server of icon.servers) {
    if (!isValidBlossomOrigin(server)) continue;
    try {
      const response = await fetch(`${server.replace(/\/$/, '')}/${icon.hash}`, {
        credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_ICON_BYTES) continue;
      const bytes = await readBoundedBytes(response);
      if (!bytes?.length || !matchesImageType(bytes, icon.mimeType)) continue;
      const hashInput = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(hashInput).set(bytes);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', hashInput)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== icon.hash) continue;
      const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
      const dataUrl = `data:${icon.mimeType};base64,${base64}`;
      if (await decodesImage(dataUrl)) return dataUrl;
    } catch { /* Try the next declared server. */ }
  }
  return null;
}

async function readBoundedBytes(response: Response): Promise<Uint8Array | null> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length <= MAX_ICON_BYTES ? bytes : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ICON_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function matchesImageType(bytes: Uint8Array, mimeType: Icon['mimeType']): boolean {
  if (mimeType === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (mimeType === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

function decodesImage(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
}
