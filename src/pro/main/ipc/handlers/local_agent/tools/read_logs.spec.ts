import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsoleEntry } from "@/ipc/types";
import { addLogs, clearLogs } from "@/lib/log_store";
import { supabaseFunctionLogCache } from "@/supabase_admin/supabase_edge_logs_service";
import type { SupabaseProjectLog } from "@/supabase_admin/supabase_management_client";
import { readLogsTool } from "./read_logs";
import type { AgentContext } from "./types";

const MINUTE = 60_000;
// 2026-11-18T12:00:30Z: deliberately not minute aligned.
const NOW = Date.UTC(2026, 10, 18, 12, 0, 30);
const APP_ID = 7;

const h = vi.hoisted(() => ({
  app: null as null | {
    id: number;
    supabaseProjectId: string | null;
    supabaseOrganizationSlug: string | null;
  },
  /** App association as seen after the fetch, for relink tests. */
  appAfterFetch: undefined as
    | undefined
    | {
        supabaseProjectId: string | null;
        supabaseOrganizationSlug: string | null;
      },
  settings: {} as Record<string, unknown>,
  providerRows: [] as SupabaseProjectLog[],
  providerCalls: [] as {
    projectId: string;
    organizationSlug: string | null | undefined;
    timestampStart: number;
    timestampEnd: number;
  }[],
  providerError: null as Error | null,
  providerGate: null as Promise<void> | null,
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      chats: {
        findFirst: vi.fn(async () => (h.app ? { id: 1, app: h.app } : null)),
      },
      apps: {
        findFirst: vi.fn(async () => h.appAfterFetch ?? h.app),
      },
    },
  },
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => h.settings,
}));

vi.mock("@/supabase_admin/supabase_management_client", () => ({
  getSupabaseProjectLogs: vi.fn(
    async (
      projectId: string,
      options: {
        organizationSlug?: string | null;
        timestampStart: number;
        timestampEnd: number;
        limit: number;
        signal?: AbortSignal;
      },
    ) => {
      h.providerCalls.push({
        projectId,
        organizationSlug: options.organizationSlug,
        timestampStart: options.timestampStart,
        timestampEnd: options.timestampEnd,
      });
      if (h.providerGate) {
        await new Promise<void>((resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(options.signal?.reason),
          );
          h.providerGate!.then(resolve);
        });
      }
      if (h.providerError) throw h.providerError;
      return {
        result: h.providerRows
          .filter(
            (row) =>
              row.timestamp >= options.timestampStart &&
              row.timestamp < options.timestampEnd,
          )
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, options.limit),
      };
    },
  ),
}));

function supabaseRow(
  id: string,
  timestamp: number,
  message: string,
  level: SupabaseProjectLog["level"] = "info",
): SupabaseProjectLog {
  return { id, timestamp, event_message: message, level };
}

function localLog(
  message: string,
  timestamp: number,
  overrides: Partial<ConsoleEntry> = {},
): ConsoleEntry {
  return {
    level: "info",
    type: "client",
    message,
    timestamp,
    appId: APP_ID,
    ...overrides,
  };
}

function makeContext(signal?: AbortSignal) {
  const onXmlComplete = vi.fn();
  return {
    ctx: {
      chatId: 1,
      onXmlComplete,
      abortSignal: signal,
    } as unknown as AgentContext,
    onXmlComplete,
  };
}

