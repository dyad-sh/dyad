# Sandbox Engine Implementation Plan

> Drafted on 2026-03-13

## Summary

This document scopes the Dyad Engine work needed to support the new cloud sandbox runtime mode in the desktop app.

The desktop app now has a client-side cloud execution path:

- `runtimeMode2: "cloud"`
- sandbox provisioning via Dyad Engine
- remote preview proxying through the local Dyad proxy
- shareable preview links in the preview toolbar
- batched file sync for `editAppFile`
- E2E coverage against a fake engine

What remains is the real backend implementation: authenticated sandbox lifecycle management, file upload, log streaming, usage limits, and cleanup.

## Goals

- Provide a stable Dyad Engine API for cloud sandbox creation and teardown.
- Keep provider-specific details out of the desktop app.
- Enforce Dyad Pro access and usage limits server-side.
- Preserve Dyad’s current preview model:
  - proxied URL for the iframe
  - direct URL for sharing and opening externally
- Make failures explicit and actionable.

## Non-Goals

- Supporting multiple sandbox providers in v1
- Persisting sandboxes long-term across devices
- Billing dashboards or detailed usage analytics
- Environment variable passthrough for arbitrary app secrets
- Production deployment concerns beyond preview sandboxes

## Current Client Contract

The desktop app currently expects these Dyad Engine endpoints under `DYAD_ENGINE_URL`:

- `POST /sandboxes`
- `DELETE /sandboxes/:sandboxId`
- `POST /sandboxes/:sandboxId/files`
- `GET /sandboxes/:sandboxId/logs`

Current response expectations:

### `POST /sandboxes`

Request body:

```json
{
  "appId": 123,
  "appPath": "/abs/path/to/app",
  "installCommand": "pnpm install",
  "startCommand": "pnpm run dev --port 4123"
}
```

Response body:

```json
{
  "sandboxId": "sbx_123",
  "previewUrl": "https://sandbox-preview.example.com/sbx_123"
}
```

### `POST /sandboxes/:sandboxId/files`

Request body:

```json
{
  "files": {
    "src/App.tsx": "export default function App() { return <div>Hello</div>; }"
  }
}
```

Response body:

```json
{
  "previewUrl": "https://sandbox-preview.example.com/sbx_123"
}
```

### `GET /sandboxes/:sandboxId/logs`

- SSE response
- `data: {"message":"..."}` events
- terminates with `data: [DONE]`

## Recommended Engine Architecture

### 1. Sandbox Service Layer

Add an engine-side sandbox service with a narrow interface:

```ts
interface SandboxService {
  create(input: CreateSandboxInput): Promise<CreateSandboxResult>;
  uploadFiles(
    input: UploadSandboxFilesInput,
  ): Promise<UploadSandboxFilesResult>;
  streamLogs(sandboxId: string): AsyncIterable<SandboxLogEvent>;
  destroy(sandboxId: string): Promise<void>;
  reconcileForUser(userId: string): Promise<ReconcileResult>;
}
```

This service should own:

- provider API calls
- sandbox metadata persistence
- ownership checks
- idle timeout tracking
- per-user quota enforcement

### 2. Provider Adapter

Start with a single Vercel-backed adapter behind the service:

```ts
interface SandboxProvider {
  createSandbox(...): Promise<...>;
  uploadFiles(...): Promise<...>;
  streamLogs(...): AsyncIterable<...>;
  destroySandbox(...): Promise<void>;
}
```

Even with one provider, keep this boundary. It aligns with Dyad’s backend-flexible principle and avoids leaking Vercel specifics into route handlers.

### 3. Metadata Store

Store minimal sandbox metadata in the engine:

- `sandboxId`
- `providerSandboxId`
- `userId`
- `appId`
- `status`
- `previewUrl`
- `createdAt`
- `lastActiveAt`
- `expiresAt`

This can live in the engine database or another lightweight persistent store. Persistence is needed for:

