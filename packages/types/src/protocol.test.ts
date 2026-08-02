import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  AUTH_KIND,
  PSEUDO_RELAY_URI,
  REPLAY_WINDOW_SECONDS,
  DESTRUCTIVE_KINDS,
  BusKind,
  ALL_CAPABILITY_LABELS,
  createIntentRequest,
  createIntentResult,
  parseIncEvent,
  parseIntentResult,
} from './protocol.js';

describe('protocol constants', () => {
  it('PROTOCOL_VERSION equals "2.0.0"', () => {
    expect(PROTOCOL_VERSION).toBe('2.0.0');
  });

  it('AUTH_KIND equals 22242 (NIP-42)', () => {
    expect(AUTH_KIND).toBe(22242);
  });

  it('PSEUDO_RELAY_URI equals "hyprgate://shell"', () => {
    expect(PSEUDO_RELAY_URI).toBe('hyprgate://shell');
  });

  it('REPLAY_WINDOW_SECONDS equals 30', () => {
    expect(REPLAY_WINDOW_SECONDS).toBe(30);
  });

  it('DESTRUCTIVE_KINDS contains the core high-stakes kinds', () => {
    expect(DESTRUCTIVE_KINDS.has(0)).toBe(true);
    expect(DESTRUCTIVE_KINDS.has(3)).toBe(true);
    expect(DESTRUCTIVE_KINDS.has(5)).toBe(true);
    expect(DESTRUCTIVE_KINDS.has(1984)).toBe(true);
    expect(DESTRUCTIVE_KINDS.has(10002)).toBe(true);
  });

  it('DESTRUCTIVE_KINDS gates the full NIP-51 replaceable-list set', () => {
    for (const kind of [10000, 10001, 10003, 10004, 10005, 10006, 10007, 10009, 10015, 10030]) {
      expect(DESTRUCTIVE_KINDS.has(kind), `kind ${kind} should be gated`).toBe(true);
    }
  });

  it('DESTRUCTIVE_KINDS gates the NIP-51 addressable-set kinds', () => {
    for (const kind of [30000, 30001, 30002, 30003, 30004, 30005, 30015, 30030, 30063]) {
      expect(DESTRUCTIVE_KINDS.has(kind), `kind ${kind} should be gated`).toBe(true);
    }
  });

  it('DESTRUCTIVE_KINDS does NOT gate follow packs (39089) or plain notes (1)', () => {
    // Follow packs are discrete shareable artifacts, not a single-instance user list.
    expect(DESTRUCTIVE_KINDS.has(39089)).toBe(false);
    expect(DESTRUCTIVE_KINDS.has(1)).toBe(false);
  });
});

describe('BusKind', () => {
  it('REGISTRATION is 29000', () => {
    expect(BusKind.REGISTRATION).toBe(29000);
  });

  it('SIGNER_REQUEST is 29001', () => {
    expect(BusKind.SIGNER_REQUEST).toBe(29001);
  });

  it('SIGNER_RESPONSE is 29002', () => {
    expect(BusKind.SIGNER_RESPONSE).toBe(29002);
  });

  it('INTER_PANE is 29003', () => {
    expect(BusKind.INTER_PANE).toBe(29003);
  });

  it('HOTKEY_FORWARD is 29004', () => {
    expect(BusKind.HOTKEY_FORWARD).toBe(29004);
  });

  it('METADATA is 29005', () => {
    expect(BusKind.METADATA).toBe(29005);
  });

  it('NIPDB_REQUEST is 29006', () => {
    expect(BusKind.NIPDB_REQUEST).toBe(29006);
  });

  it('NIPDB_RESPONSE is 29007', () => {
    expect(BusKind.NIPDB_RESPONSE).toBe(29007);
  });

  it('all BusKind values are in the ephemeral range 29000-29999', () => {
    for (const value of Object.values(BusKind)) {
      expect(value).toBeGreaterThanOrEqual(29000);
      expect(value).toBeLessThanOrEqual(29999);
    }
  });
});

describe('ALL_CAPABILITY_LABELS', () => {
  it('has entries (hyprgate-local taxonomy, non-empty)', () => {
    expect(ALL_CAPABILITY_LABELS.length).toBeGreaterThan(0);
  });

  it('contains hyprgate-local capability label strings', () => {
    expect(ALL_CAPABILITY_LABELS).toContain('relay:read');
    expect(ALL_CAPABILITY_LABELS).toContain('relay:write');
    expect(ALL_CAPABILITY_LABELS).toContain('sign:event');
    expect(ALL_CAPABILITY_LABELS).toContain('sign:nip04');
    expect(ALL_CAPABILITY_LABELS).toContain('sign:nip44');
  });
});

describe('DESTRUCTIVE_KINDS smoke', () => {
  it('DESTRUCTIVE_KINDS.has(5) is true', () => {
    expect(DESTRUCTIVE_KINDS.has(5)).toBe(true);
  });
});

describe('canonical INTENT and INC wire helpers', () => {
  it('keeps action optional on requests while preserving independent selectors', () => {
    const request = createIntentRequest({
      archetype: 'profile',
      convention: 'napplet:document/open',
      payload: { pubkey: 'a'.repeat(64) },
      behavior: { newWindow: true },
    });

    expect(request).toEqual({
      archetype: 'profile',
      convention: 'napplet:document/open',
      payload: { pubkey: 'a'.repeat(64) },
      behavior: { newWindow: true },
    });
    expect(request).not.toHaveProperty('action');
    expect(request!.archetype).toBe('profile');
  });

  it('normalizes an omitted request action in every result and rejects missing result identity', () => {
    const request = createIntentRequest({ archetype: 'note', payload: { id: 'a'.repeat(64) } });
    const failure = createIntentResult(request!, { ok: false, handled: false, error: 'no handler' });

    expect(failure).toEqual({
      ok: false,
      archetype: 'note',
      action: 'open',
      handled: false,
      error: 'no handler',
    });
    expect(failure!.handled).toBe(false);
    expect(parseIntentResult({ ok: false, archetype: 'note', handled: false })).toBeNull();
    expect(parseIntentResult({ ok: false, archetype: 'note', action: '', handled: false })).toBeNull();
  });

  it('models one runtime-attested INC event and preserves an absent payload', () => {
    const event = parseIncEvent({ topic: 'note:open', sender: 'shell' });

    expect(event).toEqual({ topic: 'note:open', sender: 'shell' });
    expect(Object.hasOwn(event!, 'payload')).toBe(false);
    expect(event!.sender).toBe('shell');
    expect(parseIncEvent({ topic: '', sender: 'shell' })).toBeNull();
    expect(parseIncEvent({ topic: 'note:open', sender: 1 })).toBeNull();
  });
});
