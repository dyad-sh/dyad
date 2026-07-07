// @vitest-environment node
//
// Migrated from e2e-tests/turbo_edits_v2.spec.ts.
//
// Turbo Edits v2 ("search-replace" pro mode) = Dyad Pro enabled +
// enableProLazyEditsMode + proLazyEditsMode "v2". With Dyad Pro on, requests
// route through the Dyad engine (DYAD_ENGINE_URL), which the fake-LLM server
// serves at /engine/v1 (fixtures resolve under e2e-tests/fixtures/engine/).
//
// DYAD_ENGINE_URL is captured at module-import time by get_model_client, so we
// reserve an ephemeral port inside the hoisted block (before app modules load)
// and start a second fake-LLM server on that port in beforeAll.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const net = await import("node:net");
  // Reserve an ephemeral port for the engine server (listen(0), read, close).
  const enginePort: number = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
  process.env.DYAD_ENGINE_URL = `http://127.0.0.1:${enginePort}/engine/v1`;
  return { ipcHandlers: new Map(), enginePort };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { createFakeIpcEvent } from "@/testing/electron_mock";
import { registerProposalHandlers } from "@/ipc/handlers/proposal_handlers";
import { messages as messagesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ApproveProposalResult } from "@/ipc/types";
import {
  startFakeLlmServer,
  type FakeLlmServerHandle,
} from "../../../../testing/fake-llm-server/index";

// Matches the default-scaffold Index.tsx line the engine fixtures'
// SEARCH blocks target (e2e-tests/fixtures/engine/turbo-edits-v2*.md).
const INDEX_TSX = `const Index = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to Your Blank App</h1>
      </div>
    </div>
  );
};

export default Index;
`;

