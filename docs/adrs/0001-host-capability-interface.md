# ADR-0001: Host Capability Interface

- Status: Proposed
- Date: 2026-02-15
- Owners: Platform Core
- Related plan: `plans/desktop-mobile-web-unification.md`

## Context

Coney currently routes privileged actions through Electron IPC (`src/preload.ts`, `src/ipc/types/*`, `src/ipc/handlers/*`). This tightly couples product logic to desktop-only primitives:

- local filesystem access
- local process execution
- local git and shell operations
- desktop-only OS/system APIs

Web and mobile clients cannot reuse this runtime model directly. We need one product core that can run against multiple execution hosts:

- desktop local host
- cloud host

## Decision

Adopt a host capability interface as the canonical execution boundary for privileged operations.

The shared product core will depend on a `HostProvider` contract, not directly on Electron IPC channels or HTTP endpoints.

### Interface shape

`HostProvider` exposes capability groups:

- `project`: read/write/rename/delete/list/search file operations
- `exec`: run/stop commands, stream logs/output
- `git`: branch/commit/status/sync operations
- `preview`: start/stop/status/getPreviewUrl
- `integration`: provider-specific operations (supabase/vercel/neon/mcp)
- `system`: optional host/system functions (open external URL, show in folder, clipboard/screenshot)
- `session`: session cache/state controls

Each operation must include a standard envelope:

- `workspaceId`
- `projectId`
- `requestId`
- `idempotencyKey`
- `actor` (user/system/assistant)
- `timestamp`

Each operation returns:

- success payload OR typed error payload
- `correlationId` for tracing

### Streaming model

Streaming operations must follow a uniform event contract:

- `start`
- `chunk`
- `end`
- `error`

Desktop provider maps this to IPC streams; cloud provider maps this to WebSocket/SSE streams.

### Capability negotiation

Hosts must declare supported capabilities at runtime (for example `supportsProcess`, `supportsNativeDialogs`, `supportsShowItemInFolder`), and UI/features must gate behavior accordingly.

## Consequences

### Positive

- Enables shared domain logic across desktop/web/mobile.
- Prevents transport-specific logic from leaking into features.
- Creates deterministic observability across hosts.
- Simplifies adding future hosts.

### Negative

- Requires incremental refactor of existing IPC handlers and call sites.
- Adds short-term complexity with compatibility adapters.
- Requires strict contract/version governance.

## Alternatives Considered

### A. Keep Electron IPC as primary and build web/mobile translators

Rejected because it preserves desktop coupling and creates brittle emulation layers.

### B. Build separate APIs per platform

Rejected because it duplicates business logic and causes long-term behavior drift.

### C. Move everything to cloud and remove local mode

Rejected for now because it breaks existing local-first desktop workflows.

## Rollout Plan

1. Introduce interface and adapter layers in shared packages.
2. Wrap desktop local flows with `ElectronLocalHostProvider`.
3. Migrate critical flows first: chat stream, response apply, app run/stop, git core.
4. Enforce host capability checks in UI.
5. Add `CloudHostProvider` for desktop cloud mode, then web/mobile.

## Acceptance Criteria

- Desktop local mode behavior remains functionally equivalent on migrated flows.
- At least one end-to-end flow runs through both providers with identical domain behavior.
- Stream contracts are transport-agnostic and versioned.

## Open Questions

1. Should integration-specific capabilities be in `integration.*` or split into first-class capability groups?
2. What is the minimum backward compatibility window for provider contract versions?
