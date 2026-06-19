import type { RuntimePlaybackChatContext } from '@hyprgate/utils';
import type { LiveStream } from './stream-store.js';

export function streamChatContext(stream: LiveStream): RuntimePlaybackChatContext | undefined {
  return stream.chatRelays.length > 0
    ? { streamAddr: stream.streamAddr, title: stream.title, chatRelays: stream.chatRelays }
    : undefined;
}
