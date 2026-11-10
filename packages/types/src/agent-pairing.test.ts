import { describe, expect, it } from 'vitest';
import {
  agentPairingFromSearch,
  formatAgentPairingUri,
  parseAgentPairingInput,
  parseAgentPairingUri,
} from './agent-pairing.js';

const PUBKEY = 'a'.repeat(64);
const SECRET = 'f'.repeat(32);

describe('agent pairing URI', () => {
  it('round-trips a payload through format and parse', () => {
    const uri = formatAgentPairingUri({
      pubkey: PUBKEY, tier: 'draft', relays: ['ws://127.0.0.1:9412'], blossomServers: ['http://127.0.0.1:9413'], secret: SECRET, label: 'Claude Code',
    });
    expect(parseAgentPairingUri(uri)).toEqual({
      pubkey: PUBKEY, tier: 'draft', relays: ['ws://127.0.0.1:9412'], blossomServers: ['http://127.0.0.1:9413'], secret: SECRET, label: 'Claude Code',
    });
  });

  it('rejects anything malformed rather than accepting it partially', () => {
    expect(parseAgentPairingUri('https://evil.example/?pubkey=' + PUBKEY)).toBeNull();
    expect(parseAgentPairingUri(`hyprgate-agent:pair?pubkey=${PUBKEY}&tier=owner&relay=ws://r&secret=${SECRET}`)).toBeNull();
    expect(parseAgentPairingUri(`hyprgate-agent:pair?pubkey=${PUBKEY}&tier=draft&secret=${SECRET}`)).toBeNull();
    expect(parseAgentPairingUri(`hyprgate-agent:pair?pubkey=${PUBKEY}&tier=draft&relay=http://r&secret=${SECRET}`)).toBeNull();
    expect(parseAgentPairingUri(`hyprgate-agent:pair?pubkey=${PUBKEY}&tier=draft&relay=ws://r&blossom=ws://b&secret=${SECRET}`)).toBeNull();
    expect(parseAgentPairingUri(`hyprgate-agent:pair?pubkey=npub1xyz&tier=draft&relay=ws://r&secret=${SECRET}`)).toBeNull();
    expect(parseAgentPairingUri(`hyprgate-agent:pair?pubkey=${PUBKEY}&tier=draft&relay=ws://r&secret=${SECRET}&label=${'x'.repeat(81)}`)).toBeNull();
    // No secret, or a secret that is not hex, means the pairing cannot be bound: reject.
    expect(parseAgentPairingUri(`hyprgate-agent:pair?pubkey=${PUBKEY}&tier=draft&relay=ws://r`)).toBeNull();
    expect(parseAgentPairingUri(`hyprgate-agent:pair?pubkey=${PUBKEY}&tier=draft&relay=ws://r&secret=not-hex`)).toBeNull();
  });

  it('accepts a shell deep link carrying the URI and reads it from a search string', () => {
    const uri = formatAgentPairingUri({ pubkey: PUBKEY, tier: 'draft', relays: ['wss://relay.example'], blossomServers: [], secret: SECRET });
    const link = `http://localhost:9391/?pair-agent=${encodeURIComponent(uri)}`;
    expect(parseAgentPairingInput(link)?.relays).toEqual(['wss://relay.example']);
    expect(parseAgentPairingInput('garbage')).toBeNull();
    expect(agentPairingFromSearch(new URL(link).search)).toEqual({
      uri,
      payload: { pubkey: PUBKEY, tier: 'draft', relays: ['wss://relay.example'], blossomServers: [], secret: SECRET },
    });
    expect(agentPairingFromSearch('?other=1')).toBeNull();
  });
});
