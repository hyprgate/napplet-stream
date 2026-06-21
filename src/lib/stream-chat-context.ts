import type { RuntimePlaybackChatContext } from '@hyprgate/utils';
import type { LiveStream } from './stream-store.js';

export function streamChatContext(stream: LiveStream): RuntimePlaybackChatContext {
  return {
    streamAddr: stream.streamAddr,
    title: stream.title,
    ...(stream.chatRelays.length > 0 ? { chatRelays: stream.chatRelays } : {}),
  };
}
