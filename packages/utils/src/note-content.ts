import { nip19 } from 'nostr-tools';

export type NoteContentBlock =
  | { type: 'text'; value: string }
  | { type: 'hashtag'; value: string; source: string }
  | { type: 'url'; value: string; source: string }
  | { type: 'emoji'; value: string; source: string; imageUrl: string; address?: string }
  | { type: 'profile'; value: string; source: string }
  | { type: 'event'; value: string; source: string }
  | { type: 'address'; value: string; source: string }
  | { type: 'media'; value: string; mediaType: 'image' | 'video'; source: string }
  | { type: 'resource'; value: string; mediaType: 'image'; source: string };

export type NoteContentEmbed = Exclude<NoteContentBlock, { type: 'text' | 'hashtag' | 'url' | 'emoji' }>;

export interface CustomEmojiResource {
  shortcode: string;
  imageUrl: string;
  address?: string;
  tag: string[];
}

export type CustomEmojiReaction = Pick<CustomEmojiResource, 'shortcode'> & Partial<Pick<CustomEmojiResource, 'imageUrl' | 'address'>>;

export interface ParseNoteContentOptions {
  emojiTags?: readonly (readonly string[])[];
}

export interface ExtractNoteContentEmbedsOptions {
  includeProfiles?: boolean;
  includeEvents?: boolean;
  includeAddresses?: boolean;
  includeImageUrls?: boolean;
  includeVideoUrls?: boolean;
  includeResources?: boolean;
}

interface NoteContentCandidate {
  start: number;
  end: number;
  block: Exclude<NoteContentBlock, { type: 'text' }>;
}

