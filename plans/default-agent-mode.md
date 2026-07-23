# Make Agent the Baseline Effective Chat Mode

## Summary

Make `local-agent` the optimistic automatic baseline across new-chat surfaces
while preserving confirmed availability fallbacks and explicit choices.

| User state                                             | Automatic effective mode |
| ------------------------------------------------------ | ------------------------ |
| Pro                                                    | Agent                    |
| Non-Pro, quota unresolved                              | Agent                    |
| Non-Pro, quota available, no provider yet              | Agent provisionally      |
| Non-Pro, quota available, eligible non-Google provider | Agent                    |
| Non-Pro, Google-only                                   | Build                    |
| Non-Pro, quota confirmed exhausted                     | Build                    |
| Explicit default set to Build                          | Build                    |

Existing chats with a stored mode remain unchanged. Explicitly selecting Agent
remains honored with Google-only, subject to the existing
confirmed-quota-exhaustion fallback.

## Implementation Changes

- Update effective-default resolution so only
  `freeAgentQuotaAvailable === false` triggers the quota fallback. `true` and
  `undefined` use the optimistic Agent baseline unless the user is Google-only
  or explicitly defaulted to Build.
- Distinguish “no provider” from “Google-only”: no provider remains
  provisionally Agent, while Google without another eligible provider resolves
  to Build.
- Treat `selectedChatMode: "build"` as current UI state rather than the
  authoritative automatic default. At startup, synchronize implicit Build to
  the resolved default, while preserving `defaultChatMode: "build"`, not
  persisting provisional Agent while provider or quota state is unresolved,
  and retaining the current-session latch for manual selections.
- Represent automatically created chats with `chatMode: null`, using the
  existing nullable schema. Keep `initialChatMode` as an explicit, latched
  override.
- Resolve null-mode chats dynamically. A provisional Agent chat can become
  Build before its first turn when Google-only setup or confirmed quota
  exhaustion is discovered.
- On the first accepted turn, persist the resolved/requested mode to latch the
  conversation. Main-process resolution must use the latest quota result:
  confirmed exhaustion latches Build; a still-unresolved status remains Agent.
- Thread the existing `isChatModeExplicit` signal through first-prompt creation
  so manual choices are stored immediately while automatic choices remain
  implicit.
- Do not migrate historical chat rows. Stored Build, Ask, Plan, and Agent chats
  remain fixed; normal runtime quota fallback still applies to stored Agent
  chats.

## Interfaces and Compatibility

- No database migration or new IPC endpoint is required.
- Clarify the optional `initialChatMode` contract: present means explicit and
  persisted; absent means use the automatic effective default.
- Continue using nullable `chat.chatMode` as the marker for an implicit,
  not-yet-latched mode.
- Preserve deprecated `"agent"` → `"build"` migration, explicit default
  settings, free-model compatibility behavior, and manual Agent selection with
  Google.

## Test Plan

- Unit-test the resolver matrix:
  - unresolved quota → Agent;
  - available quota → Agent unless Google-only;
  - confirmed exhaustion → Build;
  - no provider → Agent;
  - Google-only → Build;
  - Google plus eligible non-Google → Agent;
  - Pro → Agent;
  - explicit Build default → Build.
- Verify automatic Google-only mode resolves to Build while an explicit Agent
  choice remains Agent unless quota is confirmed exhausted.
- Test startup synchronization:
  - eligible implicit Build → Agent;
  - explicit Build remains Build;
  - unresolved provider/quota Agent is computed but not persisted;
  - confirmed exhausted and Google-only resolve to Build.
- Test chat creation and latching:
  - automatic chats store null;
  - explicit modes store their value;
  - an empty implicit Agent chat can change to Build after Google setup or
    confirmed exhaustion;
  - first accepted turn stores the latest resolved mode;
  - existing stored Build chats are untouched.
- Extend first-prompt tests for non-Google → Agent, Google-only → Build,
  confirmed exhaustion → Build, unresolved quota → Agent, and manual Agent
  bypassing automatic provider recomputation.
- Run targeted unit/integration suites, then `npm run fmt`, `npm run lint`, and
  `npm run ts`.

## Assumptions

- “Unresolved quota” includes initial loading and quota-check failure; both
  remain optimistically Agent.
- Only a confirmed exhausted response triggers quota-based Build fallback.
- “Google-only uses Build” applies to automatic defaults; explicit Agent remains
  allowed.
- Existing conversation rows are never rewritten by startup synchronization.
