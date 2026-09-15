# Rebase and deep review — 2026-09-15

PR #4485 was rebased onto `2e40b1690` and reopened. Charging now reuses the shared flat-rate external-model service from #4483/current main; the old 25% reservation/outbox design is removed.

Six independent finder passes covered shallow diff, deep correctness, history, cross-file consistency, error/data flow and explicit project rules. Findings were deduplicated and independently challenged; all eight retained findings scored at least 75/100:

| Finding                                              | Confidence | Fix                                                                                                                     |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Truncated permission JSON corrupts large edits       | 75         | Preserve complete protocol input; sanitize ordinary MCP output separately                                               |
| HTTP dispatch is not MCP operation completion        | 75         | Track and drain actual tool-handler promises; close admission and cancel consent waits before release                   |
| Initial created/imported chats miss selected backend | 100        | Shared initialization across all three chat-creation paths                                                              |
| Summary action sends only opaque chat ID             | 100        | Load source history and summary instructions before Claude dispatch                                                     |
| Security review loses instructions/read-only guard   | 100        | Preserve review contract/project rules and enforce read-only capabilities                                               |
| Windows quit uses asynchronous shell termination     | 76         | Reuse synchronous direct process-tree cleanup                                                                           |
| Retry/Clear diverge from hidden CLI transcript       | 96         | Reject redo before mutation; disable UI Retry with explanation; clear session identity atomically with cleared messages |
| Picker race changes accepted model                   | 84         | Pass admitted model snapshot to backend                                                                                 |

Independent follow-up inspection confirmed fixes for the first five. Focused regressions exercise real SDK operation draining, large permission payloads, reference read/write boundaries, cleared session state, expanded commands and accepted-model races. Subsequent top-level review fixes also make restore-created forks usable through fresh CLI sessions with copied visible history, explicitly prohibit persistent consent for per-turn operations, distinguish installed-but-unavailable CLI status, probe CLI status lazily, report operation/turn failures, and prevent model-authored action tags from impersonating host cards. The ChatModeSelector global-source concern was refuted: it already uses the chat-resolved `selectedModel`.

Subsequent PR feedback additionally identified raw dotenv access: deny dotenv paths (including resolved aliases), remove recursive raw Grep from the actual CLI inventory, and guard referenced-app internals. Glob plus guarded Read remains available.

## Verification

- Full suite after the review fixes: **738 files passed; 8,304 tests passed, 1 skipped**. A final narrow typed-error-detail follow-up was checked separately.
- First post-fix targeted run: **192 tests passed**.
- New real handler/DB integration tests: **4 passed**, including summary/security-review/retry/model-race cases.
- Formatting, lint and main/worker type checks passed for the rebased charging update; final checks and CLI smoke results are recorded in the PR handoff.
- Production Claude charging and commercial release terms remain unverified. Historical 2026-09-04 evidence does not establish the revised charging path.
