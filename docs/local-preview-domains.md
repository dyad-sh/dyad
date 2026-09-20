# Local preview domains

Each app has a stable preview hostname: `app-<numeric app ID>.localhost`.
For example, app 42 opens at `http://app-42.localhost:42142`. Renaming the app
keeps its hostname. Dyad retains the existing port allocation and chooses a
fallback port if its preferred port is occupied. No hosts-file or DNS setup is
required for Chromium browser navigation.

The proxy listens on `127.0.0.1` and accepts only its own hostname and bound
port. Cookies forwarded by the proxy have their `Domain` attribute removed,
including cookie deletion responses. These host-only cookies separate app
sessions; cookies still span ports on the same app hostname. Apps retain the
existing iframe restrictions and capability-token checks.

## Existing sessions and storage

Users start signed out at the new origins. Dyad leaves old `localhost` cookies
and storage untouched and does not copy them because app ownership is ambiguous.
Local storage, IndexedDB, caches, and service workers begin fresh at the new
origin. Recording cleanup clears the selected preview origin's storage and
cookies for its exact app hostname. Other apps keep their sessions.

## Neon Auth

For connected apps with Neon Auth enabled, Dyad registers the exact preview
origin, including HTTP and the actual port, on the active runtime branch before
publishing preview readiness. Temporary recording/test branches receive their
own registration. No wildcard allowlist entry is added; deployed domains keep
their existing normalization.

Registration waits at most 10 seconds, including credential acquisition. An
ordinary preview still opens on failure, with a persistent warning and a
**Restart and retry** action. Isolated recordings/tests that require Neon Auth
stop with a setup error and restore their normal environment instead.

Dyad-launched Playwright processes use a generated Node preload to resolve only
the hostname in their validated `DYAD_TEST_BASE_URL` to `127.0.0.1`. This also
supports Playwright API requests on systems whose DNS resolver does not resolve
`.localhost`. Existing `NODE_OPTIONS` and all other DNS lookups are preserved.

Cloud previews use the app's local proxy hostname inside Dyad. Cloud sharing
continues to use the remote share link.
