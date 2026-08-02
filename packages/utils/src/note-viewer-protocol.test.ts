import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import * as nip19 from 'nostr-tools/nip19';
import {
  KIND_NIP22_COMMENT,
  KIND_TEXT_NOTE,
  NOTE_VIEWER_OPEN_PROTOCOL,
  NOTE_VIEWER_OPEN_TOPIC,
  createNoteViewerOpenIntentRequest,
  createNoteViewerOpenPayload,
  createKind1ReplyTags,
  createNip22CommentTags,
  isNoteViewerOpenPayload,
  noteViewerLoadTargetFromPayload,
  parseNip10Reply,
  parseNip22Comment,
  parseNoteViewerReply,
  parseNoteViewerOpenIntentResult,
} from './note-viewer-protocol.js';

const ROOT = makeEvent({ id: 'root', kind: 1, pubkey: 'root-pubkey' });
const PARENT = makeEvent({ id: 'parent', kind: 1, pubkey: 'parent-pubkey' });
const ARTICLE = makeEvent({ id: 'article', kind: 30023, pubkey: 'article-author' });
const ARTICLE_COMMENT = makeEvent({ id: 'comment', kind: 1111, pubkey: 'commenter' });

describe('note viewer protocol helpers', () => {
  it('names the draft note open topic without advertising runtime support', () => {
    expect(NOTE_VIEWER_OPEN_TOPIC).toBe('note:open');
    expect(NOTE_VIEWER_OPEN_PROTOCOL).toBe('NAP-04');
  });

  it('creates and validates NAP-04 note open payloads', () => {
    const payload = createNoteViewerOpenPayload({
      target: {
        type: 'event',
        id: 'a'.repeat(64),
        kind: 1,
        pubkey: 'b'.repeat(64),
      },
      relays: ['wss://relay.example', 'wss://relay.example'],
      behavior: { focus: true },
    });

    expect(payload).toEqual({
      target: {
        type: 'event',
        id: 'a'.repeat(64),
        kind: 1,
        pubkey: 'b'.repeat(64),
        nip19: expect.stringMatching(/^nevent1/),
      },
      relays: ['wss://relay.example'],
      behavior: { focus: true },
    });
    expect(isNoteViewerOpenPayload(payload)).toBe(true);
    expect(nip19.decode(payload!.target.nip19!).data).toMatchObject({
      id: 'a'.repeat(64),
      author: 'b'.repeat(64),
      kind: 1,
      relays: ['wss://relay.example'],
    });
  });

  it('builds an archetype-led note request and retains canonical no-handler identity', () => {
    const request = createNoteViewerOpenIntentRequest({
      target: { type: 'event', id: 'a'.repeat(64) },
    }, { convention: 'napplet:document/open' });

    expect(request).toMatchObject({
      archetype: 'note',
      convention: 'napplet:document/open',
      payload: { target: { type: 'event', id: 'a'.repeat(64) } },
    });
    expect(request).not.toHaveProperty('action');
    expect(createNoteViewerOpenIntentRequest({ target: { type: 'event', id: 'A'.repeat(64) } })).toBeNull();
    expect(parseNoteViewerOpenIntentResult({
      ok: false,
      archetype: 'note',
      action: 'open',
      handled: false,
      error: 'no handler',
    })).toMatchObject({ archetype: 'note', action: 'open', handled: false });
    expect(parseNoteViewerOpenIntentResult({ ok: false, archetype: 'note', handled: false })).toBeNull();
  });

  it('rebuilds stale event and address NIP-19 targets with payload relay hints', () => {
    const eventPayload = createNoteViewerOpenPayload({
      target: {
        type: 'event',
        id: 'a'.repeat(64),
        kind: 1,
        pubkey: 'b'.repeat(64),
        nip19: nip19.noteEncode('a'.repeat(64)),
      },
      relays: ['wss://relay.example'],
    });
    expect(nip19.decode(eventPayload!.target.nip19!).data).toMatchObject({
      id: 'a'.repeat(64),
      author: 'b'.repeat(64),
      kind: 1,
      relays: ['wss://relay.example'],
    });

    const addressPayload = createNoteViewerOpenPayload({
      target: {
        type: 'address',
        kind: 30023,
        pubkey: 'b'.repeat(64),
        identifier: 'article',
        nip19: nip19.naddrEncode({ kind: 30023, pubkey: 'b'.repeat(64), identifier: 'article' }),
      },
      relays: ['wss://relay.example'],
    });
    expect(nip19.decode(addressPayload!.target.nip19!).data).toMatchObject({
      kind: 30023,
      pubkey: 'b'.repeat(64),
      identifier: 'article',
      relays: ['wss://relay.example'],
    });
  });

  it('rejects malformed NAP-04 note open payloads', () => {
    expect(createNoteViewerOpenPayload({ target: { type: 'event', id: 'A'.repeat(64) } })).toBeNull();
    expect(isNoteViewerOpenPayload({ target: { type: 'address', kind: 30023, pubkey: 'b'.repeat(64) } })).toBe(false);
  });

  it('returns a loadable target string from note open payloads', () => {
    expect(noteViewerLoadTargetFromPayload({
      target: { type: 'event', id: 'a'.repeat(64), nip19: ' note1target ' },
    })).toBe('note1target');
    expect(noteViewerLoadTargetFromPayload({
      target: { type: 'event', id: 'b'.repeat(64) },
    })).toBe('b'.repeat(64));
    expect(noteViewerLoadTargetFromPayload({
      target: { type: 'address', kind: 30023, pubkey: 'c'.repeat(64), identifier: 'article' },
    })).toBeNull();
  });

  it('returns a relay-hinted target string when payload relays are known', () => {
    const loadTarget = noteViewerLoadTargetFromPayload({
      target: {
        type: 'event',
        id: 'a'.repeat(64),
        kind: 1,
        pubkey: 'b'.repeat(64),
        nip19: nip19.noteEncode('a'.repeat(64)),
      },
      relays: ['wss://relay.example'],
    });

    expect(loadTarget).toMatch(/^nevent1/);
    expect(nip19.decode(loadTarget!).data).toMatchObject({
      id: 'a'.repeat(64),
      author: 'b'.repeat(64),
      kind: 1,
      relays: ['wss://relay.example'],
    });
  });

  it('parses NIP-10 marked kind 1 replies', () => {
    const reply = makeEvent({
      kind: KIND_TEXT_NOTE,
      tags: [
        ['e', ROOT.id, 'wss://relay.example', 'root'],
        ['e', PARENT.id, 'wss://relay.example', 'reply'],
        ['p', ROOT.pubkey],
        ['p', PARENT.pubkey],
        ['p', PARENT.pubkey],
      ],
    });

    expect(parseNip10Reply(reply)).toEqual({
      type: 'kind1-reply',
      root: { type: 'event', id: ROOT.id, relay: 'wss://relay.example', marker: 'root' },
      parent: { type: 'event', id: PARENT.id, relay: 'wss://relay.example', marker: 'reply' },
      pubkeys: [ROOT.pubkey, PARENT.pubkey],
      source: 'marked',
    });
  });

  it('parses deprecated positional NIP-10 replies for reading', () => {
    const reply = makeEvent({
      kind: KIND_TEXT_NOTE,
      tags: [
        ['e', ROOT.id],
        ['e', PARENT.id],
        ['p', PARENT.pubkey],
      ],
    });

    expect(parseNip10Reply(reply)).toMatchObject({
      type: 'kind1-reply',
      root: { id: ROOT.id },
      parent: { id: PARENT.id },
      pubkeys: [PARENT.pubkey],
      source: 'positional',
    });
  });

  it('parses strict NIP-22 comments with root and parent references', () => {
    const comment = makeEvent({
      kind: KIND_NIP22_COMMENT,
      tags: [
        ['E', ARTICLE.id, 'wss://relay.example'],
        ['K', String(ARTICLE.kind)],
        ['P', ARTICLE.pubkey],
        ['e', ARTICLE_COMMENT.id, 'wss://relay.example'],
        ['k', String(ARTICLE_COMMENT.kind)],
        ['p', ARTICLE_COMMENT.pubkey],
      ],
    });

    expect(parseNip22Comment(comment)).toEqual({
      type: 'nip22-comment',
      root: {
        type: 'event',
        id: ARTICLE.id,
        relay: 'wss://relay.example',
        kind: ARTICLE.kind,
        pubkey: ARTICLE.pubkey,
      },
      parent: {
        type: 'event',
        id: ARTICLE_COMMENT.id,
        relay: 'wss://relay.example',
        kind: ARTICLE_COMMENT.kind,
        pubkey: ARTICLE_COMMENT.pubkey,
      },
      rootKind: ARTICLE.kind,
      parentKind: ARTICLE_COMMENT.kind,
      rootPubkey: ARTICLE.pubkey,
      parentPubkey: ARTICLE_COMMENT.pubkey,
    });
  });

  it('reads real-world kind 1111 comments against arbitrary event kinds', () => {
    const comment = makeEvent({
      kind: KIND_NIP22_COMMENT,
      tags: [
        ['E', 'custom-event'],
        ['K', '39089'],
        ['P', 'custom-author'],
      ],
    });

    expect(parseNip22Comment(comment)).toMatchObject({
      type: 'nip22-comment',
      root: { type: 'event', id: 'custom-event', kind: 39089, pubkey: 'custom-author' },
      parent: { type: 'event', id: 'custom-event', kind: 39089, pubkey: 'custom-author' },
      rootKind: 39089,
      parentKind: 39089,
    });
  });

  it('classifies reply provenance without collapsing NIP-10 and NIP-22', () => {
    const kind1Reply = makeEvent({ kind: KIND_TEXT_NOTE, tags: [['e', ROOT.id, '', 'root']] });
    const nip22Comment = makeEvent({ kind: KIND_NIP22_COMMENT, tags: [['E', ARTICLE.id], ['K', '30023']] });

    expect(parseNoteViewerReply(kind1Reply)?.type).toBe('kind1-reply');
    expect(parseNoteViewerReply(nip22Comment)?.type).toBe('nip22-comment');
  });

  it('creates kind 1 reply tags with root, reply, and deduped p tags', () => {
    expect(createKind1ReplyTags({
      root: ROOT,
      parent: PARENT,
      relay: 'wss://relay.example',
    })).toEqual([
      ['e', ROOT.id, 'wss://relay.example', 'root'],
      ['e', PARENT.id, 'wss://relay.example', 'reply'],
      ['p', ROOT.pubkey],
      ['p', PARENT.pubkey],
    ]);
  });

  it('creates NIP-22 comment tags for non-kind-1 targets', () => {
    expect(createNip22CommentTags({
      root: ARTICLE,
      parent: ARTICLE_COMMENT,
      relay: 'wss://relay.example',
    })).toEqual([
      ['E', ARTICLE.id, 'wss://relay.example'],
      ['K', String(ARTICLE.kind)],
      ['P', ARTICLE.pubkey],
      ['e', ARTICLE_COMMENT.id, 'wss://relay.example'],
      ['k', String(ARTICLE_COMMENT.kind)],
      ['p', ARTICLE_COMMENT.pubkey],
    ]);
  });

  it('does not create kind 1111 comment tags for kind 1 targets by default', () => {
    expect(createNip22CommentTags({ root: ROOT })).toBeNull();
    expect(createNip22CommentTags({ root: ARTICLE, parent: PARENT })).toBeNull();
  });
});

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'event-id',
    pubkey: 'pubkey',
    created_at: 1,
    kind: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}
