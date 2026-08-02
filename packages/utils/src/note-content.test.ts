import * as nip19 from 'nostr-tools/nip19';
import { describe, expect, it } from 'vitest';
import {
  customEmojiForShortcodeContent,
  extractNoteContentEmbeds,
  parseCustomEmojiTags,
  parseNoteContent,
  resolveExternalVideoEmbed,
  resolveYoutubeVideo,
  shouldInterceptLinkClick,
  type LinkClickIntent,
} from './note-content.js';

const PUBKEY = 'a'.repeat(64);
const EVENT_ID = 'b'.repeat(64);
const ADDRESS_PUBKEY = 'c'.repeat(64);

describe('note content parsing', () => {
  it('parses long nostr-prefixed nprofile references without leaking raw text', () => {
    const nprofile = 'nostr:nprofile1qqsyzdg7x9nw0dkamhzvpt2gu6f4rmp52qnhrgskm0sgh2wxs0z0u8qprpmhxue69uhkummnw3ezuendwsh8w6t69e3xj730qyghwumn8ghj7mn0wd68ytnhd9hx2tcppemhxue69uhkummn9ekx7mp0lhe3m6';
    const blocks = parseNoteContent(`via ${nprofile}`);
    const profileBlock = blocks.find((block) => block.type === 'profile');

    expect(profileBlock).toMatchObject({
      type: 'profile',
      source: nprofile,
    });
    expect(blocks.some((block) => block.type === 'text' && block.value.includes(nprofile))).toBe(false);
  });

  it('parses NIP-19 profile, event, and address references', () => {
    const npub = nip19.npubEncode(PUBKEY);
    const nprofile = nip19.nprofileEncode({ pubkey: PUBKEY, relays: ['wss://relay.example'] });
    const nevent = nip19.neventEncode({ id: EVENT_ID, relays: ['wss://relay.example'] });
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: ADDRESS_PUBKEY,
      identifier: 'article',
      relays: ['wss://relay.example'],
    });

    expect(extractNoteContentEmbeds(`nostr:${npub} ${nprofile} ${nevent} ${naddr}`)).toEqual([
      { type: 'profile', value: PUBKEY, source: `nostr:${npub}` },
      { type: 'event', value: EVENT_ID, source: `nostr:${nevent}` },
      { type: 'address', value: `30023:${ADDRESS_PUBKEY}:article`, source: `nostr:${naddr}` },
    ]);

    expect(parseNoteContent(`see ${nprofile}`)).toContainEqual({
      type: 'profile',
      value: PUBKEY,
      source: `nostr:${nprofile}`,
    });
  });

  it('parses inline image URLs, video URLs, Blossom resources, links, and hashtags', () => {
    const blossom = `blossom:sha256:${'d'.repeat(64)}`;

    expect(parseNoteContent(`look #art https://example.com/a.jpg, https://example.com/v.mp4 ${blossom} https://example.com/read`)).toEqual([
      { type: 'text', value: 'look ' },
      { type: 'hashtag', value: 'art', source: '#art' },
      { type: 'text', value: ' ' },
      { type: 'media', mediaType: 'image', value: 'https://example.com/a.jpg', source: 'https://example.com/a.jpg' },
      { type: 'text', value: ', ' },
      { type: 'media', mediaType: 'video', value: 'https://example.com/v.mp4', source: 'https://example.com/v.mp4' },
      { type: 'text', value: ' ' },
      { type: 'resource', mediaType: 'image', value: blossom, source: blossom },
      { type: 'text', value: ' ' },
      { type: 'url', value: 'https://example.com/read', source: 'https://example.com/read' },
    ]);
  });

  it('emojifies NIP-30 shortcode references from event tags', () => {
    const tags = [
      ['emoji', 'blobcat', 'https://emoji.example/blobcat.png', '30030:pubkey:cats'],
      ['emoji', 'bad space', 'https://emoji.example/bad.png'],
      ['emoji', 'unsafe', 'javascript:alert(1)'],
    ];

    expect(parseCustomEmojiTags(tags)).toEqual([
      {
        shortcode: 'blobcat',
        imageUrl: 'https://emoji.example/blobcat.png',
        address: '30030:pubkey:cats',
        tag: ['emoji', 'blobcat', 'https://emoji.example/blobcat.png', '30030:pubkey:cats'],
      },
    ]);
    expect(parseNoteContent('hello :blobcat: :missing:', { emojiTags: tags })).toEqual([
      { type: 'text', value: 'hello ' },
      {
        type: 'emoji',
        value: 'blobcat',
        source: ':blobcat:',
        imageUrl: 'https://emoji.example/blobcat.png',
        address: '30030:pubkey:cats',
      },
      { type: 'text', value: ' :missing:' },
    ]);
    expect(extractNoteContentEmbeds('hello :blobcat:', 6, { includeImageUrls: true })).toEqual([]);
    expect(customEmojiForShortcodeContent(':blobcat:', tags)).toEqual({
      shortcode: 'blobcat',
      imageUrl: 'https://emoji.example/blobcat.png',
      address: '30030:pubkey:cats',
    });
    expect(customEmojiForShortcodeContent(':missing:', tags)).toEqual({ shortcode: 'missing' });
  });

  it('dedupes and limits extracted embeds', () => {
    const note = nip19.noteEncode(EVENT_ID);

    expect(extractNoteContentEmbeds(`${note} ${note} https://example.com/a.png`, 1)).toEqual([
      { type: 'event', value: EVENT_ID, source: `nostr:${note}` },
    ]);
  });

  it('recognizes third-party video provider URLs as video embeds', () => {
    const videoId = 'M7lc1UVf-VE';
    expect(parseNoteContent(`watch https://youtu.be/${videoId}`)).toContainEqual({
      type: 'media',
      mediaType: 'video',
      value: `https://youtu.be/${videoId}`,
      source: `https://youtu.be/${videoId}`,
    });
    expect(extractNoteContentEmbeds('https://vimeo.com/123456 https://rumble.com/vabcde-title.html')).toEqual([
      { type: 'media', mediaType: 'video', value: 'https://vimeo.com/123456', source: 'https://vimeo.com/123456' },
      { type: 'media', mediaType: 'video', value: 'https://rumble.com/vabcde-title.html', source: 'https://rumble.com/vabcde-title.html' },
    ]);
    expect(resolveExternalVideoEmbed(`https://www.youtube.com/watch?v=${videoId}`)).toEqual({
      provider: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
    expect(resolveExternalVideoEmbed('https://rumble.com/vabcde-title.html')).toEqual({
      provider: 'rumble',
      embedUrl: 'https://rumble.com/embed/vabcde/',
    });
  });

  it('recognizes only validated single-video YouTube URLs and preserves valid offsets', () => {
    const videoId = 'M7lc1UVf-VE';
    const accepted = [
      [`https://youtu.be/${videoId}`, null],
      [`https://www.youtube.com/watch?v=${videoId}`, null],
      [`https://m.youtube.com/watch?v=${videoId}&list=ignored`, null],
      [`https://youtube.com/shorts/${videoId}?t=1m30s`, 90],
      [`https://www.youtube.com/embed/${videoId}?start=42`, 42],
      [`https://youtu.be/${videoId}#t=2m`, 120],
      [`https://youtube.com/watch?v=${videoId}&t=90&start=12`, 12],
    ] as const;

    for (const [url, startSeconds] of accepted) {
      expect(resolveYoutubeVideo(url)).toMatchObject({ videoId, startSeconds });
    }

    expect(resolveExternalVideoEmbed(`https://youtube.com/watch?v=${videoId}&t=15`)).toEqual({
      provider: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?start=15`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  });

  it('keeps malformed, lookalike, and non-video YouTube URLs out of the player classifier', () => {
    const videoId = 'M7lc1UVf-VE';
    const rejected = [
      `http://youtu.be/${videoId}`,
      `https://youtu.be/${videoId}/extra`,
      'https://youtube.com/watch?v=too-short',
      `https://youtube.com/channel/${videoId}`,
      'https://youtube.com/results?search_query=video',
      `https://youtube.com/playlist?list=PL${videoId}`,
      `https://youtube.com/clip/${videoId}`,
      `https://youtube.com/live/${videoId}`,
      `https://music.youtube.com/watch?v=${videoId}`,
      `https://youtube.com:444/watch?v=${videoId}`,
      `https://youtube.com.evil.example/watch?v=${videoId}`,
      `https://notyoutube.com/watch?v=${videoId}`,
      `https://youtube.com/other?v=${videoId}`,
    ];

    for (const url of rejected) expect(resolveYoutubeVideo(url)).toBeNull();
  });

  it('can skip inline image URLs and Blossom resources when extracting secondary embeds', () => {
    const blossom = `blossom:sha256:${'e'.repeat(64)}`;

    expect(extractNoteContentEmbeds(
      `look https://example.com/a.png ${blossom} https://example.com/v.mp4`,
      6,
      { includeImageUrls: false, includeResources: false },
    )).toEqual([
      { type: 'media', mediaType: 'video', value: 'https://example.com/v.mp4', source: 'https://example.com/v.mp4' },
    ]);
  });
});

describe('shouldInterceptLinkClick (NAP-LINK routing)', () => {
  const base: LinkClickIntent = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };

  it('intercepts a plain primary-button click', () => {
    expect(shouldInterceptLinkClick(base)).toBe(true);
  });

  it('does not intercept an already-handled event', () => {
    expect(shouldInterceptLinkClick({ ...base, defaultPrevented: true })).toBe(false);
  });

  it('does not intercept a middle-click (button 1)', () => {
    expect(shouldInterceptLinkClick({ ...base, button: 1 })).toBe(false);
  });

  it('does not intercept modifier-clicks (open-in-new-tab)', () => {
    expect(shouldInterceptLinkClick({ ...base, metaKey: true })).toBe(false);
    expect(shouldInterceptLinkClick({ ...base, ctrlKey: true })).toBe(false);
    expect(shouldInterceptLinkClick({ ...base, shiftKey: true })).toBe(false);
    expect(shouldInterceptLinkClick({ ...base, altKey: true })).toBe(false);
  });
});
