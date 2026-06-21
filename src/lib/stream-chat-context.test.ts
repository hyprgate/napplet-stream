import { describe, expect, it } from 'vitest';
import { parseKind30311 } from './stream-store.js';
import { streamChatContext } from './stream-chat-context.js';
import type { NostrEvent } from '@hyprgate/types';

function makeEvent(tags: string[][]): NostrEvent {
  return {
    kind: 30311,
    id: 'stream-event',
    pubkey: 'stream-publisher',
    created_at: 1700000000,
    content: '',
    tags,
    sig: 'sig',
  };
}

describe('streamChatContext', () => {
  it('builds runtime chat context from kind-30311 relay metadata', () => {
    const stream = parseKind30311(makeEvent([
      ['d', 'phase-94-stream'],
      ['title', 'Phase 94 Stream'],
      ['status', 'live'],
      ['streaming', 'https://stream.example.test/live.m3u8'],
      ['p', 'stream-host', '', 'host'],
      ['relays', 'wss://relay.example'],
    ]))!;

    expect(streamChatContext(stream)).toEqual({
      streamAddr: '30311:stream-host:phase-94-stream',
      title: 'Phase 94 Stream',
      chatRelays: ['wss://relay.example'],
    });
  });

  it('builds runtime chat context without relay hints when a stream has no chat relays', () => {
    const stream = parseKind30311(makeEvent([
      ['d', 'phase-94-stream'],
      ['title', 'Phase 94 Stream'],
      ['status', 'live'],
      ['streaming', 'https://stream.example.test/live.m3u8'],
    ]))!;

    expect(streamChatContext(stream)).toEqual({
      streamAddr: '30311:stream-publisher:phase-94-stream',
      title: 'Phase 94 Stream',
    });
  });
});
