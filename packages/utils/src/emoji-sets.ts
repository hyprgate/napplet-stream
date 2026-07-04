import type { NostrEvent } from '@hyprgate/types';
import { relay, storage, type Subscription } from "@napplet/sdk";

export const KIND_USER_EMOJI_LIST = 10030 as const;
export const KIND_EMOJI_SET = 30030 as const;
export const FEED_EMOJI_DEFAULTS_STORAGE_KEY = 'feed:reaction-defaults:v1';

export interface EmojiOption {
  content: string;
  label: string;
  source: 'default' | 'preferred' | 'set';
  shortcode?: string;
  imageUrl?: string;
  address?: string;
  tags?: string[][];
}

export interface EmojiSetSummary {
  address: string;
  identifier: string;
  title: string;
  pubkey: string;
  emojis: EmojiOption[];
}

export interface EmojiSetDraftRow {
  shortcode: string;
  url: string;
}

export interface PublishEmojiSetInput {
  identifier: string;
  title: string;
  rows: EmojiSetDraftRow[];
}

export interface EmojiSetState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  defaults: EmojiOption[];
  options: EmojiOption[];
  preferred: EmojiOption[];
  sets: EmojiSetSummary[];
  activeSource: 'default' | 'preferred' | string;
  publishing: boolean;
}

export interface EmojiSetStore {
  state: EmojiSetState;
  init(pubkey: string): void;
  setActiveSource(source: 'default' | 'preferred' | string): void;
  addDefaultEmoji(content: string): Promise<void>;
  removeDefaultEmoji(content: string): Promise<void>;
  resetDefaults(): Promise<void>;
  publishEmojiSet(input: PublishEmojiSetInput): Promise<NostrEvent>;
  destroy(): void;
}

export const DEFAULT_REACTION_OPTIONS: EmojiOption[] = [
  { content: '+', label: 'Like', source: 'default' },
  { content: '-', label: 'Dislike', source: 'default' },
  { content: '❤️', label: 'Heart', source: 'default' },
  { content: '😂', label: 'Laugh', source: 'default' },
  { content: '🤙', label: 'Shaka', source: 'default' },
  { content: '👀', label: 'Eyes', source: 'default' },
];

