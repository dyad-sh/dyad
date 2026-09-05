import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import { getUserDataPath } from "@/paths/paths";
import { readSettings } from "@/main/settings";
import { getDyadEngineBaseUrl } from "@/ipc/utils/dyad_engine_url";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getBuiltinLanguageModelCatalog } from "@/ipc/shared/remote_language_model_catalog";
import { MODEL_OPTIONS } from "@/ipc/shared/language_model_constants";
import type { SubscriptionTokens } from "@/lib/subscriptionUsage";

const Count = z.number().int().nonnegative();
const ReportSchema = z.object({
  id: z.string(),
  billingOwner: z.string(),
  model: z.string(),
  createdAt: z.string(),
  status: z.enum(["started", "ready", "unknown"]),
  knownModel: z.boolean().optional(),
  catalogVersion: z.string().optional(),
  tokens: z
    .object({
      input: Count,
      cacheRead: Count,
      cacheWrite: Count,
      output: Count,
    })
    .optional(),
});
const LedgerSchema = z.object({
  reports: z.array(ReportSchema),
  chargedUsd: z.number().nonnegative(),
});
function ledgerPath() {
  return path.join(getUserDataPath(), "codex-subscription-usage.json");
}
function readLedger(): z.infer<typeof LedgerSchema> {
  if (!fs.existsSync(ledgerPath())) return { reports: [], chargedUsd: 0 };
  return LedgerSchema.parse(JSON.parse(fs.readFileSync(ledgerPath(), "utf8")));
}
function writeLedger(ledger: z.infer<typeof LedgerSchema>) {
  const target = ledgerPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(ledger), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
}
function billingKey() {
  const key = readSettings().providerSettings?.auto?.apiKey?.value;
  if (!key)
    throw new DyadError(
      "Add your Dyad Pro key before using Subscription. Dyad usage is billed separately from your ChatGPT plan.",
      DyadErrorKind.Auth,
    );
  return key;
}
function owner(key: string) {
  return createHash("sha256").update(key).digest("hex");
}
export function normalizeSubscriptionUsage(
  usage: LanguageModelV3Usage,
): SubscriptionTokens {
  const inputTotal = usage.inputTokens.total;
  const output = usage.outputTokens.total;
  if (inputTotal === undefined || output === undefined)
    throw new Error("Subscription usage was not reported");
  const cacheRead = usage.inputTokens.cacheRead ?? 0;
  const cacheWrite = usage.inputTokens.cacheWrite ?? 0;
  const input = inputTotal - cacheRead - cacheWrite;
  return ReportSchema.shape.tokens
    .unwrap()
    .parse({ input, cacheRead, cacheWrite, output });
}
const active = new Set<string>();
let flushing: Promise<void> | undefined;
export function getSubscriptionUsageStatus() {
  const ledger = readLedger();
  return {
    pendingReports: ledger.reports.length,
    chargedUsd: ledger.chargedUsd,
    missingUsage: ledger.reports.some(
      (r) =>
        r.status === "unknown" || (r.status === "started" && !active.has(r.id)),
    ),
  };
}
export async function flushSubscriptionUsage() {
  if (flushing) return flushing;
  flushing = (async () => {
    const key = billingKey();
    for (const report of readLedger().reports) {
      if (active.has(report.id)) continue;
      if (report.status !== "ready" || !report.tokens)
        throw new DyadError(
          "A previous subscription request ended without token usage. Usage reconciliation is required before continuing.",
          DyadErrorKind.Precondition,
        );
      if (report.billingOwner !== owner(key))
        throw new DyadError(
          "Reconnect the original Dyad billing account to settle pending subscription usage.",
          DyadErrorKind.Auth,
        );
      let response: Response;
      try {
        response = await fetch(
          `${getDyadEngineBaseUrl().replace(/\/$/, "")}/track-usage`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
              "Idempotency-Key": report.id,
            },
            body: JSON.stringify({
              version: 1,
              id: report.id,
              provider: "openai",
              connection: "subscription",
              model: report.model,
              createdAt: report.createdAt,
              tokens: report.tokens,
              catalog: {
                knownModel: report.knownModel,
                version: report.catalogVersion,
              },
              pricingPolicy: "subscription-v1",
            }),
          },
        );
      } catch {
        throw new DyadError(
          "Subscription usage reporting is unavailable. Your usage is saved; retry before continuing.",
          DyadErrorKind.External,
        );
      }
      if (!response.ok)
        throw new DyadError(
          `Subscription usage could not be settled (HTTP ${response.status}). Check your Dyad balance or retry later.`,
          response.status === 402
            ? DyadErrorKind.Precondition
            : DyadErrorKind.External,
        );
      const result = z
        .object({ id: z.string(), chargedUsd: z.number().nonnegative() })
        .parse(await response.json());
      if (result.id !== report.id)
        throw new Error("Usage receipt did not match request");
      const ledger = readLedger();
      if (ledger.reports.some((r) => r.id === report.id)) {
        writeLedger({
          reports: ledger.reports.filter((r) => r.id !== report.id),
          chargedUsd: ledger.chargedUsd + result.chargedUsd,
        });
      }
    }
  })().finally(() => {
    flushing = undefined;
  });
  return flushing;
}
export async function startSubscriptionUsage(model: string) {
  await flushSubscriptionUsage();
  const ledger = readLedger();
  const id = randomUUID();
  ledger.reports.push({
    id,
    billingOwner: owner(billingKey()),
    model,
    createdAt: new Date().toISOString(),
    status: "started",
  });
  writeLedger(ledger);
  active.add(id);
  return id;
}
export async function finishSubscriptionUsage(
  id: string,
  model: string,
  usage: LanguageModelV3Usage,
) {
  try {
    const tokens = normalizeSubscriptionUsage(usage);
    const catalog = await getBuiltinLanguageModelCatalog();
    const knownModel = Boolean(
      catalog.modelsByProvider.openai?.some((m) => m.apiName === model) ||
      MODEL_OPTIONS.openai?.some((m) => m.name === model),
    );
    const ledger = readLedger();
    const report = ledger.reports.find((r) => r.id === id);
    if (report)
      Object.assign(report, {
        model,
        tokens,
        knownModel,
        catalogVersion: catalog.version,
        status: "ready",
      });
    writeLedger(ledger);
  } finally {
    active.delete(id);
  }
  // Generation has completed; retain unsettled reports for explicit retry in UI.
  void flushSubscriptionUsage().catch(() => {});
}
export function interruptSubscriptionUsage(id: string, notSent = false) {
  active.delete(id);
  const ledger = readLedger();
  if (notSent) ledger.reports = ledger.reports.filter((r) => r.id !== id);
  else {
    const report = ledger.reports.find((r) => r.id === id);
    if (report?.status === "started") report.status = "unknown";
  }
  writeLedger(ledger);
}
