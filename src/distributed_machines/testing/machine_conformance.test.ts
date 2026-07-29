import { describe, expect, it } from "vitest";
import { z } from "zod";
import { appRunConformance } from "@/app_run/conformance.test_support";
import { appRunRemoteIntentContract } from "@/app_run/remote_intent_contract";
import { unsafeEscapeHatchInventory } from "../boundary_inventory.test_support";
import { imageGenerationConformance } from "@/image_generation/conformance.test_support";
import { imageGenerationRemoteIntentContract } from "@/image_generation/remote_intent_contract";
import { declareRemoteIntentContractForProtocolV1 } from "../remote_intent_contract";
import {
  REMOTE_MACHINE_PROTOCOL_VERSION,
  type MachineDispatchEnvelope,
  type MachineSnapshotEnvelope,
} from "../remote_protocol";
import {
  REQUIRED_HISTORICAL_FAILURE_SHAPES,
  assertEnvelopeBudget,
  createConformanceDiagnostic,
  defineMachineConformance,
  formatConformanceDiagnostic,
  formatContractReport,
  type MachineConformance,
} from "./machine_conformance";
import { PILOT_CONFORMANCE_REGISTRATIONS } from "./pilot_conformance";

const maximumIdentity = "i".repeat(256);

function dispatchEnvelope(
  machineId: string,
  encodedKey: unknown,
  encodedEvent: unknown,
): MachineDispatchEnvelope {
  return {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    machineId,
    encodedKey,
    expectedActorInstanceId: maximumIdentity,
    messageId: maximumIdentity,
    causationId: maximumIdentity,
    correlationId: maximumIdentity,
    expectedRevision: Number.MAX_SAFE_INTEGER,
    encodedEvent,
  };
}

