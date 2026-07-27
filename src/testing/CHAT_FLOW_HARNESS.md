# Chat-flow Harness

`setupChatFlowHarness` exercises the real main-process chat path without
launching Electron. It uses real SQLite migrations, a real Git fixture checkout,
the pi runtime, and the same deterministic fake LLM server used by Playwright.
Only Electron is mocked.

Use this harness when assertions concern files, Git, database rows, stream
events, or provider request payloads. Use the hybrid harness when the assertion
is about rendered React UI.

## Test skeleton

```ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("chat behavior", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it("runs a turn", async () => {
    const result = await harness.streamChat("tc=agent/simple-response");
    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
  });
});
```

Use one harness per test file. The database and several main-process services
are process singletons.

## Setup options

- `electronMock`: required hoisted mock handle.
- `fixtureApp`: fixture under `e2e-tests/fixtures/import-app/`; defaults to
  `minimal`.
- `provider` and `model`: custom provider/model row overrides.
- `selectedModel`: settings model selection.
- `chatMode`: `local-agent`, `ask`, or `plan`; defaults to
  `local-agent`.
- `autoApprove`: defaults to `true`.
- `settings`: highest-precedence settings overrides.
- `useFakeCatalog`: point catalog reads at the fake server; defaults to
  `true`.
- `verboseFakeLlm`: show fake-server request logs.
- `registerChatStreamHandlers`: defaults to `true`; the hybrid harness sets
  it to `false` because it registers the full IPC host.

The default provider id is `custom::testing`, backed by the harness's
ephemeral fake-server URL.

## Harness API

- `streamChat(prompt, options?)`: invokes the real `chat:stream` handler.
- `getServerDump(options?)`: reads and normalizes a captured fake-server
  request.
- `getAppFiles()`, `readAppFile(path)`, `appFileExists(path)`: inspect the
  fixture checkout.
- `gitLog()`: read committed app history.
- `db`, `appId`, `chatId`, `appDir`: direct integration-test handles.
- `dispose()`: stop app processes, close server/database, restore environment,
  and remove temporary files.

`streamChat` returns captured renderer events, fresh database messages, event
lookup helpers, and a request-dump helper.

## Fake LLM fixtures

Prompts containing `tc=<fixture>` select deterministic fixtures under
`e2e-tests/fixtures/`. Agent tool fixtures live under
`e2e-tests/fixtures/agent/`. The fake server supports the provider request
formats used by the pi runtime and records requests for snapshot assertions.

Use `[dump]` when a test needs the raw request. `getServerDump` normalizes
paths, Git hashes, tool-call ids, model ids, tool descriptions, and system
messages. Keep snapshot options explicit when one of those values is the
behavior under test.

## Reliability rules

- Do not run overlapping turns for the same chat.
- Use separate chats for concurrent stream coverage.
- Keep `tc=` fixture routing based on the last real user text; tool-result
  messages may be the final provider message.
- Await app processes started by tools before `dispose()`.
- Do not mutate global environment outside the harness without restoring it.
- If a request is about rendered UI, move it to the hybrid harness instead of
  recreating renderer state here.
