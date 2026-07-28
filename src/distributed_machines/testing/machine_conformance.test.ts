import { describe, expect, it } from "vitest";
import { z } from "zod";
import { appRunConformance } from "@/app_run/conformance.test_support";
import { appRunRemoteIntentContract } from "@/app_run/remote_intent_contract";
import { unsafeEscapeHatchInventory } from "../boundary_inventory.test_support";
import { imageGenerationConformance } from "@/image_generation/conformance.test_support";
import { imageGenerationRemoteIntentContract } from "@/image_generation/remote_intent_contract";
import { declareRemoteIntentContractForProtocolV1 } from "../remote_intent_contract";
import {
  REQUIRED_HISTORICAL_FAILURE_SHAPES,
  assertEnvelopeBudget,
  createConformanceDiagnostic,
  defineMachineConformance,
  formatConformanceDiagnostic,
  formatContractReport,
} from "./machine_conformance";
import { PILOT_CONFORMANCE_REGISTRATIONS } from "./pilot_conformance";

describe("remote intent contract registration", () => {
  it("keeps renderer intents distinct from trusted producer events", () => {
    expect(
      appRunRemoteIntentContract.rendererIntentCodec.safeParse({
        type: "PROCESS_SPAWNED",
        operationId: "request",
        invocationRef: {
          kind: "app-run",
          entityKey: 1,
          operationId: "runtime",
        },
      }).success,
    ).toBe(false);
    expect(
      imageGenerationRemoteIntentContract.rendererIntentCodec.safeParse({
        type: "JOB_SUCCEEDED",
        jobId: "job",
      }).success,
    ).toBe(false);
    expect(Object.keys(appRunRemoteIntentContract.intents).sort()).toEqual([
      "MANUAL_RELOAD",
      "RESTART",
      "START",
      "STOP_REQUESTED",
    ]);
    expect(
      Object.keys(imageGenerationRemoteIntentContract.intents).sort(),
    ).toEqual(["CANCEL_REQUESTED", "SUBMIT"]);
  });

  it("adapts declarations beside protocol v1 without replacing its codecs", () => {
    const keyCodec = z.string();
    const snapshotCodec = z.object({ value: z.number() });
    const contract = declareRemoteIntentContractForProtocolV1(
      {
        protocolVersion: 1,
        keyCodec,
        encodeKey: (key) => key,
        snapshotCodec,
      },
      {
        rendererIntentCodec: z.object({ type: z.literal("PING") }),
        toTrustedEvent: (intent) => intent,
        authorization: { subscribe: "public", dispatch: "public" },
        keyIntentRelationship: { kind: "entity-relative" },
        intents: {
          PING: {
            completion: "admission-only",
            observedRevision: { kind: "none" },
            retry: { kind: "none" },
            acceptance: "admission",
            inputDisposition: "preserve",
          },
        },
        refusalMap: appRunRemoteIntentContract.refusalMap,
        budgets: { intentBytes: 1024, snapshotBytes: 1024 },
      },
    );
    expect(contract.keyCodec).toBe(keyCodec);
    expect(contract.snapshotCodec).toBe(snapshotCodec);
  });

  it("rejects an incomplete or duplicate conformance registration", () => {
    expect(() =>
      defineMachineConformance({
        machineId: "invalid",
        stateVariants: ["idle", "idle"],
        eventVariants: ["START"],
        tiers: ["T0"],
        exclusions: [],
        invariants: [],
        representativeCapabilities: {},
        representativeIntents: {},
        historicalFailureShapes: [],
      }),
    ).toThrow("invalid states contains duplicates");
  });

  it("registers both pilots and all required historical scenario names", () => {
    expect(
      PILOT_CONFORMANCE_REGISTRATIONS.map(
        ({ conformance }) => conformance.machineId,
      ),
    ).toEqual(["app_run", "image_generation"]);
    expect(appRunConformance.tiers).toEqual(["T0", "T1", "T2"]);
    expect(imageGenerationConformance.tiers).toEqual(["T0", "T1", "T2"]);
    const names = new Set([
      ...appRunConformance.historicalFailureShapes,
      ...imageGenerationConformance.historicalFailureShapes,
    ]);
    expect(
      REQUIRED_HISTORICAL_FAILURE_SHAPES.filter((name) => !names.has(name)),
    ).toEqual([]);
  });
});

describe("conformance diagnostics", () => {
  it("renders a focused deterministic failure record", () => {
    expect(
      formatConformanceDiagnostic({
        ...createConformanceDiagnostic({
          summary:
            "unsubscribe won the race but bootstrap installed stale ownership",
          schedules: [
            ["subscribe", "noise", "authorize:pause", "unsubscribe", "resume"],
            ["subscribe", "authorize:pause", "unsubscribe", "resume"],
          ],
          identities: {
            message: "msg-1",
            request: "req-1",
            invocation: "inv-9",
            actor: "actor-2",
            revision: 7,
            window: "window-a",
          },
          resources: {
            expected: { subscriptions: 0, actors: 0 },
            actual: { subscriptions: 1, actors: 1 },
          },
          record: {
            scenario: "unsubscribe-during-bootstrap",
            prompt: "secret",
          },
          redact: ({ prompt: _prompt, ...safe }) => ({
            ...safe,
            payload: "[REDACTED]",
          }),
        }),
      }),
    ).toBe(
      [
        "unsubscribe won the race but bootstrap installed stale ownership",
        "schedule: subscribe -> authorize:pause -> unsubscribe -> resume",
        "identities: message=msg-1 request=req-1 invocation=inv-9 actor=actor-2 revision=7 window=window-a",
        "resources(actual/expected): waiters=0/0 tasks=0/0 timers=0/0 subscriptions=1/0 routes=0/0 actors=1/0",
        'record: {"scenario":"unsubscribe-during-bootstrap","payload":"[REDACTED]"}',
      ].join("\n"),
    );
  });
});

