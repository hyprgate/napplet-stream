import { describe, expect, it } from 'vitest';
import { parseNip5dPresentationMedia } from './nip5d-presentation-media.js';
import { sniffBlobFormat } from './verified-blossom-blob.js';

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
