// @vitest-environment node
// npm run test:live:supabase-logs creates and deletes one real Supabase project.
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { apps, chats } from "@/db/schema";
import { registerSettingsHandlers } from "@/ipc/handlers/settings_handlers";
import { registerSupabaseHandlers } from "@/ipc/handlers/supabase_handlers";
import type { ConsoleEntry } from "@/ipc/types";
import { readLogsTool } from "@/pro/main/ipc/handlers/local_agent/tools/read_logs";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { SUPABASE_LOG_RECENT_OVERLAP_MS } from "@/shared/supabase_edge_logs";
import {
  fetchSupabaseFunctionLogPage,
  supabaseFunctionLogCache,
} from "@/supabase_admin/supabase_edge_logs_service";
import {
  SupabaseLogCache,
  type SupabaseLogCacheOptions,
  type SupabaseLogScope,
  type TimeRange,
} from "@/supabase_admin/supabase_log_cache";
import * as management from "@/supabase_admin/supabase_management_client";
import {
  setupHandlerTestHarness,
  type HandlerTestHarness,
} from "@/testing/handler_test_harness";
import {
  deleteLiveLogsProject,
  deployLogProbe,
  invokeLogProbe,
  liveSupabaseCredentials,
  loadProbeRows,
  waitForLiveCondition,
} from "./supabase_edge_logs_live_fixture";

const settings = vi.hoisted(() => ({
  readSettings: vi.fn(),
  readEffectiveSettings: vi.fn(),
  writeSettings: vi.fn(),
}));
vi.mock("@/main/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/settings")>()),
  ...settings,
}));

const MINUTE = 60_000;
const APP_ID = 1;
const CHAT_ID = 1;
const getPage = management.getSupabaseProjectLogs;

