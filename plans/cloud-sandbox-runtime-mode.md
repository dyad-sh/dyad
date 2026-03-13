# Cloud Sandbox Runtime Mode for Dyad Pro

> Generated on 2026-03-12

## Summary

Add a third runtime mode, `cloud-sandbox`, alongside the existing local host default and Docker modes. Dyad Pro members can select it in Settings, and when an app is run or restarted Dyad will package the local app, send it to Dyad Engine, and let the engine create, update, and destroy an isolated remote sandbox that serves the preview.

This is intentionally narrower than the broader cloud-host architecture work: v1 changes only the app runtime/preview path. Editing, local files, git, and the main chat flow remain desktop-local.

## Problem Statement

Today runtime execution is limited to:

- `host`: run the app directly on the local machine
- `docker`: run the app in a local Docker container

That leaves a gap for Pro users who want a clean remote runtime without depending on local Node setup or Docker Desktop. We need a Dyad-managed runtime mode that feels like a first-class preview target, is visibly remote, and keeps local editing semantics intact.

## Product Principles Alignment

- `Backend-Flexible`: this adds a third runtime backend without changing app/project semantics.
- `Productionizable`: the generated app remains standard code; the sandbox is only an execution environment.
- `Transparent Over Magical`: the UI must clearly label remote runtime state, sync status, and sandbox errors.
- `Bridge, Don’t Replace`: this complements local host and Docker instead of replacing them.

## Goals

- Allow Dyad Pro members to choose `Cloud Sandbox` as runtime mode.
- Provision a remote sandbox through Dyad Engine on first run.
- Update the sandbox when the local app changes and the user reruns/restarts.
- Destroy the sandbox when the user stops the app, switches away from cloud mode, deletes the app, or explicitly resets.
- Surface remote preview URL, sync state, and failure reasons in the existing preview/runtime UX.

## Non-Goals

- Full cloud workspace editing or remote filesystem as source of truth.
- Multi-device cloud project continuity.
- Long-lived shared sandboxes or collaborative sessions.
- Replacing Docker mode.

## User Experience

### Settings

In `RuntimeModeSelector`, show:

- `Local (default)` -> `host`
- `Docker (experimental)` -> `docker`
- `Cloud Sandbox (Pro)` -> `cloud-sandbox`

Behavior:

- If the user is not entitled to Pro, the option is disabled and links to Dyad Pro upgrade/setup.
- If the user was previously on `cloud-sandbox` and entitlement is lost, Dyad falls back to `host` and shows a toast.
- The description text explains that code remains local but preview runs in a Dyad-managed remote sandbox.

### Run / Restart

When runtime mode is `cloud-sandbox`:

1. User clicks Run or Restart.
2. Dyad computes a source snapshot hash for the app directory.
3. Dyad uploads the snapshot only if the hash changed or sandbox config changed.
4. Dyad calls Dyad Engine to create or update the sandbox.
5. Preview panel shows `Provisioning cloud sandbox`, then `Syncing files`, then `Starting preview`.
6. When ready, the preview iframe keeps using Dyad's stable proxy server URL.
7. If the user opens the preview in a new window/tab, Dyad uses the remote preview URL directly.

### Stop / Mode Switch / App Delete

- `Stop app` destroys the sandbox, not just the running process.
- Switching runtime mode away from `cloud-sandbox` triggers best-effort sandbox destroy.
- Deleting an app or full reset also destroys its sandbox if present.

### Error States

- Entitlement missing: `Cloud Sandbox requires Dyad Pro`.
- Provision failure: show engine error plus request id.
- Sync failure: show which phase failed (`upload`, `extract`, `install`, `start`).
- Preview unavailable: show sandbox status and retry CTA.

## Data Model and Contracts

### Settings

Extend `RuntimeMode2Schema` from `["host", "docker"]` to `["host", "docker", "cloud-sandbox"]`.

Related UI/settings touchpoints:

- `src/lib/schemas.ts`
- `src/main/settings.ts`
- `src/components/RuntimeModeSelector.tsx`
- `src/i18n/locales/en/settings.json`
- `src/lib/settingsSearchIndex.ts`
- debug bundle schema in `src/ipc/types/misc.ts`

### App-local Sandbox Metadata

Add persisted metadata for the current app’s remote runtime binding. This should live with app runtime metadata, not in user settings, because sandboxes are app-specific.

Proposed shape:

