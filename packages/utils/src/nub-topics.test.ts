import { describe, expect, it } from 'vitest';
import {
  IDENTITY_CHANGED_TOPIC,
  LEGACY_AUTH_IDENTITY_CHANGED_TOPIC,
  PROFILE_READY_TOPIC,
  SUPPORTED_NUB_IFC_PROTOCOL_CAPABILITIES,
  createStreamChannelSwitchPayload,
  createStreamCurrentContextPayload,
  isCanonicalHexPubkey,
  parseIdentityChangedPayload,
  parseChatOpenDmPayload,
  parseProfileOpenPayload,
  parseStreamChannelSwitchPayload,
} from './nub-topics.js';
import {
  createReadingQueueAddPayload,
  parseReadingQueueAddPayload,
} from './reading-queue-protocol.js';
import {
  createWorkspaceJournalCapturePayload,
  parseWorkspaceJournalCapturePayload,
} from './workspace-journal-protocol.js';

const VALID_PUBKEY = 'a'.repeat(64);

describe('NUB topic payload helpers', () => {
  it('validates canonical lowercase hex pubkeys', () => {
    expect(isCanonicalHexPubkey(VALID_PUBKEY)).toBe(true);
    expect(isCanonicalHexPubkey('A'.repeat(64))).toBe(false);
    expect(isCanonicalHexPubkey('g'.repeat(64))).toBe(false);
    expect(isCanonicalHexPubkey('a'.repeat(63))).toBe(false);
    expect(isCanonicalHexPubkey(null)).toBe(false);
  });

  it('defines canonical and legacy identity change topics', () => {
    expect(IDENTITY_CHANGED_TOPIC).toBe('identity:changed');
    expect(LEGACY_AUTH_IDENTITY_CHANGED_TOPIC).toBe('auth:identity-changed');
  });

  it('parses identity change payloads', () => {
    expect(parseIdentityChangedPayload({ pubkey: VALID_PUBKEY })).toEqual({ pubkey: VALID_PUBKEY });
    expect(parseIdentityChangedPayload({ pubkey: null })).toEqual({ pubkey: null });
    expect(parseIdentityChangedPayload({ pubkey: 'A'.repeat(64) })).toBeNull();
    expect(parseIdentityChangedPayload({})).toBeNull();
  });

  it('parses NAP-01 profile:open payloads', () => {
    expect(PROFILE_READY_TOPIC).toBe('profile:ready');
    expect(parseProfileOpenPayload({ pubkey: VALID_PUBKEY })).toEqual({ pubkey: VALID_PUBKEY });
    expect(parseProfileOpenPayload({ pubkey: 'A'.repeat(64) })).toBeNull();
    expect(parseProfileOpenPayload({ pubkey: 'z' })).toBeNull();
    expect(parseProfileOpenPayload(null)).toBeNull();
  });

  it('parses NAP-03 chat:open-dm payloads with displayName as a hint', () => {
    expect(parseChatOpenDmPayload({ pubkey: VALID_PUBKEY, displayName: 'Alice' })).toEqual({
      pubkey: VALID_PUBKEY,
      displayName: 'Alice',
    });
    expect(parseChatOpenDmPayload({ pubkey: VALID_PUBKEY, displayName: '' })).toEqual({ pubkey: VALID_PUBKEY });
    expect(parseChatOpenDmPayload({ pubkey: 'A'.repeat(64), displayName: 'Alice' })).toBeNull();
  });

  it('creates preferred NAP-02 stream:channel-switch payloads with metadata hints', () => {
    expect(createStreamChannelSwitchPayload({
      streamId: '30311:host:stream',
      streamUrl: 'https://example.test/live.m3u8',
      title: 'Live',
      chatRelays: ['wss://relay.example'],
      image: 'https://example.test/image.png',
      hostPubkey: VALID_PUBKEY,
    })).toEqual({
      streamId: '30311:host:stream',
      streamUrl: 'https://example.test/live.m3u8',
      metadata: {
        title: 'Live',
        chatRelays: ['wss://relay.example'],
        image: 'https://example.test/image.png',
        hostPubkey: VALID_PUBKEY,
      },
    });
  });

  it('normalizes preferred and compatibility stream channel-switch payloads', () => {
    expect(parseStreamChannelSwitchPayload({
      streamId: '30311:host:stream',
      metadata: { title: 'Preferred', chatRelays: ['wss://relay.example'] },
    })).toEqual({
      streamId: '30311:host:stream',
      metadata: { title: 'Preferred', chatRelays: ['wss://relay.example'] },
    });

    expect(parseStreamChannelSwitchPayload({
      streamId: '30311:host:stream',
      title: 'Legacy Alias',
      chatRelays: ['wss://legacy.example'],
    })).toEqual({
      streamId: '30311:host:stream',
      metadata: { title: 'Legacy Alias', chatRelays: ['wss://legacy.example'] },
    });

    expect(parseStreamChannelSwitchPayload(JSON.stringify({
      streamId: '30311:host:stream',
      streamUrl: 'https://example.test/live.m3u8',
      metadata: { title: 'String Payload', chatRelays: ['wss://string.example'] },
    }))).toEqual({
      streamId: '30311:host:stream',
      streamUrl: 'https://example.test/live.m3u8',
      metadata: { title: 'String Payload', chatRelays: ['wss://string.example'] },
    });
  });

  it('rejects invalid stream channel-switch payloads', () => {
    expect(parseStreamChannelSwitchPayload({ metadata: { title: 'Missing streamId' } })).toBeNull();
    expect(parseStreamChannelSwitchPayload({ streamId: '', metadata: {} })).toBeNull();
    expect(parseStreamChannelSwitchPayload({ streamId: '30311:host:stream', metadata: 'bad' })).toBeNull();
    expect(parseStreamChannelSwitchPayload({ streamId: '30311:host:stream', metadata: { chatRelays: [1] } })).toBeNull();
    expect(parseStreamChannelSwitchPayload(null)).toBeNull();
  });

  it('echoes stream current-context requestId when provided', () => {
    expect(createStreamCurrentContextPayload(
      { streamAddr: '30311:host:stream', title: 'Live', chatRelays: ['wss://relay.example'] },
      { requestId: 'req-1' },
    )).toEqual({
      requestId: 'req-1',
      streamAddr: '30311:host:stream',
      title: 'Live',
      chatRelays: ['wss://relay.example'],
    });

    expect(createStreamCurrentContextPayload(
      { streamAddr: null, title: null, chatRelays: [] },
      { requestId: '' },
    )).toEqual({
      streamAddr: null,
      title: null,
      chatRelays: [],
    });

    expect(createStreamCurrentContextPayload(
      { streamAddr: '30311:host:string-request', title: 'Live', chatRelays: [] },
      JSON.stringify({ requestId: 'string-req-1' }),
    )).toEqual({
      requestId: 'string-req-1',
      streamAddr: '30311:host:string-request',
      title: 'Live',
      chatRelays: [],
    });
  });

  it('lists the numbered INC protocols Hyprgate advertises after implementation', () => {
    expect(SUPPORTED_NUB_IFC_PROTOCOL_CAPABILITIES).toEqual([
      'inc:NAP-01',
      'inc:NAP-02',
      'inc:NAP-03',
      'inc:NAP-04',
      'inc:NAP-05',
      'inc:NAP-06',
    ]);
  });

  it('normalizes NAP-05 reading-queue:add payloads', () => {
    expect(createReadingQueueAddPayload({
      type: 'note',
      target: ' note1qqexample ',
      title: '  Read later ',
      summary: '',
      source: { napplet: 'thread-triage', requestId: 'req-1' },
    })).toEqual({
      type: 'note',
      target: 'note1qqexample',
      title: 'Read later',
      source: { napplet: 'thread-triage', requestId: 'req-1' },
    });

    expect(parseReadingQueueAddPayload({ type: 'bad', target: 'x' })).toBeNull();
    expect(parseReadingQueueAddPayload({ type: 'note', target: ' ' })).toBeNull();
  });

  it('normalizes NAP-06 journal:capture payloads', () => {
    expect(createWorkspaceJournalCapturePayload({
      title: '  Follow up ',
      body: '  Check relay routing ',
      refs: ['wss://relay.example', 'wss://relay.example', ' note1qqexample '],
    })).toEqual({
      title: 'Follow up',
      body: 'Check relay routing',
      refs: ['wss://relay.example', 'note1qqexample'],
    });

    expect(parseWorkspaceJournalCapturePayload({ title: '', body: 'body' })).toBeNull();
    expect(parseWorkspaceJournalCapturePayload({ title: 'title', body: '' })).toBeNull();
  });
});