describe.runIf(process.env.DYAD_LIVE_SUPABASE_LOGS === "1")(
  "live Supabase Edge Function logs",
  {
    timeout: 5 * MINUTE,
  },
  () => {
    const marker = randomUUID();
    let harness: HandlerTestHarness;
    let projectRef: string;
    let organizationSlug: string;
    let token: string;
    let functionUrl: string;
    let beforeProject: TimeRange;
    let window: TimeRange;
    let rows: management.SupabaseProjectLog[];
    let scope: SupabaseLogScope;

    beforeAll(async () => {
      ({ organizationSlug, token } = liveSupabaseCredentials());
      harness = setupHandlerTestHarness({
        settings: {
          autoFetchSupabaseEdgeFunctionLogs: false,
          supabase: organizationCredentials(token),
        },
      });
      settings.readSettings.mockImplementation(harness.readSettings);
      settings.readEffectiveSettings.mockImplementation(async () =>
        harness.readSettings(),
      );
      settings.writeSettings.mockImplementation(harness.writeSettings);
      registerSupabaseHandlers();
      registerSettingsHandlers();

      const start = Date.now() - MINUTE;
      beforeProject = { start: start - MINUTE, end: start };
      // Assign immediately so teardown also runs if readiness, deploy or ingestion fails.
      projectRef = (
        await management.createSupabaseProject({
          organizationSlug,
          name: `dyad-logs-${marker}`,
          region: "us-east-1",
        })
      ).id;
      console.info(
        `Live Supabase logs project ${projectRef}, marker ${marker}`,
      );
      scope = { projectRef, organizationSlug, source: "function_logs" };
      harness.db
        .insert(apps)
        .values({
          id: APP_ID,
          name: "Live logs",
          path: "live-logs",
          supabaseProjectId: projectRef,
          supabaseOrganizationSlug: organizationSlug,
        })
        .run();
      harness.db.insert(chats).values({ id: CHAT_ID, appId: APP_ID }).run();

      functionUrl = await deployLogProbe(projectRef, organizationSlug, token);
      await invokeLogProbe(functionUrl, marker);
      rows = await loadProbeRows(projectRef, organizationSlug, marker, start);
      expect(rows).toHaveLength(5);
      window = {
        start: rows[0].timestamp,
        end: rows[rows.length - 1].timestamp + 1,
      };
    }, 18 * MINUTE);

    afterAll(async () => {
      try {
        if (projectRef) await deleteLiveLogsProject(projectRef, token);
      } finally {
        harness?.dispose();
      }
    }, 3 * MINUTE);

    // Observe the production client boundary. The optional gate holds a real
    // response until both readers have joined the same request.
    const pages: (TimeRange & { limit?: number; ids: string[] })[] = [];
    let responseGate: Promise<void> | undefined;
    beforeEach(() => {
      pages.length = 0;
      supabaseFunctionLogCache.clear();
      const observer = vi
        .spyOn(management, "getSupabaseProjectLogs")
        .mockImplementation(async (ref, params) => {
          const page = {
            start: params.timestampStart,
            end: params.timestampEnd,
            limit: params.limit,
            ids: [] as string[],
          };
          pages.push(page);
          const result = await getPage(ref, params);
          page.ids = result.result.map((row) => row.id);
          await responseGate;
          return result;
        });
      return () => observer.mockRestore();
    });
    afterEach(({ task }) => {
      if (task.result?.state === "fail") {
        console.error("Live Supabase log reads", { projectRef, marker, pages });
      }
      responseGate = undefined;
    });

    function requestedRanges() {
      return pages.map(({ start, end }) => ({ start, end }));
    }

    // The day-long expiry keeps the client from refreshing the token, so the
    // access token is sent to Supabase exactly as given.
    function organizationCredentials(accessToken: string) {
      return {
        organizations: {
          [organizationSlug]: {
            accessToken: { value: accessToken },
            refreshToken: { value: "" },
            tokenTimestamp: Math.floor(Date.now() / 1000),
            expiresIn: 86_400,
          },
        },
      };
    }

    // Independent cache instances use the production page fetcher. Only the
    // cache clock advances; provider queries always use real event timestamps.
    function cacheReader(
      options: Omit<SupabaseLogCacheOptions, "fetchPage"> = {},
    ) {
      const cache = new SupabaseLogCache({
        fetchPage: fetchSupabaseFunctionLogPage,
        now: () => window.end + 3 * MINUTE,
        ...options,
      });
      return (range: TimeRange) => cache.query({ scope, ...range });
    }

    function readFromAgent(level?: "error") {
      return readLogsTool.execute(
        {
          type: "edge-function",
          searchTerm: marker,
          level,
          startTime: new Date(window.start).toISOString(),
          endTime: new Date(window.end - 1).toISOString(),
        },
        { chatId: CHAT_ID, onXmlComplete: vi.fn() } as unknown as AgentContext,
      );
    }

    it("reads info, warn and error on demand with background polling disabled", async () => {
      expect(harness.readSettings().autoFetchSupabaseEdgeFunctionLogs).toBe(
        false,
      );
      const result = await readFromAgent();
      for (const level of ["info", "warn", "error"]) {
        const line = result
          .split("\n")
          .find((line) => line.includes(`${marker}/${level}`));
        expect(line).toContain(`[${level.toUpperCase()}] [edge-function]`);
      }
      expect(result).not.toContain("Partial results");
      expect(requestedRanges()).toEqual([window]);
    });

    it("caches only the queried milliseconds inside a rounded provider minute", async () => {
      const { id, timestamp } = rows[0];
      const read = cacheReader();
      const atMarker = { start: timestamp, end: timestamp + 1 };
      const beforeMarker = { start: timestamp - 1, end: timestamp };
      const hit = await read(atMarker);
      expect(hit.logs.map((row) => row.id)).toContain(id);
      const before = await read(beforeMarker);
      expect(before.missingRanges).toEqual([]);
      expect(before.logs.map((row) => row.id)).not.toContain(id);
      expect(requestedRanges()).toEqual([atMarker, beforeMarker]);
      expect(pages[0].ids).toContain(id);
      expect(pages[1].ids).not.toContain(id);
    });

    it("reuses settled and empty coverage and fetches only an older missing interval", async () => {
      const read = cacheReader();
      const split = rows[2].timestamp;
      const newer = { start: split, end: window.end };
      const older = { start: window.start, end: split };
      const first = await read(newer);
      expect(first.missingRanges).toEqual([]);
      expect((await read(newer)).logs).toEqual(first.logs);
      expect(
        (await read({ start: split, end: split + 1 })).providerRequests,
      ).toBe(0);
      const extended = await read(window);
      expect(extended.missingRanges).toEqual([]);
      expect(
        extended.logs
          .filter((row) => row.message.includes(marker))
          .map((row) => row.id),
      ).toEqual(rows.map((row) => row.id));
      for (let i = 0; i < 2; i++) {
        expect(await read(beforeProject)).toMatchObject({
          logs: [],
          error: null,
          missingRanges: [],
        });
      }
      expect(requestedRanges()).toEqual([newer, older, beforeProject]);
    });

    it("refreshes exactly the last two minutes of a fixed window until a final successful refresh settles it", async () => {
      const freshMarker = randomUUID();
      const end = (await invokeLogProbe(functionUrl, freshMarker)) + 1;
      const range = { start: end - 5 * MINUTE, end };
      const tail = { start: end - 2 * MINUTE, end };
      let now = end;
      const read = cacheReader({ now: () => now });
      expect((await read(range)).missingRanges).toEqual([]);
      expect(requestedRanges()).toEqual([range]);
      // Always repeat the same read at least once, even on immediate ingestion.
      await waitForLiveCondition(
        `Read ${freshMarker} from ${projectRef}`,
        3 * MINUTE,
        async () => {
          const pageCount = pages.length;
          const result = await read(range);
          expect(result.missingRanges).toEqual([]);
          expect(requestedRanges().slice(pageCount)).toEqual([tail]);
          if (
            !result.logs.some((row) =>
              row.message.includes(freshMarker + "/error"),
            )
          ) {
            return `marker still missing from [${range.start}, ${end})`;
          }
        },
      );
      now += 3 * MINUTE;
      pages.length = 0;
      const refreshed = await read(range);
      expect(refreshed).toMatchObject({
        missingRanges: [],
        error: null,
        providerRequests: 1,
      });
      expect((await read(range)).logs).toEqual(refreshed.logs);
      expect(requestedRanges()).toEqual([tail]);
    });

    it("makes a new invocation's logs readable within the provisional refresh window", async () => {
      const freshMarker = randomUUID();
      const invokedAt = Date.now();
      await invokeLogProbe(functionUrl, freshMarker);
      const fresh = await loadProbeRows(
        projectRef,
        organizationSlug,
        freshMarker,
        invokedAt - MINUTE,
      );
      // An upper bound: all five rows were readable by now, measured from the
      // oldest row's own timestamp. The cache stops refetching a range once it
      // is this much older than a fetch, so slower ingestion would lose rows.
      const delay = Date.now() - fresh[0].timestamp;
      console.info(
        `Live Supabase logs ingestion delay: at most ${delay} ms of ${SUPABASE_LOG_RECENT_OVERLAP_MS} ms`,
      );
      expect(delay).toBeLessThan(SUPABASE_LOG_RECENT_OVERLAP_MS);
    });

    it("shares an in-flight page across polling and filtered agent reads and preserves distinct identical events", async () => {
      harness.writeSettings({ autoFetchSupabaseEdgeFunctionLogs: true });
      // Both entry points see the same fixed window even if the suite is slow.
      const clock = vi.spyOn(Date, "now").mockReturnValue(window.end);
      onTestFinished(() => clock.mockRestore());
      const queries = vi.spyOn(supabaseFunctionLogCache, "query");
      onTestFinished(() => queries.mockRestore());
      let release!: () => void;
      responseGate = new Promise((resolve) => {
        release = resolve;
      });
      const pending: Promise<unknown>[] = [];
      try {
        const poll = harness.invokeHandler<{
          entries: ConsoleEntry[];
          warning?: string;
        }>("supabase:get-edge-logs", {
          appId: APP_ID,
          projectId: projectRef,
          organizationSlug,
          timestampStart: window.start,
        });
        pending.push(poll);
        await vi.waitFor(() => expect(pages).toHaveLength(1));
        const agent = readFromAgent("error");
        pending.push(agent);
        await vi.waitFor(() => expect(queries).toHaveBeenCalledTimes(2));
        release();
        const [polled, filtered] = await Promise.all([poll, agent]);
        expect(requestedRanges()).toEqual([window]);
        expect(polled.warning).toBeUndefined();
        expect(filtered).toContain(marker + "/error");
        expect(filtered).not.toContain(marker + "/info");
        const duplicates = polled.entries.filter((entry) =>
          entry.message.includes(marker + "/duplicate"),
        );
        expect(duplicates.map((entry) => entry.providerLogId).sort()).toEqual(
          rows
            .filter((row) => row.event_message.includes(marker + "/duplicate"))
            .map((row) => row.id)
            .sort(),
        );
        expect(
          new Set(duplicates.map((entry) => entry.providerLogId)).size,
        ).toBe(2);
        const unfiltered = await readFromAgent();
        expect(unfiltered).toContain(marker + "/info");
        expect(unfiltered.split(marker + "/duplicate")).toHaveLength(3);
      } finally {
        release();
        await Promise.allSettled(pending);
        harness.writeSettings({ autoFetchSupabaseEdgeFunctionLogs: false });
      }
    });

    it("pages backwards and leaves truncated history available for a narrower read", async () => {
      const read = cacheReader({ pageSize: 3 });
      const complete = await read(window);
      expect(complete).toMatchObject({
        missingRanges: [],
        truncated: false,
        error: null,
      });
      expect(
        complete.logs
          .filter((row) => row.message.includes(marker))
          .map((row) => row.id),
      ).toEqual(rows.map((row) => row.id));
      expect(pages.length).toBeGreaterThan(1);
      expect(pages.every((page) => page.limit === 3)).toBe(true);

      const readOnePage = cacheReader({ pageSize: 3, maxPagesPerRange: 1 });
      const partial = await readOnePage(window);
      expect(partial.truncated).toBe(true);
      expect(partial.error).toBeNull();
      expect(partial.logs).toHaveLength(3);
      expect(partial.missingRanges).toEqual([
        { start: window.start, end: partial.logs[0].timestamp + 1 },
      ]);
      const firstMillisecond = { start: window.start, end: window.start + 1 };
      pages.length = 0;
      const recovered = await readOnePage(firstMillisecond);
      expect(recovered.missingRanges).toEqual([]);
      expect(recovered.logs.map((row) => row.id)).toContain(rows[0].id);
      expect(requestedRanges()).toEqual([firstMillisecond]);
    });

    it("reports a rejected token as an auth failure to polling and the agent without caching it", async () => {
      // Both entry points see the same fixed window even if the suite is slow.
      const clock = vi.spyOn(Date, "now").mockReturnValue(window.end);
      onTestFinished(() => clock.mockRestore());
      const credentials = harness.readSettings().supabase;
      // Well formed, but not a token Supabase has issued.
      harness.writeSettings({
        supabase: organizationCredentials(`sbp_${"0".repeat(40)}`),
      });
      try {
        const polled = await harness.invokeHandler<{
          entries: ConsoleEntry[];
          warning?: string;
          retryFrom?: number;
          authFailed?: boolean;
        }>("supabase:get-edge-logs", {
          appId: APP_ID,
          projectId: projectRef,
          organizationSlug,
          timestampStart: window.start,
        });
        expect(polled).toMatchObject({
          entries: [],
          authFailed: true,
          retryFrom: window.start,
        });
        expect(polled.warning).toContain("Reconnect your Supabase account");
        const rejected = await readFromAgent();
        expect(rejected).toContain("could not be fetched");
        expect(rejected).toContain("Reconnect your Supabase account");
        expect(rejected).not.toContain(marker + "/info");
        expect(requestedRanges()).toEqual([window, window]);
      } finally {
        harness.writeSettings({ supabase: credentials });
      }
      expect(await readFromAgent()).toContain(marker + "/info");
      expect(requestedRanges()).toEqual([window, window, window]);
    });

    it("invalidates settled logs on disconnect and refetches after reconnect", async () => {
      const clock = vi
        .spyOn(Date, "now")
        .mockReturnValue(window.end + 3 * MINUTE);
      onTestFinished(() => clock.mockRestore());
      const credentials = harness.readSettings().supabase;
      expect(await readFromAgent()).toContain(marker + "/info");
      expect(await readFromAgent()).toContain(marker + "/info");
      expect(requestedRanges()).toEqual([window]);
      await harness.invokeHandler("set-user-settings", { supabase: undefined });
      try {
        const disconnected = await readFromAgent();
        expect(disconnected).toContain("Partial results");
        expect(disconnected).not.toContain(marker + "/info");
        expect(requestedRanges()).toEqual([window]);
      } finally {
        harness.writeSettings({ supabase: credentials });
      }
      expect(await readFromAgent()).toContain(marker + "/info");
      expect(requestedRanges()).toEqual([window, window]);
    });
  },
);