```ts
type CloudSandboxRuntime = {
  sandboxId: string;
  status:
    | "creating"
    | "syncing"
    | "installing"
    | "starting"
    | "ready"
    | "failed"
    | "destroying";
  previewUrl: string | null;
  sourceHash: string | null;
  region: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  requestId: string | null;
};
```

This can be added either to the app table as a JSON column or to a dedicated runtime table. A dedicated table is cleaner if more runtime backends are expected.

## Desktop Implementation Plan

### Phase 1: Contracts and Settings

1. Extend the runtime mode enum and settings UI for `cloud-sandbox`.
2. Gate selection on both:
   - local signal: `settings.enableDyadPro`
   - server signal: valid Pro entitlement from existing budget/account fetch
3. Add copy explaining remote execution and Pro requirement.

### Phase 2: Engine Client and IPC Surface

Add a small cloud-sandbox service in the main process. Do not call the engine directly from the renderer.

Recommended shape:

- `src/ipc/types/app.ts` or a new `runtime.ts` contract:
  - `getCloudSandboxStatus(appId)`
  - `destroyCloudSandbox(appId)`
- main-process service:
  - `src/ipc/services/cloud_sandbox_runtime.ts`

Responsibilities:

- build source snapshot
- upload bundle
- call create/update/destroy endpoints
- persist sandbox metadata
- map engine state into existing running-app events
- point the existing proxy server at the remote preview target so the in-app preview URL stays stable

This should follow the contract-driven IPC pattern in `rules/electron-ipc.md`.

### Phase 3: Execution Path Integration

Update `src/ipc/handlers/app_handlers.ts` so `executeApp()` dispatches:

- `host` -> existing `executeAppLocalNode()`
- `docker` -> existing `executeAppInDocker()`
- `cloud-sandbox` -> new `executeAppInCloudSandbox()`

`executeAppInCloudSandbox()` should:

1. Read app record and commands.
2. Build a filtered tarball/zip of the app directory.
3. Exclude `node_modules`, build output, `.git`, OS junk, and existing temp archives.
4. Compute `sourceHash`.
5. Reuse existing sandbox if `sandboxId` exists; otherwise create one.
6. If hash/config changed, upload and update.
7. Poll or subscribe until the sandbox is `ready`.
8. Point the existing proxy server at the remote preview URL for the in-app preview.
9. Publish preview/running status back through existing app events.

### Phase 4: Cleanup Semantics

Hook sandbox destroy into:

- stop app
- restart app before reprovision if the engine requires replace semantics
- delete app
- reset everything
- runtime mode switch away from cloud

`Stop` should always hard-destroy the cloud sandbox in v1.

Best-effort cleanup is acceptable on app quit, but server-side TTL cleanup should exist as a safety net.

## Packaging and Sync Strategy

For MVP, use full-app snapshot upload on run/restart. Do not attempt rsync-style deltas initially.

Bundle rules:

- include the app working tree under the Dyad app directory
- include the app `.env` file so cloud preview matches local preview semantics
- exclude:
  - `node_modules`
  - `.git`
  - `.next`, `dist`, `build`, `.vite`
  - temporary files
  - large editor caches

Environment parity:

- do not add a separate cloud sandbox env var configuration UI in v1
- stream the local app `.env` file as part of the uploaded snapshot for parity
- treat `.env` as part of the sensitive source bundle and avoid logging its contents

Sync decision:

- if no sandbox exists: create + upload
- if `sourceHash` changed: upload + update
- if commands/env/runtime spec changed: update
- otherwise: optionally reuse running sandbox

Follow-up optimization:

- file manifest + changed-file upload
- package-manager-aware dependency cache reuse

## Dyad Engine: Express Server Definition

Dyad Engine already uses bearer auth for Pro features. Reuse that.

### Auth and Middleware

- `Authorization: Bearer <dyad-pro-api-key>`
- `X-Dyad-Request-Id: <uuid>`
- middleware resolves:
  - authenticated user
  - Pro entitlement
  - rate-limit bucket
  - request/correlation id

If entitlement is missing, return `403`.

### Public API

#### `POST /v1/cloud-sandboxes`

Create a sandbox.

Request:

```json
{
  "appId": 123,
  "appName": "my-app",
  "runtime": {
    "installCommand": "pnpm install",
    "startCommand": "pnpm dev",
    "nodeVersion": "24",
    "packageManager": "pnpm"
  },
  "source": {
    "uploadId": "upl_123",
    "hash": "sha256:abc"
  }
}
```

Response:

