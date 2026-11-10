import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseNip5dPresentationMedia, verifiedAppMedia, type Nip5dMediaDeclaration } from './nip5d-presentation-media.js';
import { fetchVerifiedBlossomBlob, sha256Hex, sniffBlobFormat } from './verified-blossom-blob.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('parseNip5dPresentationMedia', () => {
  it('parses NIP-92 style screenshot and preview fields and keeps tag order', () => {
    const media = parseNip5dPresentationMedia({ tags: [
      ['server', 'https://blossom.example'],
      ['server', 'https://blossom.example/path'],
      ['screenshot', `x ${HASH_B}`, 'm image/png', 'dim 1200x750', 'size 184320', 'alt The puzzle board'],
      ['screenshot', `x ${HASH_A}`, 'm image/webp'],
      ['preview', `x ${HASH_A}`, 'm video/webm', 'dim 960x600', 'duration 8.5', 'alt Building a bridge'],
    ] });
    expect(media.screenshots).toEqual([
      { kind: 'screenshot', hash: HASH_B, mimeType: 'image/png', width: 1200, height: 750, size: 184320, alt: 'The puzzle board', servers: ['https://blossom.example'] },
      { kind: 'screenshot', hash: HASH_A, mimeType: 'image/webp', servers: ['https://blossom.example'] },
    ]);
    expect(media.preview).toEqual({
      kind: 'preview', hash: HASH_A, mimeType: 'video/webm', width: 960, height: 600, duration: 8.5, alt: 'Building a bridge', servers: ['https://blossom.example'],
    });
  });

  it('ignores tags with missing, malformed or repeated x fields and unusable optional fields', () => {
    const media = parseNip5dPresentationMedia({ tags: [
      ['screenshot', 'm image/png'],
      ['screenshot', 'x nothex'],
      ['screenshot', `x ${HASH_A}`, `x ${HASH_B}`],
      ['screenshot', `x ${HASH_A}`, 'm image/png', 'm image/jpeg', 'dim wide', 'size -3', 'alt  '],
      ['screenshot', `x ${HASH_B}`, 'm image/svg+xml'],
    ] });
    expect(media.screenshots).toEqual([
      { kind: 'screenshot', hash: HASH_A, servers: [] },
      { kind: 'screenshot', hash: HASH_B, servers: [] },
    ]);
  });

  it('drops the preview when more than one preview tag is present', () => {
    const media = parseNip5dPresentationMedia({ tags: [
      ['preview', `x ${HASH_A}`, 'm video/mp4'],
      ['preview', `x ${HASH_B}`, 'm video/mp4'],
    ] });
    expect(media.preview).toBeNull();
  });

  it('does not accept image MIME types for previews', () => {
    const media = parseNip5dPresentationMedia({ tags: [['preview', `x ${HASH_A}`, 'm image/png']] });
    expect(media.preview).toEqual({ kind: 'preview', hash: HASH_A, servers: [] });
  });
});

describe('sniffBlobFormat', () => {
  it('recognizes supported image and video containers from leading bytes', () => {
    expect(sniffBlobFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]))).toBe('image/png');
    expect(sniffBlobFormat(new Uint8Array([255, 216, 255, 224]))).toBe('image/jpeg');
    expect(sniffBlobFormat(new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...[...'WEBP'].map((c) => c.charCodeAt(0))]))).toBe('image/webp');
    expect(sniffBlobFormat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe('video/webm');
    expect(sniffBlobFormat(new Uint8Array([0, 0, 0, 24, ...[...'ftypisom'].map((c) => c.charCodeAt(0))]))).toBe('video/mp4');
    expect(sniffBlobFormat(new Uint8Array([60, 115, 118, 103]))).toBeNull();
  });
});

describe('verifiedAppMedia exact declarations', () => {
  // 1x1 PNG; the decoded size is stubbed per test so dimension checks are explicit.
  const realPng = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));
  let REAL_HASH = '';
  beforeAll(async () => { REAL_HASH = await sha256Hex(realPng); });
  const exact = (overrides: Partial<Nip5dMediaDeclaration> = {}): Nip5dMediaDeclaration => ({
    kind: 'screenshot', hash: REAL_HASH, mimeType: 'image/png', width: 1200, height: 750, size: realPng.byteLength,
    servers: ['https://bad.example', 'https://good.example'], exactDeclaration: true, ...overrides,
  });
  let decodedSize = { width: 1200, height: 750 };
  let requests: string[] = [];

  beforeEach(() => {
    requests = [];
    decodedSize = { width: 1200, height: 750 };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push(url);
      if (url.startsWith('https://bad.example/')) return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), { status: 200 });
      if (url.startsWith('https://slow.example/')) {
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      return new Response(realPng.slice(), { status: 200, headers: { 'content-type': 'text/plain' } });
    }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:test-${requests.length}`) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.stubGlobal('Image', class {
      naturalWidth = 0; naturalHeight = 0; onload?: () => void; onerror?: () => void;
      set src(_value: string) { this.naturalWidth = decodedSize.width; this.naturalHeight = decodedSize.height; queueMicrotask(() => this.onload?.()); }
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('falls back from a wrong-bytes mirror to a correct one and ignores the response MIME header', async () => {
    await expect(verifiedAppMedia(exact({ alt: 'mirror-fallback' }))).resolves.toMatch(/^blob:/);
    expect(requests).toEqual([`https://bad.example/${REAL_HASH}`, `https://good.example/${REAL_HASH}`]);
  });

  it('leaves the placeholder when every mirror fails', async () => {
    await expect(verifiedAppMedia(exact({ servers: ['https://bad.example'], size: realPng.byteLength + 0 }))).resolves.toBeNull();
  });

  it('rejects bytes whose decoded dimensions differ from the declaration', async () => {
    decodedSize = { width: 800, height: 600 };
    await expect(verifiedAppMedia(exact({ servers: ['https://good.example'], width: 1200, height: 750, alt: 'dims' } as never))).resolves.toBeNull();
  });

  it('rejects a declared size that does not match the bytes before decoding', async () => {
    await expect(verifiedAppMedia(exact({ servers: ['https://good.example'], size: realPng.byteLength - 1 }))).resolves.toBeNull();
    await expect(verifiedAppMedia(exact({ servers: ['https://good.example'], size: realPng.byteLength + 1 }))).resolves.toBeNull();
  });

  it('refuses exact declarations without size and dimensions', async () => {
    await expect(verifiedAppMedia(exact({ servers: ['https://good.example'], size: undefined }))).resolves.toBeNull();
    expect(requests).toEqual([]);
  });

  it('times out a stalled mirror and continues to the next', async () => {
    await expect(fetchVerifiedBlossomBlob({
      hash: REAL_HASH, servers: ['https://slow.example', 'https://good.example'], accept: ['image/png'], maxBytes: 1_000_000, timeoutMs: 20,
    })).resolves.toMatchObject({ format: 'image/png' });
    expect(requests).toEqual([`https://slow.example/${REAL_HASH}`, `https://good.example/${REAL_HASH}`]);
  });
});