const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;
const HTTPS_URL_RE = /^https:\/\/[^\s<>"']+$/i;

interface EmojiSetContext {
  state: EmojiSetState;
  currentPubkey: string | null;
  preferredEvent: NostrEvent | null;
  // The 10030 list is auto-selected by default, but an explicit user choice wins.
  sourceTouched: boolean;
  setEvents: Map<string, NostrEvent>;
  subscriptions: Set<Subscription>;
  onUpdate?: () => void;
}

function notify(ctx: EmojiSetContext): void {
  ctx.onUpdate?.();
}

function recomputeOptions(ctx: EmojiSetContext): void {
  const { state } = ctx;
  state.sets = [...ctx.setEvents.values()]
    .map(parseEmojiSetEvent)
    .filter((set): set is EmojiSetSummary => set !== null)
    .sort((a, b) => a.title.localeCompare(b.title));

  state.preferred = ctx.preferredEvent ? parsePreferredEmojiList(ctx.preferredEvent, state.sets) : [];

  if (state.activeSource === 'preferred' && state.preferred.length === 0) {
    state.activeSource = 'default';
  }

  if (state.activeSource === 'preferred' && state.preferred.length > 0) {
    state.options = cloneOptions(state.preferred);
  } else if (state.activeSource !== 'default') {
    const selected = state.sets.find((set) => set.address === state.activeSource);
    state.options = selected ? cloneOptions(selected.emojis) : cloneOptions(state.defaults);
    if (!selected) state.activeSource = 'default';
  } else if (!ctx.sourceTouched && state.preferred.length > 0) {
    state.activeSource = 'preferred';
    state.options = cloneOptions(state.preferred);
  } else {
    state.options = cloneOptions(state.defaults);
  }

  notify(ctx);
}

async function loadStoredDefaults(ctx: EmojiSetContext): Promise<void> {
  const { state } = ctx;
  try {
    const raw = await storage.getItem(FEED_EMOJI_DEFAULTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const next = parsed
        .filter((value): value is string => typeof value === 'string')
        .map((content) => content.trim())
        .filter(Boolean);
      if (next.length > 0) {
        state.defaults = uniqueStrings(next).map((content) => ({
          content,
          label: content,
          source: 'default' as const,
        }));
      }
    }
  } catch {
    state.defaults = cloneOptions(DEFAULT_REACTION_OPTIONS);
  }
  recomputeOptions(ctx);
}

function closeSubscriptions(ctx: EmojiSetContext): void {
  for (const sub of ctx.subscriptions) sub.close();
  ctx.subscriptions.clear();
}

function subscribeToEmojiEvents(ctx: EmojiSetContext, pubkey: string): void {
  const sub = relay.subscribe(
    [
      { kinds: [KIND_USER_EMOJI_LIST], authors: [pubkey], limit: 1 },
      { kinds: [KIND_EMOJI_SET], authors: [pubkey], limit: 50 },
    ],
    (result) => {
      const event = result.event as NostrEvent;
      if (event.kind === KIND_USER_EMOJI_LIST) {
        if (!ctx.preferredEvent || event.created_at >= ctx.preferredEvent.created_at) ctx.preferredEvent = event;
      } else if (event.kind === KIND_EMOJI_SET) {
        const address = addressForEmojiSet(event);
        if (address) ctx.setEvents.set(address, event);
      }
      recomputeOptions(ctx);
    },
    () => {
      ctx.state.loading = false;
      ctx.state.loaded = true;
      recomputeOptions(ctx);
    },
  );
  ctx.subscriptions.add(sub);
}

async function persistDefaults(ctx: EmojiSetContext): Promise<void> {
  await storage.setItem(FEED_EMOJI_DEFAULTS_STORAGE_KEY, JSON.stringify(ctx.state.defaults.map((item) => item.content)));
}

function createEmojiSetContext(onUpdate?: () => void): EmojiSetContext {
  return {
    state: {
      loading: false,
      loaded: false,
      error: null,
      defaults: cloneOptions(DEFAULT_REACTION_OPTIONS),
      options: cloneOptions(DEFAULT_REACTION_OPTIONS),
      preferred: [],
      sets: [],
      activeSource: 'default',
      publishing: false,
    },
    currentPubkey: null,
    preferredEvent: null,
    sourceTouched: false,
    setEvents: new Map<string, NostrEvent>(),
    subscriptions: new Set<Subscription>(),
    onUpdate,
  };
}

function initStore(ctx: EmojiSetContext, pubkey: string): void {
  if (ctx.currentPubkey === pubkey) return;
  ctx.currentPubkey = pubkey;
  ctx.preferredEvent = null;
  ctx.sourceTouched = false;
  ctx.setEvents.clear();
  closeSubscriptions(ctx);
  ctx.state.loading = true;
  ctx.state.loaded = false;
  ctx.state.error = null;
  void loadStoredDefaults(ctx);
  try {
    subscribeToEmojiEvents(ctx, pubkey);
  } catch (error) {
    ctx.state.loading = false;
    ctx.state.loaded = true;
    ctx.state.error = error instanceof Error ? error.message : 'emoji list failed';
    recomputeOptions(ctx);
  }
  notify(ctx);
}

async function addDefaultEmoji(ctx: EmojiSetContext, content: string): Promise<void> {
  const normalized = content.trim();
  if (!normalized || ctx.state.defaults.some((item) => item.content === normalized)) return;
  ctx.state.defaults = [...ctx.state.defaults, { content: normalized, label: normalized, source: 'default' }];
  await persistDefaults(ctx);
  recomputeOptions(ctx);
}

async function removeDefaultEmoji(ctx: EmojiSetContext, content: string): Promise<void> {
  ctx.state.defaults = ctx.state.defaults.filter((item) => item.content !== content);
  if (ctx.state.defaults.length === 0) ctx.state.defaults = cloneOptions(DEFAULT_REACTION_OPTIONS);
  await persistDefaults(ctx);
  recomputeOptions(ctx);
}

async function resetDefaults(ctx: EmojiSetContext): Promise<void> {
  ctx.state.defaults = cloneOptions(DEFAULT_REACTION_OPTIONS);
  await storage.removeItem(FEED_EMOJI_DEFAULTS_STORAGE_KEY);
  recomputeOptions(ctx);
}

async function publishEmojiSet(ctx: EmojiSetContext, input: PublishEmojiSetInput): Promise<NostrEvent> {
  if (!ctx.currentPubkey) throw new Error('pubkey is required');
  const identifier = normalizeIdentifier(input.identifier);
  const rows = normalizeDraftRows(input.rows);
  if (rows.length === 0) throw new Error('emoji set needs at least one row');

  ctx.state.publishing = true;
  ctx.state.error = null;
  notify(ctx);
  try {
    const emojiTags = rows.map((row) => ['emoji', row.shortcode, row.url] as string[]);
    const setEvent = await relay.publish({
      kind: KIND_EMOJI_SET,
      content: '',
      tags: [
        ['d', identifier],
        ['title', input.title.trim() || identifier],
        ...emojiTags,
      ],
      created_at: Math.floor(Date.now() / 1000),
    }) as NostrEvent;
    const address = `${KIND_EMOJI_SET}:${setEvent.pubkey || ctx.currentPubkey}:${identifier}`;

    const preferredTags = buildPreferredEmojiListTags(ctx.preferredEvent, address, emojiTags);
    await relay.publish({
      kind: KIND_USER_EMOJI_LIST,
      content: '',
      tags: preferredTags,
      created_at: Math.floor(Date.now() / 1000),
    });

    ctx.setEvents.set(address, setEvent);
    ctx.preferredEvent = {
      id: `local-${Date.now()}`,
      pubkey: setEvent.pubkey || ctx.currentPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: KIND_USER_EMOJI_LIST,
      tags: preferredTags,
      content: '',
      sig: '',
    };
    ctx.state.activeSource = 'preferred';
    recomputeOptions(ctx);
    return setEvent;
  } catch (error) {
    ctx.state.error = error instanceof Error ? error.message : 'emoji set publish failed';
    notify(ctx);
    throw error;
  } finally {
    ctx.state.publishing = false;
    notify(ctx);
  }
}

export function createEmojiSetStore(onUpdate?: () => void): EmojiSetStore {
  const ctx = createEmojiSetContext(onUpdate);

  return {
    state: ctx.state,
    init: (pubkey) => initStore(ctx, pubkey),
    setActiveSource(source) {
      ctx.sourceTouched = true;
      ctx.state.activeSource = source;
      recomputeOptions(ctx);
    },
    addDefaultEmoji: (content) => addDefaultEmoji(ctx, content),
    removeDefaultEmoji: (content) => removeDefaultEmoji(ctx, content),
    resetDefaults: () => resetDefaults(ctx),
    publishEmojiSet: (input) => publishEmojiSet(ctx, input),
    destroy: () => closeSubscriptions(ctx),
  };
}

export function reactionInputFromEmojiOption(option: EmojiOption): { content: string; tags?: string[][] } {
  return {
    content: option.content,
    ...(option.tags ? { tags: option.tags.map((tag) => [...tag]) } : {}),
  };
}

export function customReactionInput(value: string, options: EmojiOption[]): { content: string; tags?: string[][] } {
  const content = value.trim();
  const match = /^:([A-Za-z0-9_-]+):$/.exec(content);
  if (match) {
    const option = options.find((item) => item.shortcode === match[1]);
    if (option) return reactionInputFromEmojiOption(option);
  }
  return { content };
}

function parsePreferredEmojiList(event: NostrEvent, sets: EmojiSetSummary[]): EmojiOption[] {
  const direct = parseEmojiTags(event.tags, 'preferred');
  const referenced = event.tags
    .filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string')
    .flatMap((tag) => sets.find((set) => set.address === tag[1])?.emojis ?? []);
  return uniqueOptions([...direct, ...referenced]);
}

function parseEmojiSetEvent(event: NostrEvent): EmojiSetSummary | null {
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (!identifier) return null;
  const address = addressForEmojiSet(event);
  if (!address) return null;
  const title = event.tags.find((tag) => tag[0] === 'title')?.[1] ?? identifier;
  return {
    address,
    identifier,
    title,
    pubkey: event.pubkey,
    emojis: parseEmojiTags(event.tags, 'set', address),
  };
}

function parseEmojiTags(tags: string[][], source: 'preferred' | 'set', address?: string): EmojiOption[] {
  const options: EmojiOption[] = [];
  for (const tag of tags) {
    if (tag[0] !== 'emoji') continue;
    const code = tag[1];
    if (typeof code !== 'string' || code.length === 0) continue;
    const imageUrl = tag[2];

    if (typeof imageUrl === 'string' && imageUrl.length > 0) {
      // NIP-30 custom emoji: shortcode + https image url.
      if (!SHORTCODE_RE.test(code) || !HTTPS_URL_RE.test(imageUrl)) continue;
      const emojiAddress = tag[3] || address;
      const emojiTag = ['emoji', code, imageUrl, ...(emojiAddress ? [emojiAddress] : [])];
      options.push({
        content: `:${code}:`,
        label: code,
        source,
        shortcode: code,
        imageUrl,
        ...(emojiAddress ? { address: emojiAddress } : {}),
        tags: [emojiTag],
      });
    } else {
      // Standard Unicode emoji: a two-element ["emoji", "😀"] tag.
      options.push({ content: code, label: code, source });
    }
  }
  return uniqueOptions(options);
}

function addressForEmojiSet(event: NostrEvent): string | null {
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
  return identifier ? `${KIND_EMOJI_SET}:${event.pubkey}:${identifier}` : null;
}

function normalizeIdentifier(value: string): string {
  const normalized = value.trim().replace(/\s+/g, '-');
  if (!SHORTCODE_RE.test(normalized)) throw new Error('emoji set identifier must be alphanumeric, hyphen, or underscore');
  return normalized;
}

function normalizeDraftRows(rows: EmojiSetDraftRow[]): EmojiSetDraftRow[] {
  const seen = new Set<string>();
  const normalized: EmojiSetDraftRow[] = [];
  for (const row of rows) {
    const shortcode = row.shortcode.trim();
    const url = row.url.trim();
    if (!SHORTCODE_RE.test(shortcode) || !HTTPS_URL_RE.test(url) || seen.has(shortcode)) continue;
    seen.add(shortcode);
    normalized.push({ shortcode, url });
  }
  return normalized;
}

function buildPreferredEmojiListTags(existing: NostrEvent | null, address: string, emojiTags: string[][]): string[][] {
  const tags = (existing?.tags ?? []).map((tag) => [...tag]);
  if (!tags.some((tag) => tag[0] === 'a' && tag[1] === address)) tags.push(['a', address]);
  for (const tag of emojiTags) {
    const next = [...tag, address];
    const exists = tags.some((candidate) =>
      candidate[0] === 'emoji'
      && candidate[1] === next[1]
      && candidate[2] === next[2]
      && candidate[3] === next[3],
    );
    if (!exists) tags.push(next);
  }
  return tags;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueOptions(options: EmojiOption[]): EmojiOption[] {
  const seen = new Set<string>();
  const next: EmojiOption[] = [];
  for (const option of options) {
    const key = option.shortcode ?? option.content;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(option);
  }
  return next;
}

function cloneOptions(options: EmojiOption[]): EmojiOption[] {
  return options.map((option) => ({
    ...option,
    ...(option.tags ? { tags: option.tags.map((tag) => [...tag]) } : {}),
  }));
}
