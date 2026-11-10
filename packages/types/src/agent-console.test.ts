import { describe, expect, it } from 'vitest';
import { CONSOLE_MESSAGE_MAX_BYTES, isConsoleShellMessage, parseConsoleMessage } from './agent-console.js';
import { parseAgentControlMessage } from './agent-control.js';

const connection = { id: 'local', label: 'Ollama', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:11434/v1/', model: 'qwen3' };

describe('agent console messages', () => {
  it('parses each shell message and normalizes the connection', () => {
    const start = parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.session-start', sessionId: 'session-01', connection, credential: 'k', consentedAt: 5 }));
    expect(start).toEqual({ v: 1, type: 'console.session-start', sessionId: 'session-01', connection: { ...connection, baseUrl: 'http://127.0.0.1:11434/v1' }, credential: 'k', consentedAt: 5 });
    expect(isConsoleShellMessage(start!)).toBe(true);
    expect(parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.attach', sessionId: 'session-01', cursor: 3 }))).toMatchObject({ cursor: 3 });
    expect(parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.permission-response', sessionId: 'session-01', requestId: 'r1', answer: 'allow-group' }))).toMatchObject({ answer: 'allow-group' });
  });

  it('rejects malformed, oversized and unknown messages, and stays out of the control parser', () => {
    const bad = [
      { v: 1, type: 'console.session-start', sessionId: 'session-01', connection: { ...connection, protocol: 'other' }, consentedAt: 1 },
      { v: 1, type: 'console.session-start', sessionId: 'session-01', connection: { ...connection, baseUrl: 'file:///etc' }, consentedAt: 1 },
      { v: 1, type: 'console.prompt', sessionId: 'short', promptId: 'p', text: 'hi' },
      { v: 1, type: 'console.prompt', sessionId: 'session-01', promptId: 'p', text: '   ' },
      { v: 1, type: 'console.permission-response', sessionId: 'session-01', requestId: 'r', answer: 'yes' },
      { v: 1, type: 'console.attach', sessionId: 'session-01', cursor: -1 },
      { v: 1, type: 'console.unknown', sessionId: 'session-01' },
      { v: 2, type: 'console.cancel', sessionId: 'session-01' },
    ];
    for (const message of bad) expect(parseConsoleMessage(JSON.stringify(message)), JSON.stringify(message)).toBeNull();
    expect(parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.prompt', sessionId: 'session-01', promptId: 'p', text: 'x'.repeat(CONSOLE_MESSAGE_MAX_BYTES) }))).toBeNull();
    const update = parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.update', sessionId: 'session-01', events: [{ seq: 1, at: 1, kind: 'user', text: 'hi' }] }));
    expect(update && isConsoleShellMessage(update)).toBe(false);
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'console.cancel', sessionId: 'session-01' }))).toBeNull();
  });

  it('names a harness-held connection without sending one, and never with a credential', () => {
    const start = parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.session-start', sessionId: 'session-01', harnessConnection: 'chatgpt-gpt-5', consentedAt: 7 }));
    expect(start).toEqual({ v: 1, type: 'console.session-start', sessionId: 'session-01', harnessConnection: 'chatgpt-gpt-5', consentedAt: 7 });
    for (const extra of [{ credential: 'k' }, { connection }]) {
      expect(parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.session-start', sessionId: 'session-01', harnessConnection: 'x', consentedAt: 7, ...extra }))).toBeNull();
    }
    expect(parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.session-start', sessionId: 'session-01', harnessConnection: 'bad id!', consentedAt: 7 }))).toBeNull();
  });

  it('lists the harness connections as descriptors outside any session', () => {
    const request = parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.list-connections' }));
    expect(request).toEqual({ v: 1, type: 'console.list-connections' });
    expect(isConsoleShellMessage(request!)).toBe(true);
    const descriptor = { id: 'chatgpt-gpt-5', label: 'ChatGPT', provider: 'chatgpt', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', auth: 'chatgpt', account: 'me@example.com', isDefault: true, toolsChecked: true };
    const list = parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.connections', connections: [descriptor] }));
    expect(list).toEqual({ v: 1, type: 'console.connections', connections: [descriptor] });
    expect(isConsoleShellMessage(list!)).toBe(false);
    for (const broken of [{ ...descriptor, auth: 'token' }, { ...descriptor, baseUrl: 'file:///x' }, { ...descriptor, isDefault: 'yes' }]) {
      expect(parseConsoleMessage(JSON.stringify({ v: 1, type: 'console.connections', connections: [broken] }))).toBeNull();
    }
  });
});
