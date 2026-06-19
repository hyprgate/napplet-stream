# hyprgate Stream Napp -- nsite Publication Workflow

This document describes how to publish the hyprgate Stream napp as an nsite on nostr using
`nsite-cli` (kind 34128 file manifests) and a manually-published kind 37348 app listing event.

> **Spec notice:** Kind 34128 (nsite manifest) is NIP PR #1538 and kind 37348 (napp listing) is
> NIP-C4 PR #2274. Both specs are **open PRs** as of 2026-03-22. Event structures documented
> here reflect the current draft. Update when either spec finalizes.

> **Note on config file naming:** nsite-cli 0.1.16 auto-discovers `project.json` by default
> and does NOT support a `--config` flag. This project uses `.nsite/config.json` by convention.
> To use `config.json` with nsite-cli, create a symlink before uploading:
> ```bash
> ln -sf config.json .nsite/project.json
> ```
> Or pass all settings via CLI flags (see Section 2 for flag-based invocation).

---

## Section 1: Prerequisites

1. **Node.js 18+** installed (`node --version`)
2. **Napp built** — produces `napplets/stream/dist/`:
   ```bash
   pnpm --filter @hyprgate/napp-stream build
   ```
3. **Private key (nsec)** for the publishing identity — this is the nostr identity that will own
   the published napp. Store it securely; never commit it to git.
4. **`.nsite/config.json` configured** with your real private key:
   ```json
   {
     "privateKey": "<your-nsec-or-hex-private-key>",
     "relays": [
       "wss://relay.damus.io",
       "wss://relay.nostr.band",
       "wss://nos.lol"
     ],
     "servers": [
       "https://nosto.re",
       "https://blossom.primal.net"
     ],
     "fallback": "/index.html"
   }
   ```
   The `.nsite/config.json` file is excluded from git via `.gitignore`. Never commit a real key.

5. **`nak` CLI** (optional, for publishing the kind 37348 listing event):
   ```bash
   go install github.com/fiatjaf/nak@latest
   # or: npx -y nak
   ```

---

## Section 2: Publishing File Manifests (kind 34128)

`nsite-cli` uploads every file in `dist/` to Blossom servers and publishes a kind 34128 event
per file. Each event maps the file path (`d` tag) to its SHA-256 hash (`x` tag).

### Command

```bash
# Run from napplets/stream/ directory (where .nsite/config.json lives)
# Step 1: Create symlink so nsite-cli can find the config
ln -sf config.json .nsite/project.json
# Step 2: Upload
npx nsite-cli@0.1.16 upload ./dist
```

**Alternative (pass all settings via flags, no symlink needed):**
```bash
npx nsite-cli@0.1.16 upload \
  -k <your-nsec-or-hex-private-key> \
  -r wss://relay.damus.io,wss://relay.nostr.band,wss://nos.lol \
  -s https://nosto.re,https://blossom.primal.net \
  --fallback index.html \
  ./dist
```

### What it does

1. Hashes every file in `dist/` using SHA-256.
2. Uploads each blob to the configured Blossom servers (`servers` in config.json).
3. Publishes a nostr event for each file:
   - **Kind:** 34128 (`KIND_NSITE_MANIFEST`)
   - **`d` tag:** file path (e.g. `/index.html`, `/assets/app.js`)
   - **`x` tag:** SHA-256 hex hash of the file content
   - **Content:** empty string

### Expected output

```
Uploading 8 files...
✓ /index.html       (sha256: a1b2c3...)
✓ /assets/app.js    (sha256: d4e5f6...)
...
Published 8 kind:34128 events to relay.damus.io, relay.nostr.band
```

### Verify publication

Visit `https://nosto.re/<sha256-of-index.html>` in a browser. The Stream napp should load.

To find the index.html hash after upload, note it in the upload output or run:
```bash
sha256sum dist/index.html
```

---

## Section 3: Publishing the Napp Listing (kind 37348)

`nsite-cli` does **not** publish the kind 37348 napp listing event. This event registers the napp
in the napp directory and must be published manually.

### Event structure

```json
{
  "kind": 37348,
  "tags": [
    ["d", "hyprgate-stream"],
    ["name", "hyprgate Stream"],
    ["description", "Livestream viewer for hyprgate"],
    ["url", "https://nosto.re/<sha256-of-index.html>"],
    ["nsite", "<hex-pubkey-of-publisher>"],
    ["web", "https://nosto.re/<sha256-of-index.html>"]
  ],
  "content": ""
}
```

Replace `<sha256-of-index.html>` with the actual SHA-256 hash from the nsite-cli upload output.
Replace `<hex-pubkey-of-publisher>` with the hex-encoded public key corresponding to your nsec.

### Publish using nak

```bash
nak event --kind 37348 \
  -t d=hyprgate-stream \
  -t "name=hyprgate Stream" \
  -t "description=Livestream viewer for hyprgate" \
  -t "url=https://nosto.re/<sha256>" \
  -t "nsite=<hex-pubkey>" \
  -t "web=https://nosto.re/<sha256>" \
  --sec <nsec> \
  wss://relay.damus.io wss://relay.nostr.band wss://nos.lol
```

### Publish using nostrtool (alternative)

```bash
nostrtool publish --kind 37348 \
  --tag d=hyprgate-stream \
  --tag "name=hyprgate Stream" \
  --tag "description=Livestream viewer for hyprgate" \
  --tag "url=https://nosto.re/<sha256>" \
  --tag "nsite=<hex-pubkey>" \
  --tag "web=https://nosto.re/<sha256>" \
  --sec <nsec>
```

---

## Section 4: Verification

### Verify file manifests (kind 34128)

Query a relay for the publisher's kind 34128 events:

```bash
nak req -k 34128 -a <hex-pubkey> wss://relay.damus.io
```

Each returned event should have a `d` tag with a file path and an `x` tag with a SHA-256 hash.

### Verify the napp listing (kind 37348)

Query for the kind 37348 event with `d` tag "hyprgate-stream":

```bash
nak req -k 37348 --tag d=hyprgate-stream wss://relay.damus.io
```

### Test in browser

1. Open `https://nosto.re/<sha256-of-index.html>` directly — the Stream napp should load.
2. Open the Hyprgate shell and add the nsite URL as a custom napp.

---

## Section 5: Updating

When Stream napp source changes, re-publish:

```bash
# 1. Rebuild
pnpm --filter @hyprgate/napp-stream build

# 2. Re-upload (nsite-cli publishes replaceable events — same d tag supersedes old events)
cd napplets/stream && ln -sf config.json .nsite/project.json && npx nsite-cli@0.1.16 upload ./dist

# 3. If index.html hash changed, republish the kind 37348 event with the new url tag
#    (copy the command from Section 3 with the updated sha256)
```

Kind 34128 events are replaceable by author+d-tag — nsite-cli handles this automatically.
The kind 37348 listing event is also replaceable (same `d` tag "hyprgate-stream") so
re-publishing supersedes the old listing without manual cleanup.

---

## Quick Reference

| Step | Command | Kind published |
|------|---------|---------------|
| Build | `pnpm --filter @hyprgate/napp-stream build` | — |
| Symlink | `ln -sf config.json .nsite/project.json` | — |
| Upload files | `npx nsite-cli@0.1.16 upload ./dist` | 34128 (per file) |
| Publish listing | `nak event --kind 37348 ...` | 37348 |
| Verify files | `nak req -k 34128 -a <pubkey> wss://relay.damus.io` | — |
| Verify listing | `nak req -k 37348 --tag d=hyprgate-stream wss://relay.damus.io` | — |