describe("pilot envelope budgets", () => {
  it("measures representative app-run intent and snapshot payloads", () => {
    const intent = assertEnvelopeBudget({
      label: "app_run intent",
      codec: appRunRemoteIntentContract.rendererIntentCodec,
      declaredLimit: appRunRemoteIntentContract.budgets.intentBytes,
      worstCase: () => ({
        type: "RESTART",
        operation: "restart",
        operationId: "r".repeat(256),
        startedAt: Number.MAX_SAFE_INTEGER,
        expectedRevision: Number.MAX_SAFE_INTEGER,
        options: { removeNodeModules: true, recreateSandbox: true },
      }),
    });
    const snapshot = assertEnvelopeBudget({
      label: "app_run snapshot",
      codec: appRunRemoteIntentContract.snapshotCodec,
      declaredLimit: appRunRemoteIntentContract.budgets.snapshotBytes,
      worstCase: () => ({
        appId: Number.MAX_SAFE_INTEGER,
        revision: Number.MAX_SAFE_INTEGER,
        previewReloadEpoch: Number.MAX_SAFE_INTEGER,
        phase: "errored",
        operation: "rebuild",
        startedAt: Number.MAX_SAFE_INTEGER,
        url: {
          appUrl: `https://example.test/${"a".repeat(4096)}`,
          originalUrl: `http://localhost/${"b".repeat(4096)}`,
          mode: "host",
        },
        operationError: { message: "e".repeat(4096) },
        exit: {
          exitCode: Number.MAX_SAFE_INTEGER,
          timestamp: Number.MAX_SAFE_INTEGER,
        },
        capabilities: {
          canStart: true,
          canRestart: true,
          canRebuild: true,
          canStop: true,
          canReload: true,
        },
        invocationRef: {
          kind: "app-run",
          entityKey: Number.MAX_SAFE_INTEGER,
          operationId: "i".repeat(256),
        },
        lastSettlement: {
          operationId: "s".repeat(256),
          kind: "run",
          outcome: "failed",
          error: { message: "f".repeat(4096) },
        },
      }),
    });
    expect(intent.measuredSize).toBeGreaterThan(0);
    expect(snapshot.headroom).toBeGreaterThan(0);
  });

  it("measures representative image-generation intent and snapshot payloads", () => {
    const job = {
      id: "j".repeat(256),
      prompt: "p".repeat(2000),
      themeMode: "real-photography" as const,
      targetAppId: Number.MAX_SAFE_INTEGER,
      targetAppName: "n".repeat(256),
      source: "media-library" as const,
      startedAt: Number.MAX_SAFE_INTEGER,
    };
    const intent = assertEnvelopeBudget({
      label: "image_generation intent",
      codec: imageGenerationRemoteIntentContract.rendererIntentCodec,
      declaredLimit: imageGenerationRemoteIntentContract.budgets.intentBytes,
      worstCase: () => ({
        type: "SUBMIT",
        operationId: "o".repeat(256),
        job,
      }),
    });
    const snapshot = assertEnvelopeBudget({
      label: "image_generation snapshot",
      codec: imageGenerationRemoteIntentContract.snapshotCodec,
      declaredLimit: imageGenerationRemoteIntentContract.budgets.snapshotBytes,
      worstCase: () => ({
        revision: Number.MAX_SAFE_INTEGER,
        jobs: Array.from({ length: 32 }, (_, index) => ({
          ...job,
          id: `${index}-${job.id}`,
          status: "success",
          result: {
            fileName: "f".repeat(256),
            appId: Number.MAX_SAFE_INTEGER,
            appName: "a".repeat(256),
          },
          error: "e".repeat(4096),
          lateAfterCancel: true,
          activeInvocationRef: null,
        })),
      }),
    });
    expect(intent.headroom).toBeGreaterThan(0);
    expect(snapshot.headroom).toBeGreaterThan(0);
  });

  it("reports the declared limit, measurement, and negative headroom", () => {
    expect(() =>
      assertEnvelopeBudget({
        label: "tiny",
        codec: z.object({ value: z.string() }),
        declaredLimit: 1,
        worstCase: () => ({ value: "too large" }),
      }),
    ).toThrow(/declared=1B measured=\d+B headroom=-\d+B/);
  });
});

describe("diff-first contract report", () => {
  it("is concise, sorted, and contains review-critical declarations", () => {
    const report = formatContractReport(
      [...PILOT_CONFORMANCE_REGISTRATIONS].reverse(),
      unsafeEscapeHatchInventory,
    );
    expect(report.indexOf("app_run")).toBeLessThan(
      report.indexOf("image_generation"),
    );
    expect(report).toContain(
      "START: completion=tracked-completion revision=actor retry=stable-id acceptance=admission input=preserve-until-accepted",
    );
    expect(report).toContain("tiers: T0,T1,T2");
    expect(report).toContain("wideningCasts:\n  app_run/definition.ts#1");
    expect(report.split("\n").length).toBeLessThan(100);
  });
});