async function run(
  args: Parameters<typeof readLogsTool.execute>[0],
  signal?: AbortSignal,
) {
  const { ctx, onXmlComplete } = makeContext(signal);
  const result = (await readLogsTool.execute(args, ctx)) as string;
  return { result, xml: onXmlComplete.mock.calls[0]?.[0] as string };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.app = {
    id: APP_ID,
    supabaseProjectId: "proj-1",
    supabaseOrganizationSlug: "org-1",
  };
  h.appAfterFetch = undefined;
  h.settings = {
    supabase: { organizations: { "org-1": { accessToken: { value: "t" } } } },
    // Polling is off; read_logs must fetch on demand regardless.
    autoFetchSupabaseEdgeFunctionLogs: false,
  };
  h.providerRows = [];
  h.providerCalls = [];
  h.providerError = null;
  h.providerGate = null;
  supabaseFunctionLogCache.clear();
  clearLogs(APP_ID);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("read_logs", () => {
  it("stays available in read-only modes", () => {
    expect(readLogsTool.modifiesState).toBeFalsy();
    expect(readLogsTool.description).toContain("startTime");
    expect(readLogsTool.description).toContain("only retains the most recent");
  });

  it("fetches Edge Function logs on demand with polling disabled", async () => {
    h.providerRows = [
      supabaseRow("e1", NOW - 2 * MINUTE, "[hello] edge failure", "error"),
    ];
    addLogs([localLog("client message", NOW - MINUTE)]);

    const { result, xml } = await run({});

    expect(h.providerCalls).toEqual([
      {
        projectId: "proj-1",
        organizationSlug: "org-1",
        // The last five minutes, widened to whole minutes.
        timestampStart: Date.UTC(2026, 10, 18, 11, 55, 0),
        timestampEnd: Date.UTC(2026, 10, 18, 12, 1, 0),
      },
    ]);
    // Chronological, with the function name parsed from the message.
    expect(result).toMatch(
      /\[ERROR\] \[edge-function\] \[hello\] \[hello\] edge failure[\s\S]*client message/,
    );
    expect(result).toContain(
      "Time: last 5 minutes (2026-11-18T11:55:30.000Z to 2026-11-18T12:00:30.000Z)",
    );
    expect(xml).toContain('count="2"');
    expect(result).not.toContain("Partial results");
  });

  it.each(["client", "server", "network-requests"] as const)(
    "skips Supabase for type=%s",
    async (type) => {
      h.providerRows = [supabaseRow("e1", NOW - MINUTE, "edge")];
      await run({ type });
      expect(h.providerCalls).toEqual([]);
    },
  );

  it("fetches Supabase for type=edge-function and excludes other sources", async () => {
    h.providerRows = [supabaseRow("e1", NOW - MINUTE, "edge only")];
    addLogs([localLog("client message", NOW - MINUTE)]);
    const { result } = await run({ type: "edge-function" });
    expect(h.providerCalls).toHaveLength(1);
    expect(result).toContain("edge only");
    expect(result).not.toContain("client message");
  });

  it("applies one explicit historical window to Supabase and local logs", async () => {
    const start = Date.UTC(2026, 10, 18, 9, 0, 0);
    const end = Date.UTC(2026, 10, 18, 10, 0, 0);
    h.providerRows = [
      supabaseRow("before", start - 1, "edge before"),
      supabaseRow("inside", start + 30 * MINUTE, "edge inside"),
      supabaseRow("at-end", end, "edge at end"),
      supabaseRow("after", end + 1, "edge after"),
    ];
    addLogs([
      localLog("local inside", start + 10 * MINUTE),
      localLog("local after", end + 1),
    ]);

    const { result } = await run({
      startTime: "2026-11-18T09:00:00Z",
      endTime: "2026-11-18T05:00:00-05:00",
    });

    expect(h.providerCalls).toEqual([
      expect.objectContaining({
        timestampStart: start,
        timestampEnd: end + MINUTE,
      }),
    ]);
    expect(result).toContain("edge inside");
    expect(result).toContain("edge at end");
    expect(result).toContain("local inside");
    expect(result).not.toContain("edge before");
    expect(result).not.toContain("edge after");
    expect(result).not.toContain("local after");
    expect(result).toContain(
      "Time: 2026-11-18T09:00:00.000Z to 2026-11-18T10:00:00.000Z (1 hour)",
    );
  });

  it("ends at the call time when only startTime is given", async () => {
    const { result } = await run({ startTime: "2026-11-18T11:00:00Z" });
    expect(result).toContain(
      "Time: 2026-11-18T11:00:00.000Z to 2026-11-18T12:00:30.000Z",
    );
  });

  it("reads the five minutes before endTime when only endTime is given", async () => {
    const { result } = await run({ endTime: "2026-11-18T11:00:00Z" });
    expect(result).toContain(
      "Time: 2026-11-18T10:55:00.000Z to 2026-11-18T11:00:00.000Z (5 minutes)",
    );
  });

  it.each([
    [{ startTime: "2026-11-18T11:00:00" }, "explicit timezone"],
    [{ startTime: "yesterday" }, "explicit timezone"],
    [{ startTime: "2026-02-31T00:00:00Z" }, "not a valid date"],
    [{ endTime: "2026-02-29T12:00:00+05:00" }, "not a valid date"],
    [{ endTime: "2026-04-31T12:00:00-05:00" }, "not a valid date"],
    [{ endTime: "1900-02-29T00:00:00Z" }, "not a valid date"],
    [
      { startTime: "2026-11-18T11:00:00Z", endTime: "2026-11-18T10:00:00Z" },
      "must be before endTime",
    ],
    [{ endTime: "2026-11-18T13:00:00Z" }, "is in the future"],
    [{ startTime: "2026-11-18T12:30:00Z" }, "is in the future"],
    [{ startTime: "2026-11-17T11:00:00Z" }, "at most 24 hours"],
  ])("rejects invalid windows: %j", async (args, message) => {
    await expect(run(args)).rejects.toThrow(message);
    expect(h.providerCalls).toEqual([]);
  });

  it.each([
    ["2000-02-29T00:00:00Z", "2000-02-29T00:00:00.000Z"],
    ["2024-02-29T00:30:00+02:00", "2024-02-28T22:30:00.000Z"],
    ["2024-02-29T23:30:00-02:00", "2024-03-01T01:30:00.000Z"],
  ])(
    "accepts valid leap dates across timezone boundaries: %s",
    async (endTime, expected) => {
      const { result } = await run({ endTime });
      expect(result).toContain(`to ${expected}`);
    },
  );

  it("keeps search text literal for the model and escapes it once for XML", async () => {
    const searchTerm = '<tag> & "quoted"';
    const escaped = '&lt;tag&gt; &amp; "quoted"';
    const { result, xml } = await run({ searchTerm });
    expect(result).toContain(`Search: "${searchTerm}"`);
    expect(result).not.toContain("&lt;");
    expect(xml).toContain(escaped);
    expect(xml).not.toContain("&amp;lt;");
    const preview = readLogsTool.buildXml!({ searchTerm }, false);
    expect(preview).toContain(escaped);
    expect(preview).not.toContain(searchTerm);
  });

  it("filters after fetching so a filtered read does not hide logs from the next", async () => {
    h.providerRows = [
      supabaseRow("e1", NOW - 4 * MINUTE, "needle", "error"),
      supabaseRow("e2", NOW - 4 * MINUTE, "haystack", "info"),
    ];
    const endTime = new Date(NOW - 3 * MINUTE).toISOString();
    const filtered = await run({
      searchTerm: "needle",
      level: "error",
      endTime,
    });
    expect(filtered.result).toContain("needle");
    expect(filtered.result).not.toContain("haystack");

    const all = await run({ endTime });
    expect(all.result).toContain("needle");
    expect(all.result).toContain("haystack");
    // Settled, unfiltered history remains reusable across reads.
    expect(h.providerCalls).toHaveLength(1);
  });

  it("keeps the newest matching logs within the limit, oldest first", async () => {
    h.providerRows = Array.from({ length: 5 }, (_, index) =>
      supabaseRow(`e${index}`, NOW - (5 - index) * 30_000, `edge ${index}`),
    );
    const { result } = await run({ limit: 2 });
    expect(result).toMatch(/edge 3[\s\S]*edge 4/);
    expect(result).not.toContain("edge 2");
  });

  it("keeps local logs and warns when Supabase fails", async () => {
    h.providerError = new Error("Supabase is unavailable");
    addLogs([localLog("client message", NOW - MINUTE)]);

    const { result } = await run({});

    expect(result).toContain("client message");
    expect(result).toContain("Partial results");
    expect(result).toContain("Supabase is unavailable");
  });

  it("does not report a provider failure as no logs found", async () => {
    h.providerError = new Error("Supabase is unavailable");
    const { result } = await run({ type: "edge-function" });
    expect(result).not.toContain("No logs found matching");
    expect(result).toContain("could not be fetched");
    expect(result).toContain(
      "not the same as there being no Edge Function logs",
    );
  });

  it("reports truncation when Supabase returns a capped page", async () => {
    // More rows in one minute than a page holds, so paging cannot finish.
    h.providerRows = Array.from({ length: 1001 }, (_, index) =>
      supabaseRow(`e${index}`, NOW - MINUTE + index, `edge ${index}`),
    );
    const { result } = await run({});
    expect(result).toContain("Partial results");
    expect(result).toContain("narrower startTime/endTime window");
  });

  it("preserves current behavior for apps without Supabase", async () => {
    h.app = {
      id: APP_ID,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
    };
    const { result } = await run({});
    expect(h.providerCalls).toEqual([]);
    expect(result).toContain("No logs found matching the specified filters.");
    expect(result).not.toContain("Partial results");
  });

  it("does not fetch without credentials for the app's organization", async () => {
    h.settings = {};
    const { result } = await run({});
    expect(h.providerCalls).toEqual([]);
    expect(result).not.toContain("Partial results");
  });

  it("omits logs fetched for a project the app was unlinked from", async () => {
    h.providerRows = [supabaseRow("e1", NOW - MINUTE, "old project log")];
    h.appAfterFetch = {
      supabaseProjectId: "proj-2",
      supabaseOrganizationSlug: "org-1",
    };
    const { result } = await run({});
    expect(result).not.toContain("old project log");
    expect(result).toContain("Supabase project changed");
  });

  it("does not duplicate a log already present in the local store", async () => {
    h.providerRows = [supabaseRow("e1", NOW - MINUTE, "edge once")];
    addLogs([
      localLog("edge once", NOW - MINUTE, {
        type: "edge-function",
        providerLogId: "e1",
      }),
    ]);
    const { result } = await run({});
    expect(result.match(/edge once/g)).toHaveLength(1);
  });

  it("propagates cancellation", async () => {
    let release!: () => void;
    h.providerGate = new Promise((resolve) => (release = resolve));
    const controller = new AbortController();
    const pending = run({}, controller.signal);
    await vi.waitFor(() => expect(h.providerCalls).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toThrow();
    release();
  });

  it("shows the requested window while streaming", () => {
    expect(readLogsTool.buildXml?.({}, false)).toContain(
      "Time: last 5 minutes",
    );
    expect(
      readLogsTool.buildXml?.(
        {
          startTime: "2026-11-18T09:00:00+01:00",
          endTime: "2026-11-18T10:00:00Z",
        },
        false,
      ),
    ).toContain("Time: 2026-11-18T08:00:00.000Z to 2026-11-18T10:00:00.000Z");
    expect(
      readLogsTool.buildXml?.({ endTime: "2026-11-18T10:00:00Z" }, false),
    ).toContain("Time: 5 minutes before 2026-11-18T10:00:00.000Z");
  });
});
