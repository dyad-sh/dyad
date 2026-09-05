// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { UsageEvent } from "./usage";

const state = vi.hoisted(() => ({ directory: "", fetch: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: true } }));
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => state.directory }));
vi.mock("@/pro/main/ipc/handlers/local_agent/tools/engine_fetch", () => ({
  engineFetch: state.fetch,
}));
import {
  authorizeClaudeTurn,
  beginClaudeUsage,
  recoverClaudeUsage,
  reportClaudeUsage,
  retryClaudeUsage,
} from "./accounting";

const event = (): UsageEvent => ({
  schemaVersion: 1,
  eventId: randomUUID(),
  backend: "claude-code",
  appId: 1,
  chatId: 2,
  turnId: randomUUID(),
  sessionId: randomUUID(),
  reservationId: "reservation",
  pricingSnapshotId: "catalog-v1",
  outcome: "completed",
  coverage: "complete",
  models: [],
});
beforeEach(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "claude-accounting-"));
  state.fetch.mockReset();
  state.fetch.mockImplementation(async (_context, _route, options) => {
    const payload = JSON.parse(options.body);
    return Response.json({
      eventId: payload.eventId,
      status: payload.coverage === "complete" ? "settled" : "reconciliation",
      chargeUsd: "0.001",
      pricingSnapshotId: payload.pricingSnapshotId,
    });
  });
});
afterEach(async () => {
  await rm(state.directory, { recursive: true, force: true });
});

it("persists failed deliveries and retries the identical event without reporting settled records twice", async () => {
  const usage = event();
  state.fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(reportClaudeUsage(usage)).rejects.toThrow("offline");
  const directory = path.join(state.directory, "claude-code-usage");
  expect(await readdir(directory)).toEqual([`${usage.eventId}.json`]);
  await retryClaudeUsage();
  await retryClaudeUsage();
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(
    state.fetch.mock.calls.map((call) => JSON.parse(call[2].body)),
  ).toEqual([usage, usage]);
  expect(
    JSON.parse(
      await readFile(path.join(directory, `${usage.eventId}.json`), "utf8"),
    ).receipt.status,
  ).toBe("settled");
});

it("does not send a running turn, but recovers a crashed turn as incomplete and blocks new admission", async () => {
  const usage = event();
  await beginClaudeUsage(usage);
  await retryClaudeUsage();
  expect(state.fetch).not.toHaveBeenCalled();
  await recoverClaudeUsage();
  expect(JSON.parse(state.fetch.mock.calls[0][2].body)).toMatchObject({
    eventId: usage.eventId,
    coverage: "incomplete",
    outcome: "failed",
  });
  await expect(authorizeClaudeTurn(2, randomUUID())).rejects.toThrow(
    "reconciliation",
  );
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
