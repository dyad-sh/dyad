// @vitest-environment node
//
// S-CELL spike runner for the app-builder benchmark (benchmarks/app-builder/DESIGN.md §6).
// Runs ONE full (model × Relay CRM × 3 milestones) cell through the real headless
// chat pipeline in local-agent mode against the real Dyad engine, with:
//   - neon-sim as the Neon control plane + data plane + Neon Auth stand-in
//   - the engine recording proxy capturing exact per-request token usage
//
// Gated: does nothing unless APPBENCH_CELL=1.
// Run via benchmarks/app-builder/run-cell.sh (sets NODE_EXTRA_CA_CERTS, starts
// neon-sim + engine proxy, then invokes this file under the eval vitest config).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const RUN = process.env.APPBENCH_CELL === "1";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  if (process.env.APPBENCH_CELL === "1") {
    // Must be set before app modules import (dyad_engine_url reads at import time).
    process.env.DYAD_ENGINE_URL = "http://127.0.0.1:7789";
    process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL =
      "http://127.0.0.1:7789/catalog";
    process.env.DYAD_NEON_API_BASE_URL = "http://127.0.0.1:7788/api/v2";
    // The in-process Neon mock must NOT engage; neon-sim only mirrors it.
    delete process.env.E2E_TEST_BUILD;
    // node-pty is Electron-ABI; under vitest it posix_spawnp-fails (broke
    // add_dependency in early S-FORMS runs). Use the child_process fallback.
    process.env.DYAD_DISABLE_PTY = "1";
    if (!process.env.DYAD_PRO_API_KEY && process.env.DYAD_PRO_KEY) {
      process.env.DYAD_PRO_API_KEY = process.env.DYAD_PRO_KEY;
    }
  }
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

const REPO = path.resolve(__dirname, "..", "..", "..");
const BENCH = path.join(REPO, "benchmarks", "app-builder");
const TEMPLATE = path.join(BENCH, "template", "nextjs");
const SPECS = path.join(BENCH, "specs", "relay-crm");
const RESULTS = path.join(BENCH, "results", "s-cell");
const SIM = "http://127.0.0.1:7788";
const PROXY = "http://127.0.0.1:7789";

// e.g. APPBENCH_MODEL=openai/gpt-5.6-luna or anthropic/claude-sonnet-5
const MODEL_SPEC = process.env.APPBENCH_MODEL ?? "openai/gpt-5.6-luna";
const [MODEL_PROVIDER, ...rest] = MODEL_SPEC.split("/");
const MODEL_NAME = rest.join("/");
const CELL_ID = `${MODEL_NAME.replace(/[^a-z0-9.-]/gi, "_")}-relay-crm`;
// Distinguishes snapshot DBs across reruns of the same cell.
const RUN_STAMP = Date.now().toString(36);

