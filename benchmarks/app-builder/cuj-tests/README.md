# CUJ suites — app-builder benchmark

Harness-agnostic Playwright suites that score a built app at a checkpoint. They
know nothing about Dyad, Claude Code, or Codex: they drive whatever app is
serving at `APP_URL`, using only the routes, `data-testid`s and JSON API fields
pinned in the milestone prompts. That is what makes phase-1 and phase-2 numbers
comparable.

```
cuj-tests/
  relay-crm/checkpoint-1.spec.ts    10 CUJs + 2 security probes
  playwright.config.mjs             workers 1, retries 0, JSON reporter
  score-checkpoint.sh               build + serve + run + summarize
```

## Design contract

- **Serial and self-contained.** Later CUJs use data earlier ones created; the
  suite creates every identity and record itself (no DB seeding), so it runs
  against a clone of a checkpoint snapshot that already contains whatever the
  model built with.
- **`RUN_ID`-suffixed everything** (`relay-<RUN_ID>-owner@example.com`,
  `Ada <RUN_ID>`) so reruns, sibling suites and model-created demo data never
  collide.
- **Ids only from pinned surfaces** — `GET /api/me` and the `id` field of the
  pinned list endpoints. Nothing is scraped from the DOM or guessed.
- **Probes use raw HTTP with a persona's real cookies** (`context.request`), so
  client-side-only gating fails the probe.
- A skipped test (serial abort) counts as a failure — that is intended: a broken
  early CUJ means the flow is broken.

## Run against a live app

```bash
npm install                       # once
APP_URL=http://localhost:3000 npx playwright test relay-crm/checkpoint-1.spec.ts
```

## Score a checkpoint (S-SCORE, and every scored run)

The caller provisions a fresh neon-sim clone and passes its connection details;
`score-checkpoint.sh` does install → build → serve → test → summarize and always
exits 0 (a failed build or failed CUJs are _data_).

```bash
APP_DIR=/path/to/app-checkout-at-checkpoint-m1 \
SCORE_OUT=/path/to/results/luna-relay-crm-ckpt1.json \
SPEC=relay-crm/checkpoint-1.spec.ts \
APP_PORT=3000 \
DATABASE_URL='postgresql://simuser:simpass@db.localtest.me:5433/<clone>?sslmode=require' \
NEON_AUTH_BASE_URL='http://127.0.0.1:7788/authsvc/<projectId>/<branchId>' \
NEON_AUTH_COOKIE_SECRET='<64 hex chars>' \
NODE_EXTRA_CA_CERTS=/Users/mini/dyad-2/benchmarks/app-builder/neon-sim/certs/ca.pem \
./score-checkpoint.sh
```

`SCORE_OUT` receives:

```json
{
  "buildStatus": "ok",
  "cujPassed": 9,
  "cujTotal": 12,
  "failures": ["crm-m1-08", "crm-m1-s02"],
  "spec": "...",
  "scoredAt": "..."
}
```

`buildStatus` is one of `ok`, `install_failed`, `build_failed`,
`server_not_ready`, `cuj_runner_failed`. Anything but `ok` scores 0 CUJs while
still recording the total, so the checkpoint score is well-defined and the
failure mode is visible in the report (never a silent drop).

`NODE_EXTRA_CA_CERTS` must be exported by the caller: the app's
`@neondatabase/serverless` calls go through neon-sim's TLS edge.

## Phase 2 (Claude Code / Codex CLI)

Nothing here is Dyad-specific. A phase-2 adapter builds the app however its
harness does, then calls `score-checkpoint.sh` with the same arguments. Keep the
`cuj-tests/` directory and the neon-sim stack identical across harnesses — they
are the controlled variables of the comparison.
