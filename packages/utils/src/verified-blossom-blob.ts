/**
 * Shared content-addressed blob loader for NIP-5D presentation media.
 *
 * NIP-5D requires clients to fetch icons, screenshots and preview videos by
 * sha256 from the manifest's declared Blossom servers and to verify the bytes
 * before rendering. This module owns the bounded fetch, the digest check and
 * the magic-number sniff; callers add format-specific decode checks.
 */

export type VerifiedBlobFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'video/webm' | 'video/mp4';

export const VERIFIED_IMAGE_FORMATS: readonly VerifiedBlobFormat[] = ['image/png', 'image/jpeg', 'image/webp'];
export const VERIFIED_VIDEO_FORMATS: readonly VerifiedBlobFormat[] = ['video/webm', 'video/mp4'];

export interface VerifiedBlobRequest {
  hash: string;
  servers: readonly string[];
  /** Declared MIME type. When absent the sniffed format is used. */
  mimeType?: string;
  /** Formats the caller can render; the sniffed format must be one of these. */
  accept: readonly VerifiedBlobFormat[];
  maxBytes: number;
}

export interface VerifiedBlob {
  bytes: Uint8Array;
  format: VerifiedBlobFormat;
}

export function isValidBlossomOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}

export function isSha256Hex(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Detect the container format from leading bytes; declared MIME types are never trusted alone. */
export function sniffBlobFormat(bytes: Uint8Array): VerifiedBlobFormat | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  if (ascii(bytes, 4, 8) === 'ftyp') return 'video/mp4';
  return null;
}

export async function fetchVerifiedBlossomBlob(request: VerifiedBlobRequest): Promise<VerifiedBlob | null> {
  if (!isSha256Hex(request.hash)) return null;
  if (request.mimeType && !request.accept.includes(request.mimeType as VerifiedBlobFormat)) return null;
  for (const server of request.servers) {
    if (!isValidBlossomOrigin(server)) continue;
    try {
      const response = await fetch(`${server.replace(/\/$/, '')}/${request.hash}`, {
        credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > request.maxBytes) continue;
      const bytes = await readBoundedBytes(response, request.maxBytes);
      if (!bytes?.length) continue;
      const format = sniffBlobFormat(bytes);
      if (!format || !request.accept.includes(format)) continue;
      if (request.mimeType && request.mimeType !== format) continue;
      if (await sha256Hex(bytes) !== request.hash) continue;
      return { bytes, format };
    } catch { /* Try the next declared server. */ }
  }
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function bytesToDataUrl(bytes: Uint8Array, format: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${format};base64,${btoa(binary)}`;
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length <= maxBytes ? bytes : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
