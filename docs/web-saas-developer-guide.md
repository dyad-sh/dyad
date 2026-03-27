# ProteaAI — Web SaaS: Developer Guide

This document describes the full web SaaS conversion that was built on top of the
original ProteaAI Electron desktop app, and gives step-by-step instructions for
running it locally, testing it, and deploying it.

---

## What Was Built

ProteaAI started as a single-user Electron desktop application (React + Vite + SQLite).
The conversion layers a complete multi-tenant web SaaS platform on top of the existing
codebase without removing or breaking the Electron build.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser / Web client  (React + TanStack Router + Vite)         │
│  · Same components as Electron, with a thin IPC adapter         │
│  · JWT stored in localStorage; injected as Bearer token         │
│  · WebSocket connection for server-push streaming events        │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP + WebSocket
┌────────────────────────▼────────────────────────────────────────┐
│  Express server  (server/index.ts)                               │
│  · POST /api/:channel  → IPC handler registry (auth-gated)      │
│  · GET  /media/:app/:file → per-user media files (auth-gated)   │
│  · /auth/**  · /billing/**  · /admin/**  · /gdpr/**             │
│  · ws://host/ws  → WebSocket broadcast for streaming            │
└────────────────────────┬────────────────────────────────────────┘
                         │ SQLite (WAL mode) + filesystem
┌────────────────────────▼────────────────────────────────────────┐
│  IPC handler layer  (src/ipc/handlers/)                          │
│  · All 30+ handlers self-register in web mode via               │
│    webHandlerRegistry (instead of Electron's ipcMain)           │
│  · getCurrentUser() gives per-request user context via          │
│    AsyncLocalStorage                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## What Each Layer Does

### 1. Dual-Mode IPC (`src/ipc/handlers/base.ts`)

`enableWebMode()` is called first in `server/index.ts` (before any handler imports).
When enabled, `createTypedHandler()` pushes handlers into `webHandlerRegistry` (a plain
`Map<string, Function>`) instead of Electron's `ipcMain`. The Express bridge then routes
`POST /api/:channel` to the matching handler.

### 2. Authentication (`server/routes/auth.ts`, `server/middleware/auth.ts`)

- **Register** — `POST /auth/register` hashes password with bcrypt (12 rounds), creates
  a `users` row and a starter `free` subscription row, returns a signed JWT.
- **Login** — `POST /auth/login` verifies bcrypt hash, returns a new JWT.
- **Me** — `GET /auth/me` decodes the JWT and returns the user + current plan.
- `requireAuth` middleware — validates the JWT on every `/api/*` route and calls
  `runWithUserContext({ userId, email })` so all downstream handlers can call
  `getCurrentUser()` via `AsyncLocalStorage`.

### 3. Per-User Data Isolation

Every database query that was previously global is now scoped to the authenticated user:

| Layer | Mechanism |
|---|---|
| Apps | `apps.userId` filter on list/create; ownership check on get-by-id |
| MCP servers | `mcpServers.userId` filter; ownership check on update/delete |
| Free-agent quota | JOIN chain `messages → chats → apps` filtered by `apps.userId` |
| Settings | Encrypted JSON blob in `userSettings` table, keyed by `userId` |
| GitHub tokens | Stored in per-user settings row (AES-256-GCM encrypted) |
| AI provider keys | Stored in per-user settings row (AES-256-GCM encrypted) |
| App files on disk | `PROTEAAI_DATA_DIR/{userId}/apps/{appPath}` — each user's files are in their own directory |

### 4. Encrypted Settings (`src/main/web-settings.ts`)

`readCurrentUserSettings()` / `writeCurrentUserSettings()` replace the old global
`readSettings()` / `writeSettings()` in all 30+ handler files. In web mode, the settings
JSON blob is AES-256-GCM encrypted before being stored in the `userSettings` database
table. The key comes from the `SECRET_KEY` environment variable (falls back to a derived
key if not set).

### 5. Streaming / WebSocket Push (`server/ws_manager.ts`, `src/ipc/utils/safe_sender.ts`)

The existing `safeSend(event.sender, channel, payload)` pattern used throughout the chat
streaming handlers now has a web-mode path: when `sender` is `null`, it calls the
registered broadcaster. `setWebBroadcaster()` is called at server startup to wire
`wsManager.broadcast` as the broadcaster. The frontend connects to `ws://host/ws` and
listens for push events (chat streaming chunks, app output, etc.) the same way Electron's
`ipcRenderer.on()` works.

### 6. Billing (`server/routes/billing.ts`)

Full Stripe Checkout + Customer Portal integration:

- `POST /billing/create-checkout-session` — creates a Stripe Checkout session; on success
  Stripe redirects back and the webhook fires.
- `POST /billing/create-portal-session` — opens the Stripe Customer Portal for plan changes.
- `POST /billing/webhook` — verifies Stripe signature, handles
  `checkout.session.completed`, `customer.subscription.updated`, and
  `customer.subscription.deleted`.
- `GET /billing/subscription` — returns the current plan and status from the DB.

Stripe is optional: if `STRIPE_SECRET_KEY` is not set, the server starts fine and billing
endpoints return a "Stripe not configured" error.

### 7. Admin & GDPR Routes

- `GET /admin/users` — lists all users (requires `role = admin`).
- `POST /gdpr/export` — exports all data owned by the current user as JSON.
- `DELETE /gdpr/delete-account` — permanently deletes the user's account, apps,
  settings, and messages (GDPR right-to-erasure).

### 8. Database Schema (`src/db/schema.ts`, `drizzle/0027_overrated_sabra.sql`)

New tables added in migration `0027`:

```sql
users           — id, email, password_hash, name, role, email_verified, timestamps
subscriptions   — id, user_id (FK), stripe_customer_id, status, plan, period_end
user_settings   — user_id (PK/FK), settings_json (AES-GCM blob), updated_at
```

Existing tables updated:
```sql
apps         — added user_id (FK → users.id)
mcp_servers  — added user_id (FK → users.id)
custom_themes — added user_id (FK → users.id)
```

SQLite WAL mode is enabled on startup for concurrent multi-user access.

### 9. Frontend Auth (`src/contexts/AuthContext.tsx`, `src/routes/auth/`)

- `AuthContext` — manages `user`, `token`, `login()`, `register()`, `logout()`,
  `refreshUser()`. Token is stored in `localStorage` under key `proteaai_token`.
- `AuthGuard` — wraps all protected routes; redirects unauthenticated users to `/login`.
- `login.tsx` / `signup.tsx` — full-page auth forms.
- Web IPC adapter (`src/web/web-ipc-adapter.ts`) — translates `ipcRenderer.invoke()` /
  `ipcRenderer.on()` calls into `fetch POST /api/:channel` + WebSocket subscriptions.

### 10. Deployment (`Dockerfile`, `docker-compose.yml`)

Multi-stage Dockerfile:
- **Stage 1 (builder)** — Node 24, installs all deps, runs `npm run build:web` (Vite
  SPA + tsc server compile).
- **Stage 2 (runtime)** — lean Node 24, copies `dist/` and `drizzle/` only.
- The server runs DB migrations automatically on startup.
- Data is stored in `/data` (mount a volume here for persistence).

---

## Quick Start — Local Dev (Hot Reload)

```bash
# 1. Clone and install
git clone <repo>
cd PROTEAAI
npm install

# 2. Configure environment
cp .env.example .env
# Minimum required: set JWT_SECRET to any long random string
# e.g.: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Push the DB schema (first time only)
npm run db:push

# 4. Start both the Express server and the Vite dev client
npm run dev:web
```

- **Web client** → `http://localhost:5173`
- **API server** → `http://localhost:3001`
- **WebSocket** → `ws://localhost:3001/ws`
- **Health check** → `http://localhost:3001/health`

The Vite dev client proxies `/api`, `/auth`, `/billing`, `/media`, and `/ws` to port 3001
automatically (configured in `vite.web.config.mts`).

---

## Quick Start — Docker Compose

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET at minimum

# 2. Build and run
docker compose up --build

# App is at http://localhost:3001
```

To reset all data:
```bash
docker compose down -v   # removes the proteaai_data volume
```

---

## Manual Testing Walkthrough

### Register and log in

```bash
# Register a new user
curl -s -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123","name":"Alice"}' | jq

# Log in and capture the token
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}' | jq -r '.data.token')

echo "Token: $TOKEN"
```

### Call an IPC handler over HTTP

```bash
# Get user settings
curl -s -X POST http://localhost:3001/api/settings:get \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq

# List apps (returns only Alice's apps)
curl -s -X POST http://localhost:3001/api/app:list \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

### Verify user isolation

```bash
# Register a second user
TOKEN_B=$(curl -s -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@example.com","password":"password123"}' | jq -r '.data.token')

# Create an app as Alice
APP_ID=$(curl -s -X POST http://localhost:3001/api/app:create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice App"}' | jq -r '.data.id')

# List apps as Bob — should return empty array
curl -s -X POST http://localhost:3001/api/app:list \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.data | length'   # should print 0
```

### Check billing subscription

```bash
curl -s http://localhost:3001/billing/subscription \
  -H "Authorization: Bearer $TOKEN" | jq
# Returns: { ok: true, data: { plan: "free", status: "active" } }
```

### GDPR data export

```bash
curl -s -X POST http://localhost:3001/gdpr/export \
  -H "Authorization: Bearer $TOKEN" | jq
```

### WebSocket test

Open a browser console on `http://localhost:3001` (or `5173` in dev) and run:

```js
const ws = new WebSocket(`ws://${location.host}/ws`);
ws.onmessage = (e) => console.log('WS:', JSON.parse(e.data));
ws.onopen = () => console.log('WebSocket connected');
```

Then trigger a chat — you will see streaming event frames arrive in the console.

---

## Building for Production

```bash
# Full production build
npm run build:web

# Artifacts:
#   dist/web/          — Vite SPA (served as static files)
#   dist/server/       — tsc-compiled Express server
```

Run the compiled server:
```bash
JWT_SECRET=your-secret node dist/server/server/index.js
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **Yes** | `change-me-…` | Signs JWTs — use a random 64-char string in production |
| `JWT_EXPIRES_IN` | No | `7d` | JWT lifetime |
| `SECRET_KEY` | No | auto-derived | AES-256-GCM key (64 hex chars) for encrypting settings |
| `PORT` | No | `3001` | Port the Express server listens on |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Comma-separated allowed origins |
| `APP_BASE_URL` | No | — | Public URL; used for Stripe redirect URLs |
| `PROTEAAI_DATA_DIR` | No | OS user-data dir | Root directory for SQLite DB and per-user app files |
| `STRIPE_SECRET_KEY` | No | — | Stripe secret key (`sk_live_…` or `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | No | — | Stripe webhook signing secret (`whsec_…`) |
| `STRIPE_PRO_PRICE_ID` | No | — | Stripe Price ID for the Pro plan |
| `ANTHROPIC_API_KEY` | No | — | Server-level API key (users can also set their own) |
| `OPENAI_API_KEY` | No | — | Server-level API key |
| `GOOGLE_API_KEY` | No | — | Server-level API key |
| `OLLAMA_HOST` | No | `http://127.0.0.1:11434` | Ollama endpoint for local models |

---

## Key Source Files

| File | Purpose |
|---|---|
| `server/index.ts` | Express app entry point; mounts all routes; wires WebSocket broadcaster |
| `server/routes/auth.ts` | Register / login / me / logout |
| `server/routes/billing.ts` | Stripe Checkout, Portal, webhook |
| `server/routes/admin.ts` | Admin-only user management |
| `server/routes/gdpr.ts` | Data export and account deletion |
| `server/middleware/auth.ts` | JWT validation + `runWithUserContext()` |
| `server/ws_manager.ts` | WebSocket server; `broadcast(channel, payload)` |
| `src/ipc/handlers/base.ts` | `enableWebMode()`, `webHandlerRegistry`, `createTypedHandler()` |
| `src/ipc/handlers/safe_handle.ts` | `createLoggedHandler()` — dual-mode (web + Electron) |
| `src/ipc/handlers/chat_stream_handlers.ts` | AI streaming; `safeSend(null,…)` for web push |
| `src/ipc/context/user-context.ts` | `getCurrentUser()` / `runWithUserContext()` via AsyncLocalStorage |
| `src/main/web-settings.ts` | Per-user encrypted settings read/write |
| `src/main/web-crypto.ts` | `webEncrypt()` / `webDecrypt()` (AES-256-GCM) |
| `src/db/schema.ts` | Full Drizzle schema including users, subscriptions, userSettings |
| `src/contexts/AuthContext.tsx` | React auth context for the web client |
| `src/routes/auth/login.tsx` | Login page |
| `src/routes/auth/signup.tsx` | Sign-up page |
| `src/web/web-ipc-adapter.ts` | Translates IPC calls into fetch + WebSocket for the browser |
| `Dockerfile` | Multi-stage production container build |
| `docker-compose.yml` | Local development / self-hosting orchestration |
| `drizzle/0027_overrated_sabra.sql` | Migration adding users, subscriptions, userSettings tables |

---

## Running the Electron Desktop Build

The Electron build is unchanged. Nothing added for web mode breaks it — all Electron
imports are lazy-loaded and guarded by `process.versions?.electron`.

```bash
npm run dev:engine   # start the Electron dev app
npm run build        # build the Electron distributable
```

---

## Notes for Production Deployment

1. **Set `JWT_SECRET`** to a long random string — the default is intentionally weak.
2. **Mount a persistent volume** at `PROTEAAI_DATA_DIR` (`/data` in Docker). The SQLite
   database and all user app files live here.
3. **Stripe webhook** — point `POST https://your-domain.com/billing/webhook` at Stripe
   and set `STRIPE_WEBHOOK_SECRET` to the signing secret Stripe provides.
4. **HTTPS** — run behind a reverse proxy (nginx / Caddy / Cloudflare) that terminates TLS.
   The app itself only speaks plain HTTP.
5. **`SECRET_KEY`** — set this for production. Without it, settings encryption falls back
   to a derived key, which is weaker.
6. **Database backups** — SQLite WAL mode is on; back up the `.db` file while the server
   is running using `sqlite3 db.sqlite ".backup backup.db"` (safe in WAL mode).
