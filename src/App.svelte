<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createStreamStore, parseKind30311 } from './lib/stream-store';
  import { streamChatContext } from './lib/stream-chat-context';
  import type { LiveStream } from './lib/stream-store';
  import { relay, inc } from '@napplet/sdk';
  import {
    controlRuntimePlayback,
    createStreamChannelSwitchPayload,
    createStreamCurrentContextPayload,
    hasNsfwTag,
    releaseRuntimePlayback,
    requestRuntimePlayback,
    subscribeRuntimePlayback,
    type RuntimePlaybackContext,
    type RuntimePlaybackQueueItem,
    type RuntimePlayerControl,
    type RuntimePlayerStatus,
    type RuntimePlayerSubscription,
  } from '@hyprgate/utils';
  import StreamList from './components/StreamList.svelte';

  // ── Store ─────────────────────────────────────────────────────────────────
  const store = createStreamStore();

  // ── Svelte reactivity bridge ───────────────────────────────────────────────
  // store uses plain mutable state (not $state runes) for vitest compatibility.
  // Bridge via version counter + setInterval polling.
  let version = $state(0);

  function notifyUpdate() {
    version++;
  }

  // ── Selected stream state ──────────────────────────────────────────────────
  let selectedStream: LiveStream | null = $state(null);
  let activeStreamId = $state<string | null>(null);
  let runtimeSessionId: string | null = null;
  let runtimeSubscription: RuntimePlayerSubscription | null = null;
  let runtimeState = $state<RuntimePlayerStatus | null>(null);
  let runtimeErrorStreamId = $state<string | null>(null);
  let requestInFlight = $state(false);

  // ── Derived state from store ───────────────────────────────────────────────
  let streams = $derived.by(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    version;
    return store.getStreams();
  });

  // NSFW is hidden by default; #nsfw-tagged streams only appear when enabled.
  let showNsfw = $state(false);
  let visibleStreams = $derived(
    showNsfw ? streams : streams.filter((stream) => !hasNsfwTag(stream.event)),
  );

  let loading = $derived.by(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    version;
    return store.loading;
  });

  // ── Subscription handles ───────────────────────────────────────────────────
  let sub: { close: () => void } | null = null;
  let contextSub: { close(): void } | null = null;

  function buildStreamQueue(stream: LiveStream): {
    context: RuntimePlaybackContext;
    queue: RuntimePlaybackQueueItem[];
    queueIndex: number | undefined;
    controls: RuntimePlayerControl[];
  } {
    const playable = streams.filter((candidate) => candidate.streamUrl);
    const total = playable.length;
    const queue = playable.map((candidate, index) => ({
      url: candidate.streamUrl,
      kind: 'hls' as const,
      title: candidate.title,
      artist: candidate.service || undefined,
      album: 'Live streams',
      artworkUrl: candidate.image || undefined,
      aspectRatio: 16 / 9,
      live: true,
      context: {
        label: 'Live streams',
        detail: candidate.tags.length > 0 ? candidate.tags.join(', ') : candidate.service || undefined,
        index,
        total,
        chat: streamChatContext(candidate),
      },
    }));
    const queueIndex = playable.findIndex((candidate) => candidate.id === stream.id);
    const controls: RuntimePlayerControl[] = ['play', 'pause', 'stop', 'setVolume', 'setMuted'];
    if (queue.length > 1) controls.splice(3, 0, 'prev', 'next');

    return {
      context: {
        label: 'Live streams',
        detail: stream.tags.length > 0 ? stream.tags.join(', ') : stream.service || undefined,
        ...(queueIndex >= 0 ? { index: queueIndex, total } : {}),
        chat: streamChatContext(stream),
      },
      queue,
      queueIndex: queueIndex >= 0 ? queueIndex : undefined,
      controls,
    };
  }

  function publishStreamContext(stream: LiveStream): void {
    selectedStream = stream;
    inc.emit('stream:channel-switch', JSON.stringify(
      createStreamChannelSwitchPayload({
        streamUrl: stream.streamUrl,
        streamId: stream.streamAddr,
        title: stream.title,
        chatRelays: stream.chatRelays,
        image: stream.image,
        hostPubkey: stream.hostPubkey,
      }),
    ));
  }

  function markLoadComplete(): void {
    store.setLoading(false);
    notifyUpdate();
  }

  async function toggleActiveStreamPlayback(): Promise<void> {
    if (!runtimeSessionId) return;
    const action = runtimeState === 'playing' || runtimeState === 'loading' ? 'pause' : 'play';
    try {
      const state = await controlRuntimePlayback(runtimeSessionId, action);
      runtimeState = state?.state ?? (action === 'pause' ? 'paused' : 'loading');
    } catch (error) {
      runtimeState = 'error';
      if (activeStreamId) runtimeErrorStreamId = activeStreamId;
      console.warn('[livestream] player.control failed', error);
    }
  }

  async function releaseCurrentRuntime(): Promise<void> {
    runtimeSubscription?.close();
    runtimeSubscription = null;
    if (!runtimeSessionId) return;
    const staleSessionId = runtimeSessionId;
    runtimeSessionId = null;
    await releaseRuntimePlayback(staleSessionId).catch((error) => {
      console.warn('[livestream] player.release failed', error);
    });
  }

  // ── Initialize on mount ────────────────────────────────────────────────────
  onMount(() => {
    try {
      sub = relay.subscribe(
        { kinds: [30311], limit: 100 },
        (result) => {
          const event = result.event as NostrEvent;
          const stream = parseKind30311(event);
          if (stream != null) {
            store.addStream(stream);
            notifyUpdate();
          }
        },
        markLoadComplete,
      );
    } catch (error) {
      console.warn('[livestream] relay.subscribe failed', error);
      markLoadComplete();
    }

    // Pull-on-mount responder: chat napp requests current stream context (D-18, Pitfall 6)
    try {
      contextSub = inc.on('stream:current-context-get', (event) => {
        inc.emit('stream:current-context', JSON.stringify(
          createStreamCurrentContextPayload(
            selectedStream
              ? { streamAddr: selectedStream.streamAddr, title: selectedStream.title, chatRelays: selectedStream.chatRelays }
              : { streamAddr: null, title: null, chatRelays: [] },
            event.payload,
          ),
        ));
      });
    } catch (error) {
      console.warn('[livestream] stream context responder unavailable', error);
    }
  });

  // ── Cleanup on destroy ─────────────────────────────────────────────────────
  onDestroy(() => {
    sub?.close();
    clearInterval(pollInterval);
    contextSub?.close();
    void releaseCurrentRuntime();
  });

  // ── Poll for store mutations from relay callbacks ──────────────────────────
  let pollInterval: ReturnType<typeof setInterval>;
  onMount(() => {
    pollInterval = setInterval(() => {
      notifyUpdate();
    }, 500);
  });

  // ── Stream selection ───────────────────────────────────────────────────────

  async function handleSelectStream(stream: LiveStream): Promise<void> {
    if (requestInFlight) return;
    publishStreamContext(stream);
    if (activeStreamId === stream.id && runtimeSessionId) {
      await toggleActiveStreamPlayback();
      return;
    }

    requestInFlight = true;
    runtimeErrorStreamId = null;
    activeStreamId = stream.id;
    runtimeState = 'loading';
    runtimeSubscription?.close();
    runtimeSubscription = null;
    runtimeSessionId = null;
    try {
      const playbackQueue = buildStreamQueue(stream);
      const result = await requestRuntimePlayback({
        url: stream.streamUrl,
        kind: 'hls',
        title: stream.title,
        artist: stream.service || undefined,
        album: 'Live streams',
        artworkUrl: stream.image || undefined,
        aspectRatio: 16 / 9,
        context: playbackQueue.context,
        queue: playbackQueue.queue,
        queueIndex: playbackQueue.queueIndex,
        capabilities: playbackQueue.controls,
        autoplay: true,
        live: true,
      });
      runtimeSessionId = result.sessionId;
      runtimeState = result.state?.state ?? 'loading';
      const sessionId = result.sessionId;
      runtimeSubscription = subscribeRuntimePlayback(sessionId, (state) => {
        if (runtimeSessionId !== sessionId) return;
        if (!state) {
          activeStreamId = null;
          runtimeState = null;
          runtimeSessionId = null;
          runtimeSubscription?.close();
          runtimeSubscription = null;
          return;
        }
        runtimeState = state.state;
      });
    } catch (error) {
      runtimeErrorStreamId = stream.id;
      runtimeState = 'error';
      console.warn('[livestream] player.requestPlayback failed', error);
    } finally {
      requestInFlight = false;
    }
  }