```json
{
  "sandboxId": "sbx_123",
  "status": "creating",
  "previewUrl": null,
  "region": "us-central1",
  "correlationId": "req_123"
}
```

#### `PATCH /v1/cloud-sandboxes/:sandboxId`

Update sandbox contents and/or runtime config.

Request:

```json
{
  "source": {
    "uploadId": "upl_124",
    "hash": "sha256:def"
  },
  "runtime": {
    "installCommand": "pnpm install",
    "startCommand": "pnpm dev"
  },
  "restart": true
}
```

Response:

```json
{
  "sandboxId": "sbx_123",
  "status": "syncing",
  "previewUrl": null,
  "correlationId": "req_124"
}
```

#### `GET /v1/cloud-sandboxes/:sandboxId`

Fetch current status.

Response:

```json
{
  "sandboxId": "sbx_123",
  "status": "ready",
  "previewUrl": "https://preview.engine.dyad.sh/sbx_123/",
  "sourceHash": "sha256:def",
  "region": "us-central1",
  "lastError": null,
  "updatedAt": "2026-03-12T18:00:00.000Z"
}
```

#### `DELETE /v1/cloud-sandboxes/:sandboxId`

Destroy the sandbox.

Response:

```json
{
  "sandboxId": "sbx_123",
  "status": "destroying",
  "correlationId": "req_125"
}
```

#### `GET /v1/cloud-sandboxes/:sandboxId/events`

SSE stream for lifecycle updates.

Event types:

- `sandbox.status`
- `sandbox.log`
- `sandbox.ready`
- `sandbox.failed`
- `sandbox.destroyed`

Event payload example:

```json
{
  "type": "sandbox.status",
  "sandboxId": "sbx_123",
  "status": "installing",
  "message": "Running pnpm install",
  "timestamp": "2026-03-12T18:00:00.000Z"
}
```

### Upload Flow

To keep the lifecycle endpoints clean, use a separate upload step.

#### `POST /v1/cloud-sandbox-uploads`

Returns a short-lived upload target.

Request:

```json
{
  "appId": 123,
  "fileName": "app.tar.gz",
  "contentType": "application/gzip",
  "sizeBytes": 10485760,
  "hash": "sha256:def"
}
```

Response:

```json
{
  "uploadId": "upl_124",
  "uploadUrl": "https://storage.example.com/...",
  "expiresAt": "2026-03-12T18:05:00.000Z"
}
```

## Engine Internal Design

Keep the Express layer thin. It should validate/authenticate, then delegate to sandbox services.

Suggested modules:

- `cloudSandboxRoutes`
- `cloudSandboxController`
- `cloudSandboxService`
- `cloudSandboxRepository`
- `cloudSandboxProvisioner`
- `cloudSandboxEvents`
- `uploadService`

Suggested state machine:

- `creating`
- `syncing`
- `installing`
- `starting`
- `ready`
- `failed`
- `destroying`
- `destroyed`

Persistence fields:

- `sandboxId`
- `userId`
- `appId`
- `status`
- `region`
- `sourceHash`
- `previewUrl`
- `runtimeSpecJson`
- `lastError`
- `expiresAt`
- `createdAt`
- `updatedAt`

Operational rules:

- one active sandbox per `(userId, appId)` for MVP
- `POST` is rejected or treated as conflict if one already exists
- `PATCH` is idempotent on `sandboxId + source.hash`
- environment parity comes from the uploaded snapshot, including `.env`, rather than a separate env API in v1
- inactive sandboxes get server-side TTL cleanup
- all lifecycle transitions emit events

## Security and Policy

- Reuse Dyad Pro bearer auth; do not trust renderer-side Pro flags.
- Enforce one sandbox quota per app and plan-level limits per user.
- Treat uploaded `.env` contents as sensitive and never include them in logs, error payloads, or telemetry.
- Preview URLs should be proxied/isolated under an engine-controlled domain.
- Return request ids in all failures for support/debugging.

## Testing Plan

### Desktop

- unit tests for runtime mode gating and fallback behavior
- unit tests for source bundle filtering/hash decisions
- integration tests for app handler dispatching to cloud mode
- E2E:
  - Pro user can select Cloud Sandbox mode
  - non-Pro user cannot
  - run app provisions remote preview
  - restart after code change triggers update
  - stop destroys sandbox

### Desktop E2E Strategy

Use the existing packaged Electron Playwright flow, not a real cloud dependency.

