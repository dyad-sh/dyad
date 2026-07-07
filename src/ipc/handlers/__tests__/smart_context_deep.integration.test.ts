// @vitest-environment node
//
// Migrated from e2e-tests/smart_context_deep.spec.ts.
//
// Dyad Pro with Smart Context "deep":
//  - a read → write → read → dump sequence must send the codebase as
//    dyad_options.versioned_files (fileReferences + fileIdToContent +
//    messageIndexToFilePathToFileId) with smart_context_mode="deep";
//  - mentioning another app (@app:...) must fall back to "balanced"
//    (plain dyad_options.files) and carry the mentioned app's codebase in
//    dyad_options.mentioned_apps.
//
// The e2e ran on the default new-app scaffold (which has src/pages/Index.tsx);
// the harness uses the minimal fixture, so we seed src/pages/Index.tsx before
// the turns and regenerate the masked request snapshots.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ChatFlowHarness } from "@/testing/chat_flow_harness";
import type { FakeLlmServerHandle } from "../../../../testing/fake-llm-server/index";

describe("smart context deep (integration)", () => {
  let harness: ChatFlowHarness;
  let engine: FakeLlmServerHandle;
  let mentionedAppDir: string;

  beforeAll(async () => {
    // DYAD_ENGINE_URL must exist before get_model_client.ts is imported, so
    // start a dedicated fake server first and import the harness dynamically.
    const { startFakeLlmServer } =
      await import("../../../../testing/fake-llm-server/index");
    engine = await startFakeLlmServer();
    process.env.DYAD_ENGINE_URL = `${engine.url}/engine/v1`;

    const { setupChatFlowHarness } =
      await import("@/testing/chat_flow_harness");
    harness = await setupChatFlowHarness({
      electronMock: h,
      settings: {
        enableDyadPro: true,
        // proSmartContextOption unset -> deep context (anything besides
        // "balanced" uses deep when smart files context is on).
        providerSettings: {
          auto: {
            apiKey: { value: "testdyadkey", encryptionType: "plaintext" },
          },
        },
      },
    });

    // The engine fixtures read/write src/pages/Index.tsx (present in the e2e
    // scaffold, absent in the minimal fixture) — seed and commit it.
    fs.mkdirSync(path.join(harness.appDir, "src", "pages"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(harness.appDir, "src", "pages", "Index.tsx"),
      "// original index page\nexport default function Index() {\n  return null;\n}\n",
    );
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.email=test@example.com",
          "-c",
          "user.name=Test User",
          ...args,
        ],
        { cwd: harness.appDir },
      );
    git("add", "-A");
    git("commit", "-m", "seed index page");
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await engine?.close();
    if (mentionedAppDir) {
      fs.rmSync(mentionedAppDir, { recursive: true, force: true });
    }
  });

  it("read write read: deep mode sends versioned files", async () => {
    const build = { requestedChatMode: "build" as const };

    await harness.streamChat("tc=read-index", build);
    await harness.streamChat("tc=update-index-1", build);
    // The write replaced the index page.
    expect(harness.readAppFile("src/pages/Index.tsx").trim()).toBe(
      "// this file has been replaced",
    );
    await harness.streamChat("tc=read-index", build);
    await harness.streamChat("[dump]", build);

    const dump = harness.getServerDump({ type: "request" });
    const body = dump.parsed.body as Record<string, any>;

    expect(body.dyad_options.enable_smart_files_context).toBe(true);
    expect(body.dyad_options.smart_context_mode).toBe("deep");
    // Deep mode: versioned files instead of plain files.
    expect(body.dyad_options.files).toBeUndefined();
    const versioned = body.dyad_options.versioned_files;
    expect(versioned).toBeTruthy();

    // fileReferences carry the current version of every file exactly once.
    const indexRefs = (
      versioned.fileReferences as Array<{ path: string; fileId: string }>
    ).filter((ref) => ref.path === "src/pages/Index.tsx");
    expect(indexRefs).toHaveLength(1);

    // Both versions of the read->written->read file are retained in
    // fileIdToContent under distinct (masked) file ids...
    const contents = Object.values(
      versioned.fileIdToContent as Record<string, string>,
    );
    expect(contents.some((c) => c.includes("// original index page"))).toBe(
      true,
    );
    expect(
      contents.some((c) => c.includes("// this file has been replaced")),
    ).toBe(true);

    // ...and the per-message map points different turns at different versions.
    const indexIdsAcrossMessages = new Set<string>();
    for (const pathToId of Object.values(
      versioned.messageIndexToFilePathToFileId as Record<
        string,
        Record<string, string>
      >,
    )) {
      const id = pathToId["src/pages/Index.tsx"];
      if (id) {
        indexIdsAcrossMessages.add(id);
      }
    }
    expect(indexIdsAcrossMessages.size).toBeGreaterThanOrEqual(2);

    expect(dump.text).toMatchSnapshot("smart-context-deep-read-write-read");
  }, 45_000);

  it("mention app falls back to balanced", async () => {
    // Register a second app named after the fixture, like the e2e's importApp.
    mentionedAppDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-mention-app-"),
    );
    fs.cpSync(
      path.join(
        process.cwd(),
        "e2e-tests",
        "fixtures",
        "import-app",
        "minimal-with-ai-rules",
      ),
      mentionedAppDir,
      { recursive: true },
    );
    const { apps, chats } = await import("@/db/schema");
    await harness.db
      .insert(apps)
      .values({ name: "minimal-with-ai-rules", path: mentionedAppDir });
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();

    await harness.streamChat("[dump] @app:minimal-with-ai-rules hi", {
      chatId: chatRow.id,
      requestedChatMode: "build",
    });

    const dump = harness.getServerDump({ type: "request" });
    const body = dump.parsed.body as Record<string, any>;

    // Deep context is disabled when another app is referenced.
    expect(body.dyad_options.enable_smart_files_context).toBe(true);
    expect(body.dyad_options.smart_context_mode).toBe("balanced");
    expect(body.dyad_options.versioned_files).toBeUndefined();
    expect(Array.isArray(body.dyad_options.files)).toBe(true);

    const mentionedApps = body.dyad_options.mentioned_apps as Array<{
      appName: string;
      files: Array<{ path: string }>;
    }>;
    expect(mentionedApps).toHaveLength(1);
    expect(mentionedApps[0].appName).toBe("minimal-with-ai-rules");
    expect(mentionedApps[0].files.map((f) => f.path)).toContain("AI_RULES.md");

    expect(dump.text).toMatchSnapshot("smart-context-deep-mention-app");
  }, 30_000);
});