</script>

<div class="app h-screen w-screen overflow-hidden bg-bg-base text-text-primary font-mono">
  <!-- Header bar -->
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border-dim flex-shrink-0">
    <span class="text-accent-green text-sm font-mono">&gt; streams</span>
    <div class="flex-1"></div>
    {#if selectedStream}
      <span class="text-text-dim text-xs truncate max-w-40">playing: {selectedStream.title}</span>
    {/if}
    <button
      type="button"
      class="nsfw-toggle text-xs font-mono px-2 py-0.5 rounded border transition-colors {showNsfw ? 'border-accent-green text-accent-green' : 'border-border-dim text-text-dim hover:text-text-primary'}"
      aria-pressed={showNsfw}
      title="Show #nsfw streams"
      onclick={() => { showNsfw = !showNsfw; }}
    >
      NSFW
    </button>
    {#if loading}
      <span class="text-text-dim text-xs animate-pulse">scanning...</span>
    {:else}
      <span class="text-text-dim text-xs">{visibleStreams.length} live</span>
    {/if}
  </div>

  <!-- Stream list -->
  <div class="overflow-hidden" style="height: calc(100vh - 41px);">
    <StreamList
      streams={visibleStreams}
      {loading}
      activeStreamId={activeStreamId}
      playbackState={runtimeState}
      errorStreamId={runtimeErrorStreamId}
      disabled={requestInFlight}
      onselect={(stream) => { void handleSelectStream(stream); }}
    />
  </div>
</div>