The repo already sets `DYAD_ENGINE_URL` to a worker-local fake server in [fixtures.ts](/Users/will/Documents/GitHub/dyad-zero/e2e-tests/helpers/fixtures.ts), so the cloud sandbox flow should be tested against deterministic fake engine endpoints.

Recommended spec layout:

- `e2e-tests/cloud_sandbox_runtime.spec.ts`

Recommended coverage is one broad happy-path spec plus one gating spec.

#### Spec 1: Pro user can run and stop in Cloud Sandbox mode

Flow:

1. Call `po.setUpDyadPro()`.
2. Navigate to Settings.
3. Select `Cloud Sandbox (Pro)` in runtime mode.
4. Assert settings persisted `runtimeMode2: "cloud-sandbox"`.
5. Navigate back to Apps and run an app.
6. Fake engine accepts upload and sandbox create, then transitions through `creating` -> `syncing` -> `ready`.
7. Assert the in-app preview iframe becomes visible.
8. Assert the in-app preview uses the stable local proxy URL, not the remote preview URL directly.
9. Click `Open in Browser`.
10. Assert the opened target uses the remote preview URL returned by the fake engine.
11. Stop the app.
12. Assert Dyad calls `DELETE /v1/cloud-sandboxes/:sandboxId`.

Assertions:

- UI shows cloud runtime is selected.
- The preview becomes available.
- The proxy URL remains stable for the iframe.
- Open-in-browser targets the remote preview URL.
- Sandbox destroy happens on stop.

#### Spec 2: Non-Pro user cannot use Cloud Sandbox mode

Flow:

1. Use normal `po.setUp()` without Dyad Pro setup.
2. Navigate to Settings.
3. Assert `Cloud Sandbox (Pro)` is disabled or upgrade-gated.
4. Optionally assert that persisted settings do not change to `cloud-sandbox`.

This should stay small and focused on entitlement gating.

#### Fake Engine Requirements

Extend the worker-local fake HTTP server used in E2E to support:

- `POST /engine/v1/cloud-sandbox-uploads`
- `POST /engine/v1/cloud-sandboxes`
- `GET /engine/v1/cloud-sandboxes/:sandboxId`
- `DELETE /engine/v1/cloud-sandboxes/:sandboxId`

Optional if the implementation uses streaming:

- `GET /engine/v1/cloud-sandboxes/:sandboxId/events`

The fake server should:

- keep requests in memory for assertions
- return deterministic IDs and URLs
- simulate status progression in a predictable way
- avoid any real network or cloud dependency

Suggested deterministic values:

- `uploadId: "upl_test_1"`
- `sandboxId: "sbx_test_1"`
- `previewUrl: "https://preview.engine.test/sbx_test_1/"`
- proxy URL remains whatever Dyad normally uses locally for the preview iframe

#### Suggested Test Helpers

Add lightweight page-object helpers if needed:

- `settings.selectRuntimeMode("cloud-sandbox")`
- `settings.snapshotSettingsDelta(...)`
- `previewPanel.expectPreviewIframeSrcContains(...)`
- helper to capture the external URL passed to `openExternalUrl`

If `openExternalUrl` is difficult to observe in Playwright, add a test-only hook that records the last external URL request in a deterministic place the test can read.

#### Why this E2E shape

- It validates the actual desktop integration points: settings, app run/stop flow, preview behavior, and engine contract usage.
- It avoids brittle deep mocking in renderer-only tests.
- It keeps coverage aligned with the repo’s E2E rule to prefer one or two broad scenarios instead of many narrow tests.

### Engine

- route contract tests
- auth/entitlement tests
- state machine tests
- upload expiry tests
- failure-path tests for create/update/destroy

## Rollout Plan

### Phase A: Internal flag

- Engine endpoints behind server feature flag.
- Desktop UI option hidden except for internal/test accounts.

### Phase B: Pro beta

- Enable for Dyad Pro users on desktop.
- Limit to one sandbox per app and one region.
- Capture provisioning time, restart time, failure rate, and cleanup success.

### Phase C: General Pro release

- Turn on broadly after provisioning and preview stability are acceptable.
- Consider adding warm sandbox reuse and better diff sync.

## Open Questions

1. Should the local proxy automatically retry and rebind if the remote preview process restarts inside an otherwise healthy sandbox?
2. Should v1 stream only root `.env`, or also `.env.local` and mode-specific variants for stricter local parity?
3. Do we need an explicit max snapshot size guardrail before beta?
