import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import log from "electron-log";

import { apps, chats } from "@/db/schema";
import { registerSupabaseHandlers } from "@/ipc/handlers/supabase_handlers";
import { registerSettingsHandlers } from "@/ipc/handlers/settings_handlers";
import type { ConsoleEntry } from "@/ipc/types";
import { clearLogs, getLogs } from "@/lib/log_store";
import { readLogsTool } from "@/pro/main/ipc/handlers/local_agent/tools/read_logs";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { supabaseFunctionLogCache } from "@/supabase_admin/supabase_edge_logs_service";
import {
  setupHandlerTestHarness,
  type HandlerTestHarness,
} from "@/testing/handler_test_harness";
import { h } from "@/testing/hybrid.setup";

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
  readEffectiveSettings: vi.fn(),
}));

// Settings storage is the harness's in-memory copy; everything that reads or
// writes it (handlers, service, cache) stays real.
vi.mock("@/main/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/settings")>()),
  readSettings: mocks.readSettings,
  writeSettings: mocks.writeSettings,
  readEffectiveSettings: mocks.readEffectiveSettings,
}));

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 18, 12, 0, 30);
const APP_ID = 7;
const CHAT_ID = 11;

describe("Supabase edge logs shared by polling and read_logs (integration)", () => {
  let harness: HandlerTestHarness;
  const originalFileLogLevel = log.transports.file.level;

  beforeEach(() => {
    log.transports.file.level = false;
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    supabaseFunctionLogCache.clear();
    clearLogs(APP_ID);
    harness = setupHandlerTestHarness({
      settings: {
        autoFetchSupabaseEdgeFunctionLogs: true,
        supabase: {
          organizations: {
            "org-1": {
              accessToken: { value: "test-token" },
              refreshToken: { value: "test-refresh-token" },
              tokenTimestamp: Math.floor(NOW / 1000),
              expiresIn: 3600,
            },
          },
        },
      },
    });
    mocks.readSettings.mockImplementation(harness.readSettings);
    mocks.writeSettings.mockImplementation(harness.writeSettings);
    mocks.readEffectiveSettings.mockImplementation(async () =>
      harness.readSettings(),
    );
    registerSupabaseHandlers();
    registerSettingsHandlers();
    harness.db
      .insert(apps)
      .values({
        id: APP_ID,
        name: "Edge logs app",
        path: "edge-logs-app",
        supabaseProjectId: "proj-1",
        supabaseOrganizationSlug: "org-1",
      })
      .run();
    harness.db.insert(chats).values({ id: CHAT_ID, appId: APP_ID }).run();
  });

  afterEach(() => {
    supabaseFunctionLogCache.clear();
    clearLogs(APP_ID);
    harness?.dispose();
    h.ipcHandlers.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    log.transports.file.level = originalFileLogLevel;
  });

  it("shares an in-flight fetch and refreshes recent rows on the next read", async () => {
    // Keep the database, handler, tool, service, cache and provider response
    // parsing real. Only the HTTP response is held at the network boundary.
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const rows = [
      {
        id: "info-log",
        timestamp: new Date(NOW - MINUTE).toISOString(),
        event_message: "[hello] request completed",
        severity_text: "info",
      },
      {
        id: "error-log",
        timestamp: new Date(NOW - 2 * MINUTE).toISOString(),
        event_message: "[hello] request failed",
        severity_text: "error",
      },
    ];
    const fetchLogs = vi.fn<typeof fetch>(async () => {
      await responseGate;
      return new Response(
        JSON.stringify({
          result: rows,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchLogs);
    // Observe entry without replacing the cache implementation, so the
    // response is released only once both consumers are actually waiting.
    const query = vi.spyOn(supabaseFunctionLogCache, "query");
    const onXmlComplete = vi.fn();
    const ctx = { chatId: CHAT_ID, onXmlComplete } as unknown as AgentContext;
    const pending: Promise<unknown>[] = [];

    try {
      const agentRead = readLogsTool.execute(
        {
          type: "edge-function",
          level: "error",
          searchTerm: "request",
          limit: 1,
        },
        ctx,
      );
      pending.push(agentRead);
      await vi.waitFor(() => expect(fetchLogs).toHaveBeenCalledTimes(1));

      // A poll overlaps the agent's default five-minute window while its
      // provider request is still in flight.
      const poll = harness.invokeHandler<{ entries: ConsoleEntry[] }>(
        "supabase:get-edge-logs",
        {
          appId: APP_ID,
          projectId: "proj-1",
          organizationSlug: "org-1",
          timestampStart: NOW - 4 * MINUTE,
        },
      );
      pending.push(poll);
      await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
      expect(fetchLogs).toHaveBeenCalledTimes(1);
      expect(onXmlComplete).not.toHaveBeenCalled();

      releaseResponse();
      const [agentResult, polledLogs] = await Promise.all([agentRead, poll]);

      expect(polledLogs.entries).toEqual([
        {
          providerLogId: "error-log",
          timestamp: NOW - 2 * MINUTE,
          message: "[hello] request failed",
          level: "error",
          type: "edge-function",
          sourceName: "hello",
          appId: APP_ID,
        },
        {
          providerLogId: "info-log",
          timestamp: NOW - MINUTE,
          message: "[hello] request completed",
          level: "info",
          type: "edge-function",
          sourceName: "hello",
          appId: APP_ID,
        },
      ]);
      expect(agentResult).toContain("request failed");
      expect(agentResult).not.toContain("request completed");
      expect(agentResult).not.toContain("Partial results");
      expect(onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining('count="1"'),
      );
      expect(fetchLogs).toHaveBeenCalledTimes(1);
      expect(new URL(String(fetchLogs.mock.calls[0][0])).pathname).toBe(
        "/v1/projects/proj-1/analytics/endpoints/logs",
      );

      // A new read refreshes the recent range without a grace period and
      // picks up delayed events, even with the clock held at the same instant.
      expect(getLogs(APP_ID)).toEqual([]);
      rows.push({
        id: "late-log",
        timestamp: new Date(NOW - 30_000).toISOString(),
        event_message: "[hello] delayed event",
        severity_text: "info",
      });
      const unfiltered = await readLogsTool.execute(
        { type: "edge-function" },
        ctx,
      );
      expect(unfiltered).toMatch(/request failed[\s\S]*request completed/);
      expect(unfiltered).toContain("delayed event");
      expect(unfiltered).not.toContain("Partial results");
      expect(onXmlComplete).toHaveBeenLastCalledWith(
        expect.stringContaining('count="3"'),
      );
      expect(fetchLogs).toHaveBeenCalledTimes(2);
    } finally {
      releaseResponse();
      await Promise.allSettled(pending);
    }
  });

  it("cancels a pending read when Disconnect All removes the credentials", async () => {
    const requestSignals: AbortSignal[] = [];
    const fetchLogs = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          if (signal) requestSignals.push(signal);
          signal?.addEventListener("abort", () => reject(signal.reason));
          // Resolves only if the request was not cancelled.
          setTimeout(
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    result: [
                      {
                        id: "disconnected-log",
                        timestamp: new Date(NOW - MINUTE).toISOString(),
                        event_message: "[hello] disconnected account",
                        severity_text: "info",
                      },
                    ],
                  }),
                  { status: 200 },
                ),
              ),
            50,
          );
        }),
    );
    vi.stubGlobal("fetch", fetchLogs);
    const ctx = {
      chatId: CHAT_ID,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    const agentRead = readLogsTool.execute({ type: "edge-function" }, ctx);
    await vi.waitFor(() => expect(fetchLogs).toHaveBeenCalledTimes(1));

    // The renderer's "Disconnect All" goes through the generic settings write.
    await harness.invokeHandler("set-user-settings", { supabase: undefined });

    expect(requestSignals[0].aborted).toBe(true);
    const result = await agentRead;
    expect(result).not.toContain("disconnected account");
    expect(result).toContain("could not be fetched");
    expect(supabaseFunctionLogCache.stats().scopes).toBe(0);
  });
});
