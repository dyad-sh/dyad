import { randomUUID } from "node:crypto";
import { app } from "electron";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getUserDataPath } from "@/paths/paths";
import { engineFetch } from "@/pro/main/ipc/handlers/local_agent/tools/engine_fetch";
import type { UsageEvent } from "./usage";

export const ReceiptSchema = z.object({
  eventId: z.string(),
  status: z.enum(["settled", "test-settled", "reconciliation"]),
  chargeUsd: z.string().regex(/^\d+(?:\.\d+)?$/),
  pricingSnapshotId: z.string(),
});
export const ReservationSchema = z.object({
  reservationId: z.string(),
  pricingSnapshotId: z.string(),
  testMode: z.boolean(),
});
type OutboxRecord = {
  event: UsageEvent;
  collecting?: boolean;
  receipt?: z.infer<typeof ReceiptSchema>;
};

async function request(endpoint: string, body: unknown) {
  const local =
    (!app.isPackaged || process.env.E2E_TEST_BUILD === "true") &&
    process.env.DYAD_CLAUDE_BILLING_URL;
  if (local) {
    const url = new URL(local);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password
    )
      throw new Error("Test accounting must use HTTP on 127.0.0.1");
    const response = await fetch(new URL(endpoint, url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Test accounting unavailable (${response.status})`);
    return response.json();
  }
  const response = await engineFetch(
    {
      dyadRequestId: "claude-code-accounting",
      abortSignal: new AbortController().signal,
    },
    endpoint,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      timeoutMs: 15_000,
    },
  );
  if (!response.ok)
    throw new Error(
      `Subscription accounting unavailable (${response.status}). No turn started or alternate payment source selected.`,
    );
  return response.json();
}

export async function authorizeClaudeTurn(chatId: number, turnId: string) {
  await retryClaudeUsage();
  const pending = await pendingRecords();
  if (
    pending.some(
      (record) => !record.receipt || record.receipt.status === "reconciliation",
    )
  )
    throw new Error(
      "Subscription usage is awaiting accounting reconciliation. Retry accounting before starting another turn.",
    );
  return {
    ...ReservationSchema.parse(
      await request("/authorize-usage", {
        backend: "claude-code",
        chatId,
        turnId,
      }),
    ),
    turnId,
  };
}

function directory() {
  return path.join(getUserDataPath(), "claude-code-usage");
}
async function save(record: OutboxRecord) {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  // Event IDs are main-generated UUIDs, never user paths.
  const target = path.join(
    directory(),
    `${z.string().uuid().parse(record.event.eventId)}.json`,
  );
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
  await rename(temporary, target);
}
async function pendingRecords(): Promise<OutboxRecord[]> {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const records: OutboxRecord[] = [];
  for (const file of await readdir(directory())) {
    if (!file.endsWith(".json")) continue;
    records.push(
      JSON.parse(
        await readFile(path.join(directory(), file), "utf8"),
      ) as OutboxRecord,
    );
  }
  return records;
}
async function deliver(record: OutboxRecord) {
  const receipt = ReceiptSchema.parse(
    await request("/track-usage", record.event),
  );
  if (
    receipt.eventId !== record.event.eventId ||
    receipt.pricingSnapshotId !== record.event.pricingSnapshotId
  )
    throw new Error("Usage receipt identity mismatch");
  await save({ ...record, receipt });
  return receipt;
}
export async function beginClaudeUsage(event: UsageEvent) {
  await save({ event, collecting: true });
}

export async function recoverClaudeUsage() {
  for (const record of await pendingRecords()) {
    if (record.collecting)
      await save({
        event: { ...record.event, outcome: "failed", coverage: "incomplete" },
      });
  }
  await retryClaudeUsage();
}

export async function reportClaudeUsage(event: UsageEvent) {
  const record = { event };
  await save(record);
  return deliver(record);
}
let retry: Promise<void> | undefined;
export function retryClaudeUsage(): Promise<void> {
  retry ??= (async () => {
    for (const record of await pendingRecords())
      if (!record.receipt && !record.collecting) await deliver(record);
  })().finally(() => {
    retry = undefined;
  });
  return retry;
}
