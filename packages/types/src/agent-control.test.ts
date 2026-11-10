import { describe, expect, it } from 'vitest';
import { agentToolNameFor, isAgentToolDescriptor, parseAgentControlMessage } from './agent-control.js';

const SESSION = 'c'.repeat(64);
const tool = {
  id: 'window.focus', revision: 3, domain: 'window', title: 'window focus', description: 'Focus a window.',
  inputSchema: { type: 'object', properties: { windowId: { type: 'string' } }, required: ['windowId'] },
  readOnly: false, confirmation: false,
};

describe('agent control messages', () => {
  it('parses every message type and rejects malformed ones', () => {
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'hello', session: SESSION, tools: [tool] }))).toEqual({ v: 1, type: 'hello', session: SESSION, tools: [tool] });
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'hello-request' }))).toEqual({ v: 1, type: 'hello-request' });
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'tool-published', tool }))).toEqual({ v: 1, type: 'tool-published', tool });
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'tool-withdrawn', id: 'window.focus', revision: 3 }))).toEqual({ v: 1, type: 'tool-withdrawn', id: 'window.focus', revision: 3 });
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'revoked' }))).toEqual({ v: 1, type: 'revoked' });
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'call', callId: 'c1', id: 'window.focus', revision: 3, arguments: { windowId: 'w' } })))
      .toEqual({ v: 1, type: 'call', callId: 'c1', id: 'window.focus', revision: 3, arguments: { windowId: 'w' } });
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'cancel', callId: 'c1' }))).toEqual({ v: 1, type: 'cancel', callId: 'c1' });
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'result', callId: 'c1', snapshot: { status: 'succeeded' } })))
      .toEqual({ v: 1, type: 'result', callId: 'c1', snapshot: { status: 'succeeded' } });

    expect(parseAgentControlMessage('not json')).toBeNull();
    expect(parseAgentControlMessage(JSON.stringify({ v: 2, type: 'hello', session: SESSION, tools: [] }))).toBeNull();
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'hello', session: 'short', tools: [] }))).toBeNull();
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'call', callId: 'bad id!', id: 'window.focus', revision: 1, arguments: {} }))).toBeNull();
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'call', callId: 'c', id: 'Window.Focus', revision: 1, arguments: {} }))).toBeNull();
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'call', callId: 'c', id: 'window.focus', revision: 1, arguments: [] }))).toBeNull();
    expect(parseAgentControlMessage(JSON.stringify({ v: 1, type: 'surprise' }))).toBeNull();
    expect(isAgentToolDescriptor({ ...tool, inputSchema: 'nope' })).toBe(false);
  });

  it('maps dotted operation ids to MCP-safe tool names', () => {
    expect(agentToolNameFor('window.geometry.set')).toBe('shell_window_geometry_set');
    expect(agentToolNameFor('app.install')).toBe('shell_app_install');
  });
});
