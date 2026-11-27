import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  deploySupabaseFunction,
  getSupabaseProjectLogs,
  type SupabaseProjectLog,
} from "@/supabase_admin/supabase_management_client";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";

const MINUTE = 60_000;

export function liveSupabaseCredentials() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const organizationSlug = process.env.SUPABASE_ORG_SLUG;
  if (!token || !organizationSlug) {
    throw new Error(
      "Set SUPABASE_ACCESS_TOKEN and SUPABASE_ORG_SLUG to run the live Supabase logs suite.",
    );
  }
  if (IS_TEST_BUILD)
    throw new Error("Unset E2E_TEST_BUILD to use live Supabase.");
  return { token, organizationSlug };
}

// check returns a description of what is still pending, or undefined on success.
export async function waitForLiveCondition(
  label: string,
  timeoutMs: number,
  check: () => Promise<string | undefined>,
) {
  const deadline = Date.now() + timeoutMs;
  let interval = 1_000;
  for (;;) {
    const pending = await check();
    if (pending === undefined) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${label}: ${pending}`);
    await delay(Math.min(remaining, interval));
    interval = Math.min(interval * 2, 10_000);
  }
}

// Only GET and DELETE are retried. A missing project during provisioning can
// be transient, and a missing project during teardown is already cleaned up.
async function projectRequest(
  projectRef: string,
  token: string,
  method: "GET" | "DELETE",
) {
  return fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
}

export async function deleteLiveLogsProject(projectRef: string, token: string) {
  await waitForLiveCondition(
    `Delete live Supabase project ${projectRef}`,
    2 * MINUTE,
    async () => {
      const response = await projectRequest(projectRef, token, "DELETE").catch(
        () => undefined,
      );
      if (response?.ok || response?.status === 404) return;
      return `DELETE returned ${response?.status ?? "a network error"}`;
    },
  );
}

export async function deployLogProbe(
  projectRef: string,
  organizationSlug: string,
  token: string,
) {
  await waitForLiveCondition(
    `Provision project ${projectRef}`,
    6 * MINUTE,
    async () => {
      const response = await projectRequest(projectRef, token, "GET").catch(
        () => undefined,
      );
      if (
        !response ||
        response.status === 404 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        return `GET returned ${response?.status ?? "a network error"}`;
      }
      if (!response.ok)
        throw new Error(`Read project ${projectRef}: HTTP ${response.status}`);
      const { status } = await response.json();
      if (status !== "ACTIVE_HEALTHY") return `project status ${status}`;
    },
  );

  const deployed = await deploySupabaseFunction({
    supabaseProjectId: projectRef,
    organizationSlug,
    appPath: path.resolve("testing/fixtures/supabase-edge-logs"),
    functionName: "log-probe",
    signal: AbortSignal.timeout(2 * MINUTE),
  });
  const url = `https://${projectRef}.supabase.co/functions/v1/${deployed.slug}`;
  await waitForLiveCondition(`Wait for ${url}`, 2 * MINUTE, async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
    if (!response?.ok || (await response.text()) !== "ready") {
      return `function readiness GET returned ${response?.status ?? "a network error"}`;
    }
  });
  return url;
}

export async function invokeLogProbe(
  url: string,
  marker: string,
): Promise<number> {
  // POST exactly once. An ambiguous network failure must not generate a
  // second set of identical fixture events.
  const response = await fetch(url, {
    method: "POST",
    body: marker,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Invoke ${url} for ${marker}: HTTP ${response.status}`);
  }
  const receipt = await response.json();
  if (receipt.marker !== marker || !Number.isSafeInteger(receipt.finishedAt)) {
    throw new Error(`Invalid invocation receipt from ${url} for ${marker}`);
  }
  return receipt.finishedAt;
}

export async function loadProbeRows(
  projectRef: string,
  organizationSlug: string,
  marker: string,
  start: number,
) {
  let rows: SupabaseProjectLog[] = [];
  await waitForLiveCondition(
    `Ingest logs for ${projectRef} marker ${marker}`,
    3 * MINUTE,
    async () => {
      const end = Date.now();
      const page = await getSupabaseProjectLogs(projectRef, {
        organizationSlug,
        timestampStart: start,
        timestampEnd: end,
        signal: AbortSignal.timeout(45_000),
      });
      if (page.error)
        throw new Error(
          `Supabase logs query failed: ${JSON.stringify(page.error)}`,
        );
      rows = page.result
        .filter((row) => row.event_message.includes(marker))
        .sort((a, b) => a.timestamp - b.timestamp);
      if (rows.length < 5)
        return `range [${start}, ${end}), observed IDs ${JSON.stringify(rows.map((row) => row.id))}`;
    },
  );
  return rows;
}
