// packages/types/src/sandbox.ts
// Iframe sandbox attribute value constants.
//
// Napps run with an opaque "null" origin — no direct IndexedDB, localStorage,
// sessionStorage, or WebSocket access. Storage is proxied through the shell via
// postMessage (storage-proxy / storage-shim). Identity is based on NIP-5A
// aggregate hash, not persistent keypairs — ephemeral in-memory keys are
// generated fresh on every load and the shell verifies them against the napp's
// published manifest.

/**
 * Sandbox policy for built-in napplets (production nsite URLs).
 * Canonical NIP-5D requires srcdoc napplet iframes to run with allow-scripts
 * and without allow-same-origin. Extra sandbox tokens require an explicit
 * shell policy path and must not be added to this default.
 */
export const SANDBOX_BUILTIN = 'allow-scripts' as const;

/**
 * Default NUB-CLASS-1 CSP for shell-owned built-in napplet delivery.
 *
 * Class-1 napplets cannot make direct network requests; all networked Nostr
 * and storage behavior must go through shell services.
 */
export const NUB_CLASS_1_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "prefetch-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ') as string;

/**
 * Sandbox policy for external / untrusted napplets.
 * Same as SANDBOX_BUILTIN for now; extend only on verified need.
 */
export const SANDBOX_EXTERNAL = SANDBOX_BUILTIN;
