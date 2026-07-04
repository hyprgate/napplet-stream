import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMentionReference,
  buildHashtagTags,
  buildComposePublishTags,
  clearComposeDraft,
  COMPOSER_CLIENT_TAG,
  createTextNoteTemplate,
  decodeMentionProfilePubkey,
  detectMentionQuery,
  extractComposeHashtags,
  insertMentionText,
  buildImetaTag,
  appendMediaUrls,
  buildAttachmentPlaceholder,
  replaceAttachmentPlaceholders,
  loadComposeDraft,
  parseNip65RelayHints,
  parseComposeReplyParams,
  previewComposeReplyContent,
  publishTextNote,
  saveComposeDraft,
  serializeSelectedMentions,
  type SelectedMention,
} from './composer';
import { relay, storage } from '@napplet/sdk';
import { nip19 } from 'nostr-tools';

vi.mock('@napplet/sdk', () => ({
  relay: {
    publish: vi.fn().mockResolvedValue({ id: 'note' }),
  },
  storage: {
    getItem: vi.fn().mockResolvedValue(''),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('composer utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts unique lowercase hashtags', () => {
    expect(extractComposeHashtags('hello #Nostr #nostr #zaps')).toEqual(['nostr', 'zaps']);
    expect(buildHashtagTags('hello #Nostr')).toEqual([['t', 'nostr']]);
  });

  it('adds the hyprgate composer client tag to publish tags', () => {
    expect(buildComposePublishTags('hello', null)).toEqual([
      [...COMPOSER_CLIENT_TAG],
    ]);
  });

  it('creates text note templates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T00:00:00Z'));
    try {
      expect(createTextNoteTemplate('hello', [['t', 'nostr']])).toEqual({
        kind: 1,
        content: 'hello',
        tags: [['t', 'nostr']],
        created_at: 1780531200,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes text notes through SDK relay', async () => {
    await publishTextNote('hello', [['t', 'nostr']]);
    expect(vi.mocked(relay.publish)).toHaveBeenCalledWith(expect.objectContaining({
      kind: 1,
      content: 'hello',
      tags: [['t', 'nostr']],
    }));
  });

  it('parses compose reply params and builds reply publish tags', () => {
    const id = 'b'.repeat(64);
    const pubkey = 'a'.repeat(64);
    expect(parseComposeReplyParams(`?replyId=${id}&replyPubkey=${pubkey}&replyKind=1`)).toEqual({
      id,
      pubkey,
      kind: 1,
    });
    expect(buildComposePublishTags('hello #Nostr', { id, pubkey, kind: 1 })).toEqual([
      ['e', id, '', 'root'],
      ['p', pubkey],
      ['t', 'nostr'],
      [...COMPOSER_CLIENT_TAG],
    ]);
  });

  it('previews reply content with feed-like line and length bounds', () => {
    const content = [
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
    ].join('\n');

    expect(previewComposeReplyContent(content, 100, 4)).toBe('line 1\nline 2\nline 3\nline 4...');
    expect(previewComposeReplyContent('short note', 100, 4)).toBe('short note');
  });

  it('detects and inserts mention text', () => {
    expect(detectMentionQuery('hello @al', 9)).toEqual({ start: 6, query: 'al' });
    expect(detectMentionQuery('hello @al later', 15)).toBeNull();
    expect(insertMentionText('hello @al', 9, 6, 'nostr:npub1abc')).toBe('hello nostr:npub1abc ');
  });

  it('builds selected mention references with nprofile relay hints when NIP-65 relays exist', () => {
    const pubkey = 'a'.repeat(64);
    const reference = buildMentionReference(pubkey, ['wss://relay.example', 'wss://relay2.example']);
    const encoded = reference.replace(/^nostr:/, '');

    expect(reference.startsWith('nostr:nprofile1')).toBe(true);
    expect(nip19.decode(encoded)).toEqual({
      type: 'nprofile',
      data: {
        pubkey,
        relays: ['wss://relay.example', 'wss://relay2.example'],
      },
    });
  });

  it('falls back to nostr:npub references when no NIP-65 relay hints are available', () => {
    const pubkey = 'b'.repeat(64);

    expect(buildMentionReference(pubkey, [])).toBe(`nostr:${nip19.npubEncode(pubkey)}`);
  });

  it('decodes direct mention profile references from npub, nprofile, and hex input', () => {
    const pubkey = 'd'.repeat(64);
    const nprofile = nip19.nprofileEncode({ pubkey, relays: ['wss://relay.example'] });

    expect(decodeMentionProfilePubkey(nip19.npubEncode(pubkey))).toBe(pubkey);
    expect(decodeMentionProfilePubkey(`nostr:${nprofile}`)).toBe(pubkey);
    expect(decodeMentionProfilePubkey(`@${pubkey.toUpperCase()}`)).toBe(pubkey);
    expect(decodeMentionProfilePubkey('alice')).toBeNull();
  });

  it('parses NIP-65 kind-10002 relay hints and ignores invalid relay tags', () => {
    expect(parseNip65RelayHints({
      kind: 10002,
      tags: [
        ['r', 'wss://write.example', 'write'],
        ['r', 'wss://read.example', 'read'],
        ['r', 'wss://both.example'],
        ['r', 'http://not-allowed.example'],
        ['p', 'not-a-relay'],
      ],
    })).toEqual(['wss://write.example', 'wss://read.example', 'wss://both.example']);
  });

  it('serializes selected visible @mentions to nostr references for publishing', () => {
    const pubkey = 'c'.repeat(64);
    const mentions: SelectedMention[] = [{
      start: 6,
      end: 12,
      display: 'Alice',
      pubkey,
      relays: ['wss://relay.example'],
    }];

    expect(serializeSelectedMentions('hello @Alice', mentions)).toBe(
      `hello ${buildMentionReference(pubkey, ['wss://relay.example'])}`,
    );
    expect(serializeSelectedMentions('hello @Bob', mentions)).toBe('hello @Bob');
  });

  it('builds an imeta tag folding in nip94 tags and known fields', () => {
    const tag = buildImetaTag({
      url: 'https://blossom.example/abc.png',
      mimeType: 'image/png',
      sha256: 'a'.repeat(64),
      dimensions: { width: 640, height: 480 },
      blurhash: 'LKO2',
      caption: 'a diagram',
      nip94: [
        ['url', 'https://blossom.example/abc.png'],
        ['m', 'image/png'],
        ['x', 'a'.repeat(64)],
        ['size', '2048'],
      ],
    });
    expect(tag).toEqual([
      'imeta',
      'url https://blossom.example/abc.png',
      'm image/png',
      `x ${'a'.repeat(64)}`,
      'size 2048',
      'dim 640x480',
      'blurhash LKO2',
      'alt a diagram',
    ]);
  });

  it('builds a minimal imeta tag from url and mime alone', () => {
    expect(buildImetaTag({ url: 'https://blossom.example/x.bin', mimeType: 'application/octet-stream' })).toEqual([
      'imeta',
      'url https://blossom.example/x.bin',
      'm application/octet-stream',
    ]);
  });

  it('appends media urls after content, skipping duplicates', () => {
    expect(appendMediaUrls('hello', ['https://x/1.png', 'https://x/2.png'])).toBe(
      'hello\n\nhttps://x/1.png\nhttps://x/2.png',
    );
    expect(appendMediaUrls('', ['https://x/1.png'])).toBe('https://x/1.png');
    expect(appendMediaUrls('see https://x/1.png', ['https://x/1.png'])).toBe('see https://x/1.png');
  });

  it('builds obvious, unique inline placeholders', () => {
    expect(buildAttachmentPlaceholder('photo.png', '')).toBe('[📎 photo.png]');
    expect(buildAttachmentPlaceholder('', 'hello')).toBe('[📎 file]');
    // A same-named file already staged gets a distinct token.
    const first = buildAttachmentPlaceholder('a.png', 'note [📎 a.png] here');
    expect(first).toBe('[📎 a.png (2)]');
    expect(buildAttachmentPlaceholder('a.png', 'note [📎 a.png] and [📎 a.png (2)]')).toBe('[📎 a.png (3)]');
  });

  it('replaces inline placeholders with uploaded urls in place', () => {
    const content = 'before [📎 a.png] middle [📎 b.png] after';
    expect(
      replaceAttachmentPlaceholders(content, [
        { placeholder: '[📎 a.png]', url: 'https://x/a.png' },
        { placeholder: '[📎 b.png]', url: 'https://x/b.png' },
      ]),
    ).toBe('before https://x/a.png middle https://x/b.png after');
  });

  it('appends the url when a placeholder was deleted from the content', () => {
    expect(
      replaceAttachmentPlaceholders('user removed the token', [
        { placeholder: '[📎 gone.png]', url: 'https://x/gone.png' },
      ]),
    ).toBe('user removed the token\n\nhttps://x/gone.png');
  });

  it('persists drafts through SDK storage', async () => {
    vi.mocked(storage.getItem).mockResolvedValueOnce('draft');
    await expect(loadComposeDraft()).resolves.toBe('draft');
    await saveComposeDraft('draft');
    expect(storage.setItem).toHaveBeenCalledWith('compose:draft', 'draft');
    await saveComposeDraft(' ');
    expect(storage.removeItem).toHaveBeenCalledWith('compose:draft');
    await clearComposeDraft();
    expect(storage.removeItem).toHaveBeenCalledWith('compose:draft');
  });
});
