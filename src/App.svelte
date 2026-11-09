<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createStreamStore, parseKind30311, streamPhase } from './lib/stream-store';
  import { subscribeProfileMetadata, type ProfileContent } from './lib/profile-metadata';
  import { streamChatContext } from './lib/stream-chat-context';
  import type { LiveStream } from './lib/stream-store';
  import type { NostrEvent } from 'nostr-tools/core';
  import { relay, inc, type Subscription } from '@napplet/sdk';
  import {
    controlRuntimePlayback,
    createProfileIntentRequest,
    createStreamChannelSwitchPayload,
    createStreamCurrentContextPayload,
    hasNsfwTag,
    invokeNappletIntent,
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

  // Phases depend on the clock (a quiet "live" stream goes stale), so it ticks with the poll.
  let now = $derived.by(() => {
    version;
    return Math.floor(Date.now() / 1000);
  });
  let liveStreams = $derived(visibleStreams.filter((stream) => streamPhase(stream, now) === 'live'));
  let upcomingStreams = $derived(
    visibleStreams
      .filter((stream) => streamPhase(stream, now) === 'upcoming')
      .sort((a, b) => (a.starts ?? Number.MAX_SAFE_INTEGER) - (b.starts ?? Number.MAX_SAFE_INTEGER)),
  );
  let endedStreams = $derived(visibleStreams.filter((stream) => streamPhase(stream, now) === 'ended'));

  // ── Host profiles ──────────────────────────────────────────────────────────
  let profiles = $state<Map<string, ProfileContent>>(new Map());
  const requestedProfiles = new Set<string>();
  const profileSubscriptions: Subscription[] = [];

  $effect(() => {
    const missing = [...new Set(streams.map((stream) => stream.hostPubkey))]
      .filter((pubkey) => !requestedProfiles.has(pubkey));
    if (missing.length === 0) return;
    for (const pubkey of missing) requestedProfiles.add(pubkey);
    profileSubscriptions.push(subscribeProfileMetadata(missing, (pubkey, profile) => {
      profiles = new Map(profiles).set(pubkey, profile);
    }));
  });

  function openHost(pubkey: string): void {
    const request = createProfileIntentRequest({ pubkey });
    if (!request) return;
    void invokeNappletIntent(request).catch((error) => {
      console.warn('[livestream] profile open failed', error);
    });
  }

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
    // Replays and upcoming streams don't belong in the next/previous of what's live.
    const playable = streams.filter((candidate) => candidate.streamUrl && streamPhase(candidate, now) === 'live');
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
    for (const subscription of profileSubscriptions) subscription.close();
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
      const isLive = streamPhase(stream, now) === 'live';
      const result = await requestRuntimePlayback({
        url: stream.streamUrl,
        kind: stream.streamUrl.toLowerCase().includes('.m3u8') ? 'hls' : 'video',
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
        live: isLive,
      });
      runtimeSessionId = result.sessionId;
      runtimeState = result.state?.state ?? 'loading';
      const sessionId = result.sessionId;
      runtimeSubscription = subscribeRuntimePlayback(sessionId, (state) => {
        if (runtimeSessionId !== sessionId) return;
        // A stopped stream is selected again with a fresh runtime request.
        // Pause remains resumable; stopped is not a protocol deletion signal.
        if (!state || state.state === 'idle' || state.state === 'ended' || state.state === 'error') {
          // The player drops back to idle when a source never loads. Say so on the card,
          // otherwise a failed stream just looks like nothing happened.
          const neverStarted = runtimeState === 'loading' && state?.state === 'idle';
          runtimeErrorStreamId = state?.state === 'error' || neverStarted ? activeStreamId : null;
          selectedStream = null;
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
  <header class="flex items-center gap-2 px-3 py-2 border-b border-border-dim flex-shrink-0">
    <h1 class="app-title">Streams</h1>
    {#if loading}
      <span class="text-text-muted text-xs animate-pulse">Looking for streams…</span>
    {:else}
      <span class="text-text-muted text-xs">{liveStreams.length} live</span>
    {/if}
    <div class="flex-1"></div>
    {#if selectedStream}
      <span class="text-text-muted text-xs truncate watching">Watching: {selectedStream.title}</span>
    {/if}
    <button
      type="button"
      class="nsfw-toggle text-xs font-mono px-2 py-0.5 rounded border transition-colors flex-none {showNsfw ? 'border-accent-green text-accent-green' : 'border-border-dim text-text-muted hover:text-text-primary'}"
      aria-pressed={showNsfw}
      aria-label="Show NSFW streams"
      title={showNsfw ? '#nsfw streams are showing' : '#nsfw streams are hidden'}
      onclick={() => { showNsfw = !showNsfw; }}
    >
      NSFW {showNsfw ? 'on' : 'off'}
    </button>
  </header>

  <div class="overflow-hidden" style="height: calc(100vh - 41px);">
    <StreamList
      live={liveStreams}
      upcoming={upcomingStreams}
      ended={endedStreams}
      {loading}
      {now}
      {profiles}
      activeStreamId={activeStreamId}
      playbackState={runtimeState}
      errorStreamId={runtimeErrorStreamId}
      disabled={requestInFlight}
      onselect={(stream) => { void handleSelectStream(stream); }}
      onhost={openHost}
    />
  </div>
</div>

<style>
  .app-title {
    margin: 0;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
  }

  .watching {
    min-width: 0;
    max-width: 40%;
  }
</style>
