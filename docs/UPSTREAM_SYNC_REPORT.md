# Upstream Sync Report - January 22, 2026

## Summary

Analysis of 19 commits from `upstream/main` (dyad-sh/dyad) that our fork (`yosiwizman/dyad`) is behind.

**CRITICAL FINDING**: The upstream repository has made extensive branding changes that would **revert all ABBA AI customizations back to Dyad branding**. A full merge is NOT recommended.

## Commit Classification

### ✅ SAFE - Can be cherry-picked (4 commits)

These commits contain bug fixes, tooling improvements, or dependency upgrades with NO branding impact.

| SHA       | Title                                                         | Files                                                                                                                                                                                                                                                                                                                         | Rationale                                                   |
| --------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `d2aed44` | Add isPro person property to PostHog telemetry (#2285)        | `src/hooks/useSettings.ts`                                                                                                                                                                                                                                                                                                    | Telemetry improvement, uses existing `hasDyadProKey` helper |
| `23b45a9` | Fix HTML attribute and content escaping for dyad-tags (#2266) | `shared/xmlEscape.ts`, `src/__tests__/xmlEscape.test.ts`, `src/components/chat/DyadMarkdownParser.tsx`, `src/ipc/handlers/chat_stream_handlers.ts`, `src/ipc/utils/dyad_tag_parser.ts`, `src/pro/main/ipc/handlers/local_agent/tools/types.ts`, `src/pro/main/ipc/handlers/local_agent/xml_tool_translator.ts`, e2e snapshots | **IMPORTANT BUG FIX** - Proper XML escaping for tag content |
| `5894cc7` | Upgrade oxlint and enable recommended rules (#2270)           | `.oxlintrc.json`, `package.json`, `package-lock.json`                                                                                                                                                                                                                                                                         | Tooling upgrade only                                        |
| `52e5a3f` | Enable React Compiler (#2259)                                 | `package.json`, `package-lock.json`, `vite.renderer.config.mts`                                                                                                                                                                                                                                                               | Performance optimization, no branding                       |

### ⚠️ RISKY - Contains branding/product changes (7 commits)

These commits include branding-related strings or product direction changes that conflict with ABBA.

| SHA       | Title                                                            | Risk Level | Issue                                                                 |
| --------- | ---------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| `207c919` | Add default chat mode setting (#2244)                            | HIGH       | Contains `isDyadProEnabled` refs and UI changes with Dyad branding    |
| `e73bea9` | Add uncommitted files banner with review & commit dialog (#2257) | MEDIUM     | New feature - would need ABBA adaptation of text/branding             |
| `f44ad71` | feat: enable read-only local agent for pro ask mode (#2260)      | HIGH       | Contains `enableDyadPro`, `setUpDyadPro`, Dyad Pro references         |
| `8377178` | Upgrade Electron and Electron Forge to latest versions (#2258)   | LOW        | Dependency upgrade but package-lock.json has `"name": "dyad"` changes |

### 🚫 SKIP - Documentation/tooling changes specific to upstream (8 commits)

These are Claude tooling, AGENTS.md, and workflow changes that are either upstream-specific or don't apply to our fork.

| SHA       | Title                                                         | Reason                               |
| --------- | ------------------------------------------------------------- | ------------------------------------ |
| `6c8151a` | prettify AGENTS.md (#2290)                                    | Upstream-specific docs               |
| `b888792` | Add pre-commit checks to AGENTS.md (#2287)                    | Upstream-specific docs               |
| `133836b` | Update command for TypeScript type checks (#2286)             | Claude commands specific to upstream |
| `6194bd5` | Add E2E debug logs and git workflow docs to AGENTS.md (#2279) | Upstream-specific docs               |
| `560edd7` | Add Claude settings.json with good defaults (#2277)           | Upstream Claude config               |
| `71812e6` | Prettier claude commands md (#2278)                           | Upstream Claude config               |
| `cdf2f1b` | Update Claude settings and AGENTS.md (#2275)                  | Upstream Claude config               |
| `c2f9978` | Allow #skip-bb as shorthand for #skip-bugbot (#2274)          | Upstream CI workflow                 |
| `e4580ba` | Create e2e-re claude skill (#2273)                            | Upstream Claude skill                |
| `9098570` | Better agents instruction (#2267)                             | Upstream-specific docs               |
| `e229b2a` | Update playwright comment workflow (#2256)                    | Upstream CI specific                 |

## Branding Conflict Analysis

The upstream diff shows **massive** branding reversions including:

### URLs Changed (Dyad → ABBA impact)

- `https://www.dyad.sh/` would replace `https://www.abba.ai/`
- `https://academy.dyad.sh/` would replace `https://academy.abba.ai/`
- `https://oauth.dyad.sh/` would replace `https://oauth.abba.ai/`
- `https://api.dyad.sh/` would replace `https://api.abba.ai/`
- `https://engine.dyad.sh/` would replace `https://engine.abba.ai/`
- `https://github.com/dyad-sh/dyad` would replace `https://github.com/yosiwizman/dyad`

### App Identity Changes

- `"name": "dyad"` would replace `"name": "abba-ai"`
- `"productName": "dyad"` would replace `"productName": "ABBA AI"`
- `dyad-apps` directory would replace `abba-ai-apps`
- `dyad://` protocol would replace `abba-ai://`
- `x-scheme-handler/dyad` would replace `x-scheme-handler/abba-ai`

### Removed ABBA-Specific Safeguards

- `verify-no-dyad-branding` script would be removed
- `verify-windows-icon` script would be removed
- `verify-tray-icon-config` script would be removed
- `verify-icon-hashes` script would be removed
- `regenerate-icons` script would be removed
- Windows icon configuration (`setupIcon`, `iconUrl`) would be removed
- Tray icon asset reference would be removed

### UI/Text Changes

- "ABBA AI" → "Dyad" in all user-facing text
- "Made with ABBA AI" → "Made with Dyad"
- All Pro subscription references changed
- Help/support URLs changed

## Recommended Action

### Phase 1: Cherry-pick Safe Commits

1. Create branch: `chore/sync-upstream-20260122`
2. Cherry-pick ONLY these commits:
   - `23b45a9` - XML escaping bug fix (PRIORITY: HIGH)
   - `d2aed44` - PostHog telemetry improvement
   - `5894cc7` - Oxlint upgrade
   - `52e5a3f` - React Compiler

### Phase 2: Manual Port (Future)

Consider manually porting these features with ABBA branding:

- `e73bea9` - Uncommitted files banner (useful feature)
- `207c919` - Default chat mode setting (useful feature)

### Phase 3: Skip

All other commits should be skipped as they are:

- Upstream-specific tooling/docs
- Would cause branding regressions

## Risk Summary

| Category                 | Count | Action               |
| ------------------------ | ----- | -------------------- |
| Safe to cherry-pick      | 4     | ✅ Proceed           |
| Risky (needs adaptation) | 4     | ⏳ Manual port later |
| Skip (upstream-specific) | 11    | 🚫 Do not include    |

## Verification Checklist

After cherry-picks:

- [ ] `npm run verify-no-dyad-branding` passes
- [ ] `npm run verify-icon-hashes` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] App builds successfully
- [ ] ABBA branding intact in built app
