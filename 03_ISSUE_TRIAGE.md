# 03 — Issue Triage: dyad-sh/dyad

**As of**: 2026-05-28
**Source**: `gh issue list --repo dyad-sh/dyad --state open --limit 50`
**Total open issues**: ~255 (per 00_STATE.md)

## Summary

| Category            | Count (of 50 sampled) | Est. % |
| ------------------- | --------------------- | ------ |
| Bugs                | ~28                   | ~56%   |
| Feature Requests    | ~17                   | ~34%   |
| Workflow/Automation | ~4                    | ~8%    |
| Incomplete Issues   | ~2                    | ~4%    |
| Security            | 1                     | ~2%    |

---

## Bugs (~56% of open issues)

### Critical / Security

| #    | Title                                                                              | Labels                    | Notes                                           |
| ---- | ---------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------- |
| 3502 | **[Security] GitHub OAuth token stored in plain text inside git remote URL**       | bug, prioritized, pro     | HIGH — tokens in plaintext in git remote config |
| 3240 | **CRITICAL: Dyad crashing mid-session on large GLM-5.1 prompts (Memory/Cache?)**   | bug                       | Memory issue with large prompts                 |
| 3517 | **[bug] Mode switch (Build → Plan) forces new chat but drops attached components** | bug, pro                  | Pro member issue                                |
| 3204 | **App deletion does not go to trash and causes permanent data loss**               | bug, feature request, pro | Data loss bug                                   |

### Pro-Member Bugs

| #    | Title                                          | Notes |
| ---- | ---------------------------------------------- | ----- |
| 3517 | Mode switch drops attached components          |       |
| 3343 | Browser pop out shows blank screen             |       |
| 3497 | add_dependency tool fails with EINVALIDTAGNAME |       |
| 3221 | "Corrupted Thought Signature" session report   |       |

### Windows-Specific Bugs

| #    | Title                                                               |
| ---- | ------------------------------------------------------------------- |
| 3513 | Windows: project setup fails when user profile path contains spaces |
| 3379 | pnpm command not found on macOS (actually Windows issue)            |
| 3360 | TSC worker exited with code 1 on Windows                            |

### Database / Migration Bugs

| #    | Title                                                             |
| ---- | ----------------------------------------------------------------- |
| 3521 | Postgres Schema Diff edge cases (claude)                          |
| 3520 | Handle enum value additions used later in the same Neon migration |
| 3285 | Database connection is not open error                             |

### Build / Deploy Bugs

| #    | Title                                                           |
| ---- | --------------------------------------------------------------- |
| 3377 | "Sync to GitHub" fails to push / No Vercel deployment triggered |
| 3338 | Local git Review & commit does not work                         |
| 3135 | Restoring older local git versions destroys newer versions      |

### UI/UX Bugs

| #    | Title                                                                       |
| ---- | --------------------------------------------------------------------------- |
| 3500 | Built-in browser version is still the same AND buggy!                       |
| 3347 | New app / Copy App swallows the prompt                                      |
| 3462 | React Three Fiber findInitialRoot error when building 3D object manager app |
| 3461 | React Three Fiber findInitialRoot error (duplicate)                         |
| 3505 | Bug when setting code context in V1.0                                       |
| 3448 | Select component + active annotator does not work with GitHub-imported apps |
| 3499 | Setting the port for the local app server                                   |

---

## Feature Requests (~34% of open issues)

### High-Priority / Community

| #    | Title                                                        |
| ---- | ------------------------------------------------------------ |
| 3494 | Password Protect Application                                 |
| 3427 | Support /skills                                              |
| 3426 | Support /goal (long-running outcomes)                        |
| 3385 | Support OpenAI /v1/responses API format for custom providers |
| 3456 | Support MCP OAuth                                            |
| 3310 | Making it easier to run Dyad on own HW                       |
| 3175 | Allow Dyad to use computer (e.g. browse, self-test)          |

### Deployment / Infrastructure

| #    | Title                                              |
| ---- | -------------------------------------------------- |
| 3306 | AppWrite integration                               |
| 3290 | AWS Bedrock auth via AWS credential provider chain |
| 3449 | Feature request to add docker yml                  |

### DX / Tooling

| #    | Title                                                     |
| ---- | --------------------------------------------------------- |
| 3295 | Make bulk deployment of many edge functions (>100) faster |
| 3299 | Add configurable hooks into flows like Create New App     |
| 3470 | Recover From Force Close                                  |
| 3476 | Create Neon integration guide & in-app guidance           |
| 3255 | support caveman / more compact output                     |
| 3164 | Stop and write button                                     |
| 3130 | Add template for Svelte / SvelteKit                       |

---

## Workflow / CI Issues (~8%)

| #    | Title                                                             | Labels               |
| ---- | ----------------------------------------------------------------- | -------------------- |
| 3496 | Workflow issues: Claude API spending cap and Mailgun auth failure | bug, workflow-health |
| 3454 | Workflow issues: Codex PR Review authentication token expired     | bug, workflow-health |
| 3447 | Workflow issues: CI consistently failing on main branch           | bug, workflow-health |

---

## Issues with Missing Information (~4%)

| #    | Title                                                  | Labels                     |
| ---- | ------------------------------------------------------ | -------------------------- |
| 3444 | [hub]                                                  | bug, issue/incomplete, hub |
| 3506 | [bug] <WRITE TITLE HERE>                               | bug                        |
| 3391 | [WSL/Ubuntu] [Github connection] Cannot connect github | response requested         |

---

## Triage Notes

- **~255 total open issues** — 50 sampled above, ratio likely consistent
- **Pro issues** (labeled `pro`) indicate paying customers are affected — these should be prioritized
- **workflow-health** label appears on 3 issues — indicates ongoing CI/automation instability
- **Incomplete issues** (labeled `issue/incomplete`) lack sufficient detail to reproduce — need follow-up
- **Security issue #3502** is marked `prioritized` — GitHub OAuth token in plaintext is a real security risk
- **Windows path with spaces** (#3513) is a classic cross-platform file path issue
- **React Three Fiber** appears twice (#3461, #3462) — likely the same bug reported twice
- **Duplicate submission risk**: Issue #3506 has no title — likely a bot/template mishap

---

## Recommended Priority Actions

1. **Security**: Address #3502 (OAuth token plaintext) immediately
2. **Data loss**: #3204 (app deletion without trash) is severe
3. **CI health**: #3447, #3496, #3454 show workflow instability
4. **Pro bugs**: #3517, #3343, #3497, #3221 affect paying customers
5. **Windows**: #3513, #3360 are platform blockers for Windows users
