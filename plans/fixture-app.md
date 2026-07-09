# Large Scaffold-Style Fixture App

## Summary

Create a standalone Vite React app at `testing/fixtures/large-scaffold-app/` that looks like a Dyad-generated app evolved into a sizable SaaS operations product. It will copy the current `scaffold/` conventions instead of modifying `scaffold/` itself.

Primary goal: an agent/code-explorer fixture with many realistic files, routes, components, mock data, and cross-module imports.

## Key Changes

- Base the new app on `scaffold/`: Vite, React, TypeScript, React Router in `src/App.tsx`, Tailwind, shadcn-style UI components, `@/*` imports, `MadeWithDyad`, and the scaffold package/config files.
- Build a realistic "operations command center" app with routes: `/`, `/projects`, `/projects/:id`, `/customers`, `/customers/:id`, `/incidents`, `/incidents/:id`, `/deployments`, `/automations`, `/knowledge`, `/reports`, `/settings`, and `*`.
- Add app-specific source areas: `src/components/layout`, `src/components/dashboard`, `src/components/projects`, `src/components/customers`, `src/components/incidents`, `src/components/deployments`, `src/components/automations`, `src/components/reports`, `src/data`, `src/hooks`, `src/lib`, `src/services`, `src/types`, and `src/pages`.
- Keep the app static and self-contained: mock API services return typed local data through React Query; no backend, secrets, env vars, database, or network calls.
- Size targets: at least 130 total files in the fixture, at least 70 app-specific source files excluding copied `src/components/ui`, and at least 12,000 lines total across the fixture.
- Add fixture-local docs in `README.md` explaining that this simulates a large app generated from Dyad's default React scaffold.

## Public Interfaces

- New standalone package scripts: `dev`, `build`, `build:dev`, `lint`, `preview`, and `test`.
- Add `vitest` to the fixture package only, with focused unit tests for pure app logic.
- Do not change root `package.json`, Dyad runtime code, template selection logic, or the existing `scaffold/` directory.

## Test Plan

- From `testing/fixtures/large-scaffold-app/`, run `pnpm install` to update/install fixture dependencies.
- Run `pnpm build`.
- Run `pnpm lint`.
- Run `pnpm test`.
- Add unit tests for typed search/filter helpers, incident severity/SLA calculations, deployment health rollups, and mock API query behavior.
- Optional manual smoke: run `pnpm dev`, open the app, and verify top-level navigation plus one detail route.

## Assumptions

- Use a standalone folder, not a nested git repo.
- Optimize for agent fixture usefulness over production backend completeness.
- Preserve scaffold conventions even where they differ from Dyad's internal Electron UI conventions.
- Keep generated data deterministic so tests and future agent investigations are stable.
