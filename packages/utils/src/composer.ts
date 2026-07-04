import { relay, storage } from '@napplet/sdk';
import { nip19 } from 'nostr-tools';
import { createKind1ReplyTags, KIND_TEXT_NOTE } from './note-viewer-protocol.js';

export const COMPOSER_DRAFT_KEY = 'compose:draft' as const;
export const COMPOSER_CLIENT_TAG = ['client', '@hyprgate/composer'] as const;
export const COMPOSER_OPEN_TOPIC = 'compose:open' as const;
export const COMPOSER_READY_TOPIC = 'compose:ready' as const;

export interface TextNoteTemplate {
  kind: 1;
  content: string;
  tags: string[][];
  created_at: number;
}

export interface MentionQuery {
  start: number;
  query: string;
}

export interface SelectedMention {
  start: number;
  end: number;
  display: string;
  pubkey: string;
  relays: string[];
}

export interface RelayListLike {
  kind?: number;
  tags?: string[][];
}

export interface ComposeReplyContext {
  id: string;
  pubkey: string;
  kind: number;
  content?: string;
  created_at?: number;
}

export function extractComposeHashtags(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(/#(\w+)/g)) {
    const tag = match[1]?.toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

export function createTextNoteTemplate(content: string, tags: string[][] = []): TextNoteTemplate {
  return {
    kind: 1,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };
}

export async function publishTextNote(content: string, tags: string[][] = []): Promise<object> {
  return relay.publish(createTextNoteTemplate(content, tags));
}

export function buildHashtagTags(content: string): string[][] {
  return extractComposeHashtags(content).map((tag) => ['t', tag]);
}

export function parseComposeReplyParams(search: string): ComposeReplyContext | null {
  const params = new URLSearchParams(search);
  const id = params.get('replyId');
  const pubkey = params.get('replyPubkey');
  const kind = Number(params.get('replyKind') ?? KIND_TEXT_NOTE);
  if (!id || !pubkey || !Number.isInteger(kind)) return null;
  return { id, pubkey, kind };
}

export function previewComposeReplyContent(content: string, maxChars = 280, maxLines = 4): string {
  if (content.length <= maxChars && content.split(/\r\n|\r|\n/).length <= maxLines) return content;
  const lines = content.split(/\r\n|\r|\n/);
  const lineBounded = lines.slice(0, maxLines).join('\n');
  const bounded = lineBounded.length > maxChars ? lineBounded.slice(0, maxChars) : lineBounded;
  return `${bounded.trimEnd()}...`;
}

export function buildComposePublishTags(content: string, replyContext: ComposeReplyContext | null): string[][] {
  return [
    ...(replyContext && replyContext.kind === KIND_TEXT_NOTE ? createKind1ReplyTags({ root: replyContext }) : []),
    ...buildHashtagTags(content),
    [...COMPOSER_CLIENT_TAG],
  ];
}

/**
 * A file that has been uploaded through NAP-UPLOAD and is ready to attach to a
 * note. Shaped from the shell's `UploadResult` — the composer only keeps the
 * fields it needs to render an `imeta` tag and reference the media in content.
 */
export interface UploadedMedia {
  url: string;
  mimeType?: string;
  sha256?: string;
  dimensions?: { width: number; height: number };
  blurhash?: string;
  caption?: string;
  /** Ready-to-attach NIP-94 tags the shell returned (e.g. [['url', u], ['m', mime]]). */
  nip94?: string[][];
}

/**
 * Build a single NIP-92 `imeta` tag for an uploaded file. Values are
 * space-separated `key value` strings. Folds in any shell-provided NIP-94 tags
 * and adds `dim`/`blurhash`/`alt` when the fields are known. Keys are deduped,
 * first-writer-wins, with `url` always first.
 */
export function buildImetaTag(media: UploadedMedia): string[] {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (key: string, value: string | undefined | null): void => {
    if (!value || seen.has(key)) return;
    seen.add(key);
    parts.push(`${key} ${value}`);
  };

  push('url', media.url);
  for (const tag of media.nip94 ?? []) {
    const [key, ...rest] = tag;
    if (!key || rest.length === 0) continue;
    push(key, rest.join(' '));
  }
  push('m', media.mimeType);
  push('x', media.sha256);
  if (media.dimensions) push('dim', `${media.dimensions.width}x${media.dimensions.height}`);
  push('blurhash', media.blurhash);
  push('alt', media.caption);

  return ['imeta', ...parts];
}

/**
 * Append media URLs to note content so clients render the attachments. Each URL
 * goes on its own line after the text, skipping any already present verbatim.
 * Used as a fallback when an inline placeholder can no longer be located.
 */
export function appendMediaUrls(content: string, urls: string[]): string {
  const fresh = urls.filter((url) => url && !content.includes(url));
  if (fresh.length === 0) return content;
  const base = content.trimEnd();
  return base.length > 0 ? `${base}\n\n${fresh.join('\n')}` : fresh.join('\n');
}

/** A staged attachment's inline placeholder token paired with its uploaded URL. */
export interface AttachmentPlaceholder {
  placeholder: string;
  url: string;
}

/**
 * Build an obvious, unique inline placeholder token for a staged attachment,
 * e.g. `[📎 photo.png]`. Uniqueness is enforced against the current content so
 * two files with the same name get distinct tokens the composer can later
 * replace independently.
 */
export function buildAttachmentPlaceholder(name: string, existing: string): string {
  const label = name.trim() || 'file';
  const base = `[📎 ${label}]`;
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`[📎 ${label} (${n})]`)) n += 1;
  return `[📎 ${label} (${n})]`;
}