function snapshotEnvelope(
  machineId: string,
  encodedKey: unknown,
  encodedState: unknown,
): MachineSnapshotEnvelope {
  return {
    protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
    machineId,
    encodedKey,
    actorInstanceId: maximumIdentity,
    revision: Number.MAX_SAFE_INTEGER,
    encodedState,
  };
}

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
        toTrustedEvent: ({ intent }) => ({ ...intent }),
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

  it("rejects conformance references outside the declared inventory", () => {
    const invalidIntent = {
      machineId: "invalid",
      stateVariants: ["idle"],
      eventVariants: ["START"],
      tiers: ["T0"],
      exclusions: [],
      invariants: [],
      representativeCapabilities: {},
      representativeIntents: {
        typo: { event: "TYPO", create: () => ({}) },
      },
      historicalFailureShapes: [],
    } as MachineConformance;
    expect(() => defineMachineConformance(invalidIntent)).toThrow(
      "representative intent typo references unknown event TYPO",
    );
  });

  it("rejects capabilities without a representative intent factory", () => {
    expect(() =>
      defineMachineConformance({
        machineId: "invalid",
        stateVariants: ["idle"],
        eventVariants: ["START"],
        tiers: ["T0"],
        exclusions: [
          { tier: "T1", reason: "not applicable" },
          { tier: "T2", reason: "not applicable" },
          { tier: "T3", reason: "not applicable" },
          { tier: "T4", reason: "not applicable" },
        ],
        invariants: [],
        representativeCapabilities: { canStart: ["start"] },
        representativeIntents: {},
        historicalFailureShapes: [],
      }),
    ).toThrow(
      "capability canStart references unknown representative intent start",
    );
  });

  it("rejects representative payloads shared across capabilities", () => {
    expect(() =>
      defineMachineConformance({
        machineId: "invalid",
        stateVariants: ["idle"],
        eventVariants: ["RESTART"],
        tiers: ["T0"],
        exclusions: [
          { tier: "T1", reason: "not applicable" },
          { tier: "T2", reason: "not applicable" },
          { tier: "T3", reason: "not applicable" },
          { tier: "T4", reason: "not applicable" },
        ],
        invariants: [],
        representativeCapabilities: {
          canRestart: ["restart"],
          canRebuild: ["restart"],
        },
        representativeIntents: {
          restart: { event: "RESTART", create: () => ({}) },
        },
        historicalFailureShapes: [],
      }),
    ).toThrow(
      "representative intent restart is shared by capabilities canRestart and canRebuild",
    );
  });

  it("rejects blank, duplicate, and overlapping exclusions", () => {
    const registration = {
      machineId: "invalid",
      stateVariants: ["idle"],
      eventVariants: ["START"],
      tiers: ["T0"],
      invariants: [],
      representativeCapabilities: {},
      representativeIntents: {},
      historicalFailureShapes: [],
    } as const;
    expect(() =>
      defineMachineConformance({
        ...registration,
        exclusions: [{ tier: "T1", reason: " " }],
      }),
    ).toThrow("exclusion T1 requires a reason");
    expect(() =>
      defineMachineConformance({
        ...registration,
        exclusions: [
          { tier: "T1", reason: "first" },
          { tier: "T1", reason: "second" },
        ],
      }),
    ).toThrow("excluded tiers contains duplicates");
    expect(() =>
      defineMachineConformance({
        ...registration,
        exclusions: [{ tier: "T0", reason: "not applicable" }],
      }),
    ).toThrow("tier T0 cannot be both applicable and excluded");
  });

  it("requires every conformance tier to be applicable or excluded", () => {
    expect(() =>
      defineMachineConformance({
        machineId: "invalid",
        stateVariants: ["idle"],
        eventVariants: ["START"],
        tiers: ["T0"],
        exclusions: [],
        invariants: [],
        representativeCapabilities: {},
        representativeIntents: {},
        historicalFailureShapes: [],
      }),
    ).toThrow("conformance tiers are unclassified: T1,T2,T3,T4");
  });

  it("derives trusted image provenance without mutating renderer intent", () => {
    const intent =
      imageGenerationRemoteIntentContract.rendererIntentCodec.parse({
        type: "SUBMIT",
        requestId: "request",
        operationId: "operation",
        job: {
          id: "job",
          prompt: "prompt",
          themeMode: "plain",
          targetAppId: 1,
          targetAppName: "App",
          startedAt: 1,
        },
      });
    const trusted = imageGenerationRemoteIntentContract.toTrustedEvent({
      key: imageGenerationRemoteIntentContract.keyCodec.parse({
        scope: "jobs",
      }),
      intent,
      sender: { windowSessionId: "main-owned-session" },
    });
    expect(trusted).not.toBe(intent);
    expect(intent).not.toHaveProperty("initiatorWindowSessionId");
    expect(trusted).toMatchObject({
      type: "SUBMIT",
      initiatorWindowSessionId: "main-owned-session",
    });
    expect(Object.isFrozen(trusted)).toBe(true);
  });

  it("aligns relationship refusals with preserved protocol-v1 behavior", () => {
    expect(
      appRunRemoteIntentContract.keyIntentRelationship.kind === "validate" &&
        appRunRemoteIntentContract.keyIntentRelationship.validate(
          { appId: 1 },
          {
            type: "STOP_REQUESTED",
            operationId: "stop",
            startedAt: 1,
            activeInvocationRef: {
              kind: "app-run",
              entityKey: 2,
              operationId: "run",
            },
          },
        ),
    ).toBe(false);
    expect(appRunRemoteIntentContract.refusalMap.keyIntentMismatch).toBe(
      "unauthorized",
    );
    expect(
      imageGenerationRemoteIntentContract.keyIntentRelationship.kind ===
        "validate" &&
        imageGenerationRemoteIntentContract.keyIntentRelationship.validate(
          { scope: "jobs" },
          {
            type: "CANCEL_REQUESTED",
            jobId: "job",
            activeInvocationRef: {
              kind: "image-generation",
              entityKey: "other-job",
              operationId: "operation",
            },
          },
        ),
    ).toBe(false);
    expect(
      imageGenerationRemoteIntentContract.refusalMap.keyIntentMismatch,
    ).toBe("unauthorized");
  });

  it("registers both pilots and all required historical scenario names", () => {
    expect(
      PILOT_CONFORMANCE_REGISTRATIONS.map(
        ({ conformance }) => conformance.machineId,
      ),
    ).toEqual(["app_run", "image_generation"]);
    expect(appRunConformance.tiers).toEqual(["T0", "T1", "T2"]);
    expect(imageGenerationConformance.tiers).toEqual(["T0", "T1", "T2"]);
    expect(appRunConformance.representativeCapabilities.canRebuild).toEqual([
      "rebuild",
    ]);
    expect(appRunConformance.representativeIntents.restart.event).toBe(
      "RESTART",
    );
    expect(appRunConformance.representativeIntents.rebuild.event).toBe(
      "RESTART",
    );
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
      toEnvelope: (event) =>
        dispatchEnvelope(
          "app_run",
          appRunRemoteIntentContract.encodeKey({ appId: 1 }),
          event,
        ),
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
      toEnvelope: (state) =>
        snapshotEnvelope(
          "app_run",
          appRunRemoteIntentContract.encodeKey({ appId: 1 }),
          state,
        ),
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
        requestId: "r".repeat(256),
        operationId: "o".repeat(256),
        job,
      }),
      toEnvelope: (event) =>
        dispatchEnvelope(
          "image_generation",
          imageGenerationRemoteIntentContract.encodeKey({ scope: "jobs" }),
          event,
        ),
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
          requestId: `request-${index}`,
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
      toEnvelope: (state) =>
        snapshotEnvelope(
          "image_generation",
          imageGenerationRemoteIntentContract.encodeKey({ scope: "jobs" }),
          state,
        ),
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
        toEnvelope: (value) => ({ encodedState: value }),
      }),
    ).toThrow(/declared=1B measured=\d+B headroom=-\d+B/);
  });

  it("includes transport metadata in the measured envelope", () => {
    const codec = z.object({ value: z.string() });
    const worstCase = () => ({ value: "payload" });
    const payloadSize = assertEnvelopeBudget({
      label: "payload-only control",
      codec,
      declaredLimit: Number.MAX_SAFE_INTEGER,
      worstCase,
      toEnvelope: (value) => value,
    }).measuredSize;
    expect(() =>
      assertEnvelopeBudget({
        label: "full envelope",
        codec,
        declaredLimit: payloadSize + 1,
        worstCase,
        toEnvelope: (value) =>
          dispatchEnvelope("machine", { key: "entity" }, value),
      }),
    ).toThrow(/full envelope envelope budget exceeded/);
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
      "START: completion=tracked-completion revision=actor(required=true) retry=stable-id(identity=request,dedup=required,lifetime=window-session) acceptance=admission input=preserve-until-accepted",
    );
    expect(report).toContain("tiers: T0,T1,T2");
    expect(report).toContain("wideningCasts:\n  app_run/definition.ts#1");
    expect(report.split("\n").length).toBeLessThan(100);
  });

  it("reports named domain revisions without collapsing policy details", () => {
    const report = formatContractReport(
      [
        {
          contract: {
            intents: {
              UPDATE: {
                completion: "tracked-completion",
                observedRevision: {
                  kind: "domain",
                  name: "document-version",
                  required: true,
                },
                retry: {
                  kind: "stable-id",
                  identity: "domain",
                  receiverDeduplication: "required",
                  lifetime: "host-session",
                },
                acceptance: "completion",
                inputDisposition: "preserve-until-completed",
              },
            },
            budgets: { intentBytes: 1, snapshotBytes: 2 },
          },
          conformance: appRunConformance,
        },
      ],
      {},
    );
    expect(report).toContain(
      "revision=domain(name=document-version,required=true) retry=stable-id(identity=domain,dedup=required,lifetime=host-session)",
    );
  });
});
