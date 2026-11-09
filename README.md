<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `stream` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# Stream

Browses NIP-53 live activities (kind 30311): what's live now, what's coming up and what's
ended, and plays them through the shell's player. Selecting a stream tells Live Chat which
conversation to show.

Package: `@hyprgate/napp-stream`. Source lives in the Hyprgate monorepo at `napplets/stream`.
The standalone `hyprgate/napplet-stream` repository is a generated, read-only mirror, so send
changes to `hyprgate/web`.

## How streams get sorted

- `planned` is **Upcoming** and can't be played yet.
- `live` is **Live now**. A live event with no update for an hour goes under **Ended**, which
  NIP-53 lets clients do, but it stays playable in case it's still going.
- `ended` is **Ended**, and it's playable only if it has a `recording` tag.

Chat addresses use the event author's pubkey, as NIP-53 says, even when a `p` tag names a
different host. The card shows the host.

## Runtime playback lifecycle

The shell owns playback. Selecting Radio in the same workspace releases the
live-stream session and video pane before the radio starts. Streams observes
the runtime subscription, clears its playing label and chat selection when
playback stops, and requests a fresh session when the stream is selected again.
Pausing keeps the selection and resumes the same session. If the player reports
an error, the card says so and a click tries again.

The shared playback adapter preserves NAP-MEDIA `stopped` as a stopped/idle
state, not a generic deletion notification. Stream selection reset is app
behavior; other consumers may retain and resume stopped sessions. Queued
autoplay is reported as loading until the shell media element attaches.

## Working on it

Run these from the Hyprgate checkout so `workspace:*` packages resolve:

```bash
pnpm install --frozen-lockfile
pnpm --filter ./napplets/stream paja        # Kehto Paja plus the Vite dev server
pnpm --filter ./napplets/stream exec vitest run
pnpm --filter ./napplets/stream type-check
pnpm --filter ./napplets/stream conformance # builds, then checks dist/
```