describe("turbo edits v2 (integration)", () => {
  let harness: ChatFlowHarness;
  let engineServer: FakeLlmServerHandle;

  // Invokes the same "approve-proposal" IPC the UI Approve button calls.
  // createLoggedHandler wraps results in an IPC envelope; unwrap it.
  const approveProposal = async (
    messageId: number,
  ): Promise<ApproveProposalResult> => {
    const approveHandler = h.ipcHandlers.get("approve-proposal") as (
      event: unknown,
      args: { chatId: number; messageId: number },
    ) => Promise<{ ok: boolean; value: ApproveProposalResult }>;
    expect(approveHandler).toBeDefined();
    const envelope = await approveHandler(createFakeIpcEvent([]), {
      chatId: harness.chatId,
      messageId,
    });
    expect(envelope.ok).toBe(true);
    return envelope.value;
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      autoApprove: false,
      settings: {
        enableDyadPro: true,
        enableProLazyEditsMode: true,
        proLazyEditsMode: "v2",
        // With Dyad Pro enabled the effective default chat mode becomes
        // local-agent; pin build mode like the e2e pinBuildChatModeForSetup.
        defaultChatMode: "build",
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
    // Start the engine-side fake LLM server on the reserved port (env vars
    // FAKE_LLM_DUMP_DIR / FAKE_LLM_FIXTURES_DIR were set by the harness, and
    // the dump dir is resolved per-request, so both servers share it).
    engineServer = await startFakeLlmServer({ port: h.enginePort });

    registerProposalHandlers();

    // The engine fixtures do a search-replace against the default scaffold's
    // src/pages/Index.tsx; the "minimal" fixture app doesn't have it, so seed
    // it (committed, like a pre-existing app file).
    const indexPath = path.join(harness.appDir, "src", "pages", "Index.tsx");
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, INDEX_TSX);
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
    git("commit", "-m", "add Index.tsx");
  }, 30_000);

  afterAll(async () => {
    await engineServer?.close();
    await harness?.dispose();
  });

  it("search-replace dump: request goes through the dyad engine", async () => {
    const { result, getServerDump } = await harness.streamChat("[dump]");
    expect(result).toBe(harness.chatId);

    // The request hit the fake server's /engine/v1 route with the pro model
    // client. Model is masked by the harness.
    const req = getServerDump({ type: "request" });
    expect(req.parsed.body.model).toBe("[[MODEL]]");
    expect(req.parsed.body.stream).toBe(true);
    // Turbo Edits v2 disables v1 lazy edits on the engine request but keeps
    // engine features (versioned files / smart context payload).
    expect(req.parsed.body.dyad_options).toBeDefined();
    expect(req.parsed.body.dyad_options.enable_lazy_edits).toBeFalsy();

    const dump = getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("message: [[SYSTEM_MESSAGE]]");
    expect(dump.text).toMatchSnapshot();
  }, 30_000);

  it("search-replace approve", async () => {
    const { result, messages } = await harness.streamChat("tc=turbo-edits-v2");
    expect(result).toBe(harness.chatId);

    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toContain(
      '<dyad-search-replace path="src/pages/Index.tsx">',
    );
    // The search block matched (dry-run found no issues), so no fallback
    // warning was appended and no fix attempt was made.
    expect(assistant.content).not.toContain(
      "Could not apply Turbo Edits properly",
    );
    expect(assistant.approvalState).toBeNull();

    // Not applied yet (auto-approve off).
    expect(harness.readAppFile("src/pages/Index.tsx")).toContain(
      "Welcome to Your Blank App",
    );

    const gitLogBefore = harness.gitLog().length;
    const approveResult = await approveProposal(assistant.id);
    expect(approveResult.success).toBe(true);

    // The search-replace was applied and committed.
    const updated = harness.readAppFile("src/pages/Index.tsx");
    expect(updated).toContain("Welcome to the UPDATED App");
    expect(updated).not.toContain("Welcome to Your Blank App");
    expect(harness.gitLog().length).toBe(gitLogBefore + 1);

    const approved = (await harness.db.query.messages.findFirst({
      where: eq(messagesTable.id, assistant.id),
    }))!;
    expect(approved.approvalState).toBe("approved");
    expect(approved.commitHash).toBeTruthy();
  }, 30_000);

  it("search-replace fallback", async () => {
    const { result, messages, getServerDump } = await harness.streamChat(
      "tc=turbo-edits-v2-trigger-fallback",
    );
    expect(result).toBe(harness.chatId);

    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe("assistant");

    // Dry-run failed -> warning appended -> fix attempt #1 (dyad-read +
    // another non-matching search-replace) -> still failing -> fix attempt #2
    // falls back to a full <dyad-write>.
    expect(assistant.content).toContain("Could not apply Turbo Edits properly");
    expect(assistant.content).toContain(
      '<dyad-read path="src/pages/Index.tsx">',
    );
    expect(assistant.content).toContain(
      "FILE IS REPLACED WITH FALLBACK WRITE.",
    );

    // Fix attempt #1 asked the model to retry search-replace after dyad-read.
    const firstFixRequest = getServerDump({
      type: "all-messages",
      dumpIndex: -2,
    });
    expect(firstFixRequest.text).toContain(
      "There was an issue with the following `dyad-search-replace` tags. Make sure you use `dyad-read` to read the latest version of the file",
    );
    // Fix attempt #2 asked the model to use dyad-write instead.
    const secondFixRequest = getServerDump({
      type: "all-messages",
      dumpIndex: -1,
    });
    expect(secondFixRequest.text).toContain(
      "Please fix the errors by generating the code changes using `dyad-write` tags instead.",
    );
    const secondFixRequestBody = getServerDump({ type: "request" });
    expect(secondFixRequestBody.parsed.body.model).toBe("[[MODEL]]");

    // Approving applies the fallback write (the failing search-replace tags
    // are skipped without erroring).
    const gitLogBefore = harness.gitLog().length;
    const approveResult = await approveProposal(assistant.id);
    expect(approveResult.success).toBe(true);
    expect(harness.readAppFile("src/pages/Index.tsx").trim()).toBe(
      "// FILE IS REPLACED WITH FALLBACK WRITE.",
    );
    expect(harness.gitLog().length).toBe(gitLogBefore + 1);
  }, 30_000);
});