- limit checks
- orphan cleanup
- idle hibernation
- restart reconciliation

## API Plan

### Phase 1: Core Endpoints

Implement:

- `POST /sandboxes`
- `DELETE /sandboxes/:sandboxId`
- `POST /sandboxes/:sandboxId/files`
- `GET /sandboxes/:sandboxId/logs`

Requirements:

- bearer auth using Dyad Pro credentials
- reject non-Pro users with a clear 403
- validate ownership on every sandbox-scoped route
- map provider failures to stable error codes/messages

### Phase 2: Status and Reconciliation

Implement:

- `GET /sandboxes/:sandboxId/status`
- `POST /sandboxes/reconcile`

`reconcile` should:

- find stale sandboxes owned by the current user
- destroy or mark them expired
- return a count and list of cleaned-up sandbox IDs

### Phase 3: Limits and Lifecycle

Enforce:

- max 1 active sandbox per user in v1
- 15-minute inactivity timeout
- explicit destroy on desktop stop/restart
- periodic cleanup job for abandoned sandboxes

## Request Validation

Server-side validation should include:

- `appId` must be numeric
- commands must be bounded in length
- file upload payload size limits
- file path normalization
- no absolute paths in uploaded file maps
- no path traversal segments

For file uploads, normalize and reject:

- `../foo`
- `/etc/passwd`
- empty paths

## Error Model

Use stable structured errors so the desktop app can classify them later:

```json
{
  "code": "sandbox_limit_reached",
  "message": "You already have an active cloud sandbox."
}
```

Suggested codes:

- `sandbox_auth_required`
- `sandbox_pro_required`
- `sandbox_limit_reached`
- `sandbox_not_found`
- `sandbox_not_owned`
- `sandbox_provider_unavailable`
- `sandbox_create_failed`
- `sandbox_upload_failed`
- `sandbox_log_stream_failed`
- `sandbox_timeout`

## Logging and Observability

Record at minimum:

- sandbox create/destroy requests
- provider latency
- file upload counts and payload sizes
- log stream open/close/error
- quota rejections
- cleanup job actions

Add correlation fields:

- `userId`
- `sandboxId`
- `providerSandboxId`
- `appId`
- request ID

## Security Notes

- Never expose provider credentials to the desktop app.
- Treat uploaded code as untrusted input.
- Lock all sandbox mutations to the authenticated user.
- Apply payload size limits and request rate limits.
- Ensure direct preview URLs are scoped to the sandbox and not reusable across users unintentionally.

## Rollout Plan

### Step 1

Ship engine endpoints behind a feature flag or allowlist.

### Step 2

Connect a staging desktop build to staging engine and validate:

- create
- upload
- preview
- copy link
- restart
- stop
- idle cleanup

### Step 3

Turn on for internal users first, then a small Dyad Pro cohort.

## Testing Plan

### Unit Tests

- route validation
- ownership checks
- quota enforcement
- timeout calculation
- error mapping

### Integration Tests

- create sandbox then upload files
- create second sandbox for same user and verify limit rejection
- destroy sandbox and recreate successfully
- SSE log stream formatting and termination

### Manual / Staging Checks

- preview URL is reachable directly
- desktop proxy still injects expected scripts
- file sync updates the running sandbox
- destroying a sandbox invalidates future file uploads/log streams

## Open Questions

- Do we want `POST /sandboxes` to accept an initial file batch to reduce round trips?
- Should `logs` remain SSE, or is WebSocket materially better for the provider integration?
- Do we want “hibernate” semantics distinct from “destroy,” or is destroy sufficient for v1?
- Should preview URLs be public-by-link or signed/expiring?
- Where should sandbox metadata live in the engine stack?

## Suggested Next Task

Implement the engine routes with a single provider adapter and a persisted sandbox metadata table, then point a staging desktop build at that environment for end-to-end validation.