const NIP19_RE = /\b(?:nostr:)?((?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+)\b/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const BLOSSOM_RE = /\bblossom:sha256:[0-9a-f]{64}\b/gi;
const HASHTAG_RE = /(^|[\s([{])#([A-Za-z0-9_]+)\b/g;
const CUSTOM_EMOJI_TOKEN_RE = /:([A-Za-z0-9_-]+):/g;
const CUSTOM_EMOJI_SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i;
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v)(?:[?#].*)?$/i;

export type ExternalVideoProvider = 'youtube' | 'vimeo' | 'rumble';

export interface ExternalVideoEmbed {
  provider: ExternalVideoProvider;
  embedUrl: string;
  thumbnailUrl?: string;
}

export function parseNoteContent(content: string, options: ParseNoteContentOptions = {}): NoteContentBlock[] {
  const candidates = collectCandidates(content, options);
  const blocks: NoteContentBlock[] = [];
  let cursor = 0;

  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    if (candidate.start > cursor) {
      blocks.push({ type: 'text', value: content.slice(cursor, candidate.start) });
    }
    blocks.push(candidate.block);
    cursor = candidate.end;
  }

  if (cursor < content.length) {
    blocks.push({ type: 'text', value: content.slice(cursor) });
  }

  return blocks;
}

export function parseCustomEmojiTags(tags: readonly (readonly string[])[]): CustomEmojiResource[] {
  const emojis: CustomEmojiResource[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    if (tag[0] !== 'emoji') continue;
    const shortcode = tag[1];
    const imageUrl = tag[2];
    if (
      typeof shortcode !== 'string'
      || typeof imageUrl !== 'string'
      || !CUSTOM_EMOJI_SHORTCODE_RE.test(shortcode)
      || !isImageResourcePointer(imageUrl)
      || seen.has(shortcode)
    ) {
      continue;
    }
    seen.add(shortcode);
    const address = tag[3];
    emojis.push({
      shortcode,
      imageUrl,
      ...(typeof address === 'string' && address.length > 0 ? { address } : {}),
      tag: [...tag],
    });
  }

  return emojis;
}

export function customEmojiForShortcodeContent(
  content: string,
  tags: readonly (readonly string[])[],
): CustomEmojiReaction | null {
  const shortcode = /^:([A-Za-z0-9_-]+):$/.exec(content.trim())?.[1];
  if (!shortcode) return null;
  const emoji = parseCustomEmojiTags(tags).find((item) => item.shortcode === shortcode);
  return {
    shortcode,
    ...(emoji?.imageUrl ? { imageUrl: emoji.imageUrl } : {}),
    ...(emoji?.address ? { address: emoji.address } : {}),
  };
}

export function extractNoteContentEmbeds(
  content: string,
  limit = 6,
  options: ExtractNoteContentEmbedsOptions = {},
): NoteContentEmbed[] {
  const includeProfiles = options.includeProfiles ?? true;
  const includeEvents = options.includeEvents ?? true;
  const includeAddresses = options.includeAddresses ?? true;
  const includeImageUrls = options.includeImageUrls ?? true;
  const includeVideoUrls = options.includeVideoUrls ?? true;
  const includeResources = options.includeResources ?? true;
  const embeds: NoteContentEmbed[] = [];
  const seen = new Set<string>();

  function shouldInclude(block: NoteContentEmbed): boolean {
    if (block.type === 'profile') return includeProfiles;
    if (block.type === 'event') return includeEvents;
    if (block.type === 'address') return includeAddresses;
    if (block.type === 'resource') return includeResources;
    if (block.type === 'media' && block.mediaType === 'image') return includeImageUrls;
    if (block.type === 'media' && block.mediaType === 'video') return includeVideoUrls;
    return false;
  }

  for (const block of parseNoteContent(content)) {
    if (block.type === 'text' || block.type === 'hashtag' || block.type === 'url' || block.type === 'emoji') continue;
    if (!shouldInclude(block)) continue;
    const key = `${block.type}:${block.value}`;
    if (seen.has(key) || embeds.length >= limit) continue;
    seen.add(key);
    embeds.push(block);
  }

  return embeds;
}

function collectCandidates(content: string, options: ParseNoteContentOptions): NoteContentCandidate[] {
  const candidates: NoteContentCandidate[] = [];
  const customEmojis = new Map(parseCustomEmojiTags(options.emojiTags ?? []).map((emoji) => [emoji.shortcode, emoji]));

  if (customEmojis.size > 0) {
    for (const match of content.matchAll(CUSTOM_EMOJI_TOKEN_RE)) {
      const shortcode = match[1];
      if (!shortcode) continue;
      const emoji = customEmojis.get(shortcode);
      if (!emoji) continue;
      const source = match[0]!;
      const start = match.index ?? 0;
      candidates.push({
        start,
        end: start + source.length,
        block: {
          type: 'emoji',
          value: shortcode,
          source,
          imageUrl: emoji.imageUrl,
          ...(emoji.address ? { address: emoji.address } : {}),
        },
      });
    }
  }

  for (const match of content.matchAll(NIP19_RE)) {
    const encoded = match[1];
    if (!encoded) continue;
    const source = match[0]!.startsWith('nostr:') ? match[0]! : `nostr:${encoded}`;
    const block = decodeNip19Block(encoded, source);
    if (block) {
      const start = match.index ?? 0;
      candidates.push({ start, end: start + match[0]!.length, block });
    }
  }

  for (const match of content.matchAll(URL_RE)) {
    const raw = match[0]!;
    const value = trimTrailingPunctuation(raw);
    const start = match.index ?? 0;
    const block = mediaBlockForUrl(value) ?? { type: 'url' as const, value, source: value };
    candidates.push({ start, end: start + value.length, block });
  }

  for (const match of content.matchAll(BLOSSOM_RE)) {
    const value = match[0]!.toLowerCase();
    const start = match.index ?? 0;
    candidates.push({ start, end: start + match[0]!.length, block: { type: 'resource', mediaType: 'image', value, source: value } });
  }

  for (const match of content.matchAll(HASHTAG_RE)) {
    const prefix = match[1] ?? '';
    const tag = match[2];
    if (!tag) continue;
    const start = (match.index ?? 0) + prefix.length;
    const source = `#${tag}`;
    candidates.push({ start, end: start + source.length, block: { type: 'hashtag', value: tag, source } });
  }

  return candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
}

function decodeNip19Block(encoded: string, source: string): NoteContentCandidate['block'] | null {
  try {
    const decoded = nip19.decode(encoded);
    if (decoded.type === 'npub') return { type: 'profile', value: decoded.data, source };
    if (decoded.type === 'note') return { type: 'event', value: decoded.data, source };
    if (decoded.type === 'nprofile') {
      const data = decoded.data as { pubkey?: string };
      return data.pubkey ? { type: 'profile', value: data.pubkey, source } : null;
    }
    if (decoded.type === 'nevent') {
      const data = decoded.data as { id?: string };
      return data.id ? { type: 'event', value: data.id, source } : null;
    }
    if (decoded.type === 'naddr') {
      const data = decoded.data as { kind?: number; pubkey?: string; identifier?: string };
      if (typeof data.kind !== 'number' || !data.pubkey || !data.identifier) return null;
      return { type: 'address', value: `${data.kind}:${data.pubkey}:${data.identifier}`, source };
    }
    return null;
  } catch {
    return null;
  }
}

function mediaBlockForUrl(value: string): NoteContentCandidate['block'] | null {
  if (IMAGE_EXT_RE.test(value)) return { type: 'media', mediaType: 'image', value, source: value };
  if (VIDEO_EXT_RE.test(value)) return { type: 'media', mediaType: 'video', value, source: value };
  if (resolveExternalVideoEmbed(value)) return { type: 'media', mediaType: 'video', value, source: value };
  return null;
}

export function resolveExternalVideoEmbed(value: string): ExternalVideoEmbed | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
  if (hostname === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id ? youtubeEmbed(id) : null;
  }
  if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
    const watchId = url.searchParams.get('v');
    const pathParts = url.pathname.split('/').filter(Boolean);
    const pathId = pathParts[0] === 'shorts' || pathParts[0] === 'embed' ? pathParts[1] : undefined;
    const id = watchId ?? pathId;
    return id ? youtubeEmbed(id) : null;
  }
  if (hostname === 'vimeo.com' || hostname === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter((part) => /^\d+$/.test(part)).at(-1);
    return id ? { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}` } : null;
  }
  if (hostname === 'rumble.com') {
    const id = url.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => part.match(/^(v[a-z0-9]+)/i)?.[1])
      .find((part): part is string => Boolean(part));
    return id ? { provider: 'rumble', embedUrl: `https://rumble.com/embed/${id}/` } : null;
  }
  return null;
}

function youtubeEmbed(id: string): ExternalVideoEmbed {
  return {
    provider: 'youtube',
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, '');
}

function isImageResourcePointer(value: string): boolean {
  if (/^blossom:sha256:[0-9a-f]{64}$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Minimal shape of a pointer-event needed to decide link interception. */
export interface LinkClickIntent {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Decide whether a click on an external-link anchor should be intercepted and
 * routed through the NAP-LINK opener (shared by NoteContent and napplet-local
 * anchors). We only intercept a plain primary-button click with no modifiers,
 * leaving middle-click, modifier-click, and already-handled events to the
 * anchor's native `href` so accessibility and "open in new tab" keep working.
 */
export function shouldInterceptLinkClick(event: LinkClickIntent): boolean {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return true;
}

export const __noteContentTest = {
  trimTrailingPunctuation,
  isImageResourcePointer,
};