/**
 * Replace each inline attachment placeholder with its uploaded URL, in place.
 * A placeholder the user has since deleted falls back to being appended so the
 * media is never silently dropped from a published note.
 */
export function replaceAttachmentPlaceholders(content: string, items: AttachmentPlaceholder[]): string {
  let out = content;
  const missing: string[] = [];
  for (const item of items) {
    if (!item.url) continue;
    if (item.placeholder && out.includes(item.placeholder)) {
      out = out.split(item.placeholder).join(item.url);
    } else {
      missing.push(item.url);
    }
  }
  return missing.length > 0 ? appendMediaUrls(out, missing) : out;
}

export function detectMentionQuery(text: string, cursorPos: number): MentionQuery | null {
  const textBefore = text.slice(0, cursorPos);
  const match = textBefore.match(/@(\w*)$/);
  if (!match) return null;
  return {
    start: cursorPos - match[0]!.length,
    query: match[1]!,
  };
}

export function insertMentionText(content: string, cursorPos: number, mentionStart: number, mention: string): string {
  const before = content.slice(0, mentionStart);
  const after = content.slice(cursorPos);
  return `${before}${mention} ${after}`;
}

export function buildMentionReference(pubkey: string, relays: string[] = []): string {
  const usableRelays = [...new Set(relays.map((relayUrl) => relayUrl.trim()).filter((relayUrl) => relayUrl.startsWith('wss://')))];
  if (usableRelays.length > 0) {
    return `nostr:${nip19.nprofileEncode({ pubkey, relays: usableRelays })}`;
  }
  return `nostr:${nip19.npubEncode(pubkey)}`;
}

export function decodeMentionProfilePubkey(rawQuery: string): string | null {
  const query = rawQuery.trim().replace(/^@/, '').replace(/^nostr:/i, '');
  if (/^[0-9a-f]{64}$/i.test(query)) return query.toLowerCase();
  if (!/^(npub|nprofile)1/i.test(query)) return null;

  try {
    const decoded = nip19.decode(query);
    if (decoded.type === 'npub' && typeof decoded.data === 'string') return decoded.data;
    if (
      decoded.type === 'nprofile'
      && decoded.data
      && typeof decoded.data === 'object'
      && typeof decoded.data.pubkey === 'string'
    ) {
      return decoded.data.pubkey;
    }
  } catch {
    return null;
  }

  return null;
}

export function parseNip65RelayHints(event: RelayListLike | null | undefined): string[] {
  if (!event || event.kind !== 10002 || !Array.isArray(event.tags)) return [];
  const relays = event.tags
    .filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string')
    .map((tag) => tag[1]!.trim())
    .filter((relayUrl) => relayUrl.startsWith('wss://'));
  return [...new Set(relays)];
}

export function serializeSelectedMentions(content: string, mentions: SelectedMention[]): string {
  return [...mentions]
    .sort((a, b) => b.start - a.start)
    .reduce((nextContent, mention) => {
      const token = `@${mention.display}`;
      if (nextContent.slice(mention.start, mention.end) !== token) return nextContent;
      return `${nextContent.slice(0, mention.start)}${buildMentionReference(mention.pubkey, mention.relays)}${nextContent.slice(mention.end)}`;
    }, content);
}

export async function loadComposeDraft(key = COMPOSER_DRAFT_KEY): Promise<string> {
  return (await storage.getItem(key)) ?? '';
}

export async function saveComposeDraft(content: string, key = COMPOSER_DRAFT_KEY): Promise<void> {
  if (content.trim()) await storage.setItem(key, content);
  else await storage.removeItem(key);
}

export async function clearComposeDraft(key = COMPOSER_DRAFT_KEY): Promise<void> {
  await storage.removeItem(key);
}
