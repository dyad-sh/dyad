// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_auto.spec.ts.
//
// With Dyad Pro enabled and the "auto" model selected in local-agent mode,
// the model client resolves the dyad/auto/* catalog aliases and prefers the
// OpenAI alias via the responses API (gpt-5.2 in the fake catalog — the same
// catalog the e2e used). The [dump] request payload proves which model/API
// was chosen and which agent tools were provided.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const engineServer = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `${engineServer.url}/gateway/v1`;
  return { ipcHandlers: new Map(), engineServer };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("local-agent auto model (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      selectedModel: { provider: "auto", name: "auto" },
      settings: {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        enableCodeExplorer: false,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await h.engineServer.close();
  });

  it("resolves auto to the OpenAI responses API with the agent toolset", async () => {
    const { eventsFor, getServerDump } = await harness.streamChat("[dump]", {
      requestedChatMode: "local-agent",
    });
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    // Unmasked model: proves the dyad/auto/openai catalog alias was picked
    // (same model the e2e request snapshot recorded).
    const req = getServerDump({ type: "request", maskModel: false });
    expect(req.parsed.body.model).toBe("gpt-5.2");

    // Responses-API shape: `input` array with a developer (system) message,
    // plus reasoning options — matching the e2e snapshot.
    expect(Array.isArray(req.parsed.body.input)).toBe(true);
    expect(req.parsed.body.input[0].role).toBe("developer");
    expect(req.parsed.body.reasoning).toEqual({
      summary: "detailed",
      effort: "medium",
    });

    // Full local-agent toolset from the e2e request snapshot.
    const tools = (req.parsed.body.tools ?? []) as Array<{
      type: string;
      name: string;
      description: string;
    }>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_dependency",
      "add_integration",
      "code_search",
      "copy_file",
      "delete_file",
      "enable_nitro",
      "execute_sandbox_script",
      "generate_image",
      "grep",
      "list_files",
      "planning_questionnaire",
      "read_file",
      "read_guide",
      "read_logs",
      "rename_file",
      "run_type_checks",
      "search_replace",
      "set_chat_summary",
      "update_todos",
      "web_crawl",
      "web_fetch",
      "web_search",
      "write_file",
    ]);
  }, 30_000);
});