// Soft caps only (flagged as overSoftCap, never aborted). Raised from
// 15/20/25 after the first S-CELL run showed wall-clock is dominated by
// transport stalls, not model speed — re-calibrate once clean cells exist.
const MILESTONE_TIMEOUTS_MIN = [30, 30, 30];
// S-FORMS reuses this runner with APPBENCH_MILESTONES=1 (M1 only).
const MILESTONES = Number(process.env.APPBENCH_MILESTONES ?? "3");

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${url} -> ${res.status}: ${await res.text()}`,
    );
  }
  return res.json();
}

(RUN ? describe : describe.skip)("appbench S-CELL", () => {
  let harness: ChatFlowHarness;
  let projectId: string;
  let devBranchId: string;

  beforeAll(async () => {
    expect(process.env.DYAD_PRO_API_KEY, "DYAD_PRO_KEY required").toBeTruthy();
    // Preflight: neon-sim + engine proxy must be up.
    await json(`${SIM}/__sim/state`);
    await fetch(`${PROXY}/healthz`).then((r) => {
      if (!r.ok) throw new Error("engine proxy not running");
    });
    expect(fs.existsSync(TEMPLATE), "template snapshot missing").toBe(true);

    harness = await setupChatFlowHarness({
      electronMock: h,
      fixtureAppPath: TEMPLATE,
      chatMode: "local-agent",
      autoApprove: true,
      useFakeCatalog: false,
      engine: false, // leave our DYAD_ENGINE_URL (recording proxy) untouched
      selectedModel: { provider: MODEL_PROVIDER, name: MODEL_NAME },
      settings: {
        enableDyadPro: true,
        // Deep context stays ON (user decision): the electron mock's
        // utilityProcess shim forks the real worker bundle headless. Requires
        // dist/code_explorer_worker.js — run-cell.sh builds it if missing.
        enableCodeExplorer: true,
        // Headless: consent prompts have no user to click and hang to their
        // 300s deadline before failing as denied (observed in run 3 — this
        // both stalled milestones and denied the model schema changes).
        // "always" for everything mirrors a real user clicking "always
        // allow". Web tools included (product realism over reproducibility —
        // benchmark decision 2026-07-28); the same policy must apply to the
        // phase-2 CLI harnesses for cross-harness fairness.
        agentToolConsents: {
          execute_sql: "always",
          add_dependency: "always",
          restart_app: "always",
          rebuild_app: "always",
          web_search: "always",
          web_crawl: "always",
        },
        providerSettings: {
          auto: { apiKey: { value: process.env.DYAD_PRO_API_KEY! } },
        },
        neon: {
          accessToken: { value: "sim-token" },
          refreshToken: { value: "sim-refresh" },
          expiresIn: 315_360_000, // 10 years: refresh path must never trigger
          tokenTimestamp: Math.floor(Date.now() / 1000),
        },
      } as any,
    });

    // ---- Connect the app to neon-sim the way the product would ----
    const { getNeonClient } =
      await import("@/neon_admin/neon_management_client");
    const client = await getNeonClient();
    const created = await client.createProject({
      project: { name: `appbench-${CELL_ID}` },
    } as any);
    projectId = created.data.project.id;
    // Mirror the product's create flow (neon_handlers): explicit development
    // branch as a child of main, then Neon Auth on it.
    const branches = await client.listProjectBranches({ projectId } as any);
    const mainBranch = branches.data.branches.find(
      (b: any) => b.name === "main" || b.default,
    );
    if (!mainBranch) throw new Error("main branch missing from sim project");
    const devResp = await client.createProjectBranch(projectId, {
      endpoints: [{ type: "read_write" }],
      branch: { name: "development", parent_id: mainBranch.id },
    } as any);
    devBranchId = devResp.data.branch.id;
    const { getConnectionUri } = await import("@/neon_admin/neon_context");
    const databaseUrl = await getConnectionUri({
      projectId,
      branchId: devBranchId,
    });
    const { ensureNeonAuth } = await import("@/ipc/utils/neon_utils");
    const authBaseUrl = await ensureNeonAuth({
      projectId,
      branchId: devBranchId,
    });
    expect(authBaseUrl, "neon auth base_url from sim").toBeTruthy();
    const cookieSecret = crypto.randomBytes(32).toString("hex");

    // App row fields the neon prompt context keys off.
    const { db } = await import("@/db");
    const { apps } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(apps)
      .set({
        neonProjectId: projectId,
        neonDevelopmentBranchId: devBranchId,
        neonActiveBranchId: devBranchId,
        neonDevelopmentAuthCookieSecret: cookieSecret,
      })
      .where(eq(apps.id, harness.appId));

    // Env injection (same keys the product writes to .env.local).
    fs.writeFileSync(
      path.join(harness.appDir, ".env.local"),
      [
        `DATABASE_URL=${databaseUrl}`,
        `POSTGRES_URL=${databaseUrl}`,
        `NEON_AUTH_BASE_URL=${authBaseUrl}`,
        `NEON_AUTH_COOKIE_SECRET=${cookieSecret}`,
        "",
      ].join("\n"),
    );

    // Pre-install node_modules so run_type_checks and builds work.
    execSync("pnpm install --prefer-offline", {
      cwd: harness.appDir,
      stdio: "pipe",
      timeout: 600_000,
    });
    execSync(
      "git add -A && git -c user.email=bench@dyad.sh -c user.name=bench commit -m 'appbench: env + lockfile' --allow-empty",
      {
        cwd: harness.appDir,
        stdio: "pipe",
      },
    );
  }, 900_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it(
    "builds Relay CRM across 3 milestones",
    async () => {
      fs.mkdirSync(RESULTS, { recursive: true });
      const summary: any = {
        cellId: CELL_ID,
        model: MODEL_SPEC,
        template: fs
          .readFileSync(path.join(TEMPLATE, "TEMPLATE_VERSION"), "utf8")
          .trim(),
        milestones: [],
      };

      for (let m = 1; m <= MILESTONES; m++) {
        const prompt = fs.readFileSync(path.join(SPECS, `m${m}.md`), "utf8");
        const startedAt = Date.now();
        const spendBefore = (await json(`${PROXY}/__spend`)).spentUsd ?? 0;
        const result = await harness.streamChat(prompt);
        const durationMs = Date.now() - startedAt;
        const errors = result.events.filter(
          (e) => e.channel === "chat:response:error",
        );
        // Commit anything the turn left dirty, then tag the checkpoint.
        execSync(
          `git add -A && git -c user.email=bench@dyad.sh -c user.name=bench commit -m 'checkpoint m${m}' --allow-empty && git tag -f checkpoint-m${m}`,
          { cwd: harness.appDir, stdio: "pipe" },
        );
        const sha = execSync("git rev-parse HEAD", {
          cwd: harness.appDir,
        })
          .toString()
          .trim();
        const spendAfter = (await json(`${PROXY}/__spend`)).spentUsd ?? 0;
        const assistant = result.messages.filter((x) => x.role === "assistant");
        summary.milestones.push({
          m,
          durationMs,
          overSoftCap: durationMs > MILESTONE_TIMEOUTS_MIN[m - 1] * 60_000,
          errorEvents: errors.length,
          estimatedUsd: +(spendAfter - spendBefore).toFixed(4),
          sha,
          assistantMessages: assistant.length,
          maxTokensUsed: Math.max(
            0,
            ...assistant.map((x) => x.maxTokensUsed ?? 0),
          ),
        });
        fs.writeFileSync(
          path.join(RESULTS, `${CELL_ID}.summary.json`),
          JSON.stringify(summary, null, 2),
        );
        // Full transcript (tool calls + results included) — the judge input
        // and the primary artifact for diagnosing slow/stalled steps.
        fs.writeFileSync(
          path.join(RESULTS, `${CELL_ID}.m${m}.messages.json`),
          JSON.stringify(result.messages, null, 2),
        );
        // Snapshot after the summary is durably written; label must match the
        // shim's ^sim_[a-z0-9_]+$ contract and be unique across reruns.
        const snapshotDb = `sim_${RUN_STAMP}_${CELL_ID.toLowerCase().replace(/[^a-z0-9_]/g, "_")}_ckpt${m}`;
        summary.milestones[summary.milestones.length - 1].snapshotDb =
          snapshotDb;
        await json(`${SIM}/__sim/snapshot`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            branchId: devBranchId,
            label: snapshotDb,
          }),
        });
        fs.writeFileSync(
          path.join(RESULTS, `${CELL_ID}.summary.json`),
          JSON.stringify(summary, null, 2),
        );
        // A milestone that errored means the cell is broken — stop, but keep
        // the summary written above for diagnosis.
        expect(errors, `milestone ${m} stream errors`).toEqual([]);
      }

      // Archive the checkout (tags included) before dispose deletes the temp
      // dir — the scoring phase checks these out per checkpoint.
      const checkoutDest = path.join(RESULTS, "checkouts", CELL_ID);
      fs.rmSync(checkoutDest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(checkoutDest), { recursive: true });
      execSync(`git clone --quiet "${harness.appDir}" "${checkoutDest}"`, {
        stdio: "pipe",
      });
    },
    6 * 60 * 60_000,
  );
});
