// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startFakeLlmServer,
  type FakeLlmServerHandle,
} from "../../testing/fake-llm-server/index";

describe("fake Responses API routing", () => {
  let server: FakeLlmServerHandle;
  let dumpDir: string;

  beforeAll(async () => {
    dumpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-responses-test-"));
    vi.stubEnv("FAKE_LLM_DUMP_DIR", dumpDir);
    vi.stubEnv("FAKE_LLM_QUIET", "1");
    server = await startFakeLlmServer();
  });

  afterAll(async () => {
    await server?.close();
    vi.unstubAllEnvs();
    await fs.rm(dumpDir, { recursive: true, force: true });
  });

  function request(input: string, stream = false, key = "testdyadkey") {
    return fetch(`${server.url}/engine/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: [
          { role: "user", content: [{ type: "input_text", text: input }] },
        ],
        stream,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  }

  it("rejects invalid engine keys inside an HTTP 200 event stream", async () => {
    const response = await request(
      "What number is after four?",
      true,
      "invalid-dyad-key",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("401 LiteLLM Virtual Key expected");
    expect(body).not.toContain("response.completed");
  });

  it.each([false, true])(
    "preserves dump probes over legacy fixtures (stream=%s)",
    async (stream) => {
      const input = "[dump] tc=basic";
      const response = await request(input, stream);
      expect(response.ok).toBe(true);
      const body = await response.text();
      expect(body).toContain("[[dyad-dump-path=");
      expect(body).not.toContain("This is a simple basic response");
      const dumps = await Promise.all(
        (await fs.readdir(dumpDir)).map(async (file) =>
          JSON.parse(await fs.readFile(path.join(dumpDir, file), "utf8")),
        ),
      );
      expect(
        dumps.some((dump) => dump.body.input[0].content[0].text === input),
      ).toBe(true);
    },
  );

  it.each([
    ["calculator_add", "allow", "safe tool"],
    ["delete_file", "ask", "destructive tool"],
    ["print_envs", "allow", "safe tool"],
  ])(
    "classifies %s without executing quoted conversation fixtures",
    async (tool, decision, reason) => {
      const response = await request(
        [
          "MCP server: testing-mcp-server",
          `Tool: ${tool}`,
          "Arguments: {}",
          "Recent conversation (oldest first):",
          "user: tc=local-agent/mcp-calculator",
        ].join("\n"),
      );
      const body = await response.json();
      expect(JSON.parse(body.output_text)).toEqual({ decision, reason });
      expect(
        body.output.every((item: { type: string }) => item.type === "message"),
      ).toBe(true);
    },
    10_000,
  );
});
