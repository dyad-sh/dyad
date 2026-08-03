import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createRecordingCommandRunner,
  createSequentialIdSource,
} from "../state_machines/testing";
import type { UserInputCommand } from "./commands";
import { createUserInputRegistry } from "./registry";

function setup() {
  const clock = createFakeClock(1_000);
  const recording = createRecordingCommandRunner<UserInputCommand, never>();
  const broadcast = vi.fn();
  const registry = createUserInputRegistry({
    clock,
    idSource: createSequentialIdSource(),
    broadcast,
    commandRunner: {
      run: (command) => recording.run(command, () => undefined),
    },
  });
  return {
    registry,
    clock,
    recording,
    broadcast,
  };
}

describe("user-input registry", () => {
  it("uses its injected clock as the only deadline source", async () => {
    const { registry, clock, broadcast } = setup();
    const requestId = registry.request({
      kind: "agent-consent",
      chatId: 1,
      toolName: "write_file",
      classifier: "none",
    });
    expect(requestId).toBe("agent-consent:1");
    expect(registry.getPending()[0].deadlineAt).toBe(301_000);
    expect(clock.pendingTimerCount()).toBe(1);
    const park = registry.park(requestId);
    clock.advanceBy(300_000);
    await expect(park).resolves.toBeNull();
    expect(registry.getPending()).toEqual([]);
    expect(broadcast).toHaveBeenCalledWith("user-input:settled", {
      requestId,
      outcome: "timed-out",
    });
  });

  it("gives an assertion review the long deadline, not the consent one", async () => {
    const { registry, clock } = setup();
    const requestId = registry.request({
      kind: "test-assertions",
      chatId: 1,
      appId: 4,
      proposalId: "proposal-1",
      testTitle: "add an item",
      classifier: "none",
    });

    // Reviewing a plan is an editing session; a five-minute consent deadline
    // would cut it off mid-edit.
    expect(registry.getPending()[0].deadlineAt).toBe(1_801_000);
    const park = registry.park(requestId);
    clock.advanceBy(300_000);
    expect(registry.getPending()).toHaveLength(1);

    clock.advanceBy(1_500_000);
    await expect(park).resolves.toBeNull();
  });

  it("resumes a parked assertion review with the generated spec", async () => {
    const { registry } = setup();
    const requestId = registry.request({
      kind: "test-assertions",
      chatId: 1,
      appId: 4,
      proposalId: "proposal-1",
      testTitle: "add an item",
      classifier: "none",
    });
    const park = registry.park(requestId);

    await registry.respond(requestId, {
      kind: "test-assertions",
      specPath: "e2e-tests/recorded-add-an-item.spec.ts",
      appliedCount: 2,
    });

    await expect(park).resolves.toEqual({
      kind: "test-assertions",
      specPath: "e2e-tests/recorded-add-an-item.spec.ts",
      appliedCount: 2,
    });
    expect(registry.getPending()).toEqual([]);
  });

  it("sweeps a consent and questionnaire in one chat", async () => {
    const { registry, recording } = setup();
    const consent = registry.request({
      kind: "agent-consent",
      chatId: 9,
      toolName: "read_file",
      classifier: "none",
    });
    const questionnaire = registry.request({
      kind: "questionnaire",
      chatId: 9,
      questions: [],
      classifier: "none",
    });
    const parks = [registry.park(consent), registry.park(questionnaire)];
    registry.sweepChat(9);
    await expect(Promise.all(parks)).resolves.toEqual([null, null]);
    expect(registry.getPending()).toEqual([]);
    expect(
      recording.commands.filter(
        (command) =>
          command.type === "broadcast-settled" && command.outcome === "swept",
      ),
    ).toHaveLength(2);
  });

  it("settles a due follow-up when its chat is deleted", async () => {
    const { registry, broadcast } = setup();
    const requestId = registry.request({
      kind: "integration",
      chatId: 9,
      provider: "supabase",
      classifier: "none",
      followUpPrompt: "Continue after integration",
    });
    const park = registry.park(requestId);
    await registry.respond(requestId, {
      kind: "integration",
      completed: true,
      provider: "supabase",
    });
    await park;
    registry.streamFinished(9);

    await registry.settleChat(9);

    expect(registry.getPending()).toEqual([]);
    expect(broadcast).toHaveBeenCalledWith("user-input:settled", {
      requestId,
      outcome: "swept",
    });
  });

  it("settles live follow-ups across all chats before a full reset", async () => {
    const { registry, broadcast } = setup();
    const requestIds = [4, 9].map((chatId) =>
      registry.request({
        kind: "integration",
        chatId,
        provider: "supabase",
        classifier: "none",
        followUpPrompt: `Continue chat ${chatId}`,
      }),
    );

    await registry.settleAll();

    expect(registry.getPending()).toEqual([]);
    for (const requestId of requestIds) {
      expect(broadcast).toHaveBeenCalledWith("user-input:settled", {
        requestId,
        outcome: "swept",
      });
    }
  });

  it("maps human and classifier resolutions into park values", async () => {
    const { registry } = setup();
    const agent = registry.request({
      kind: "agent-consent",
      chatId: 1,
      toolName: "write_file",
      classifier: "none",
    });
    const agentPark = registry.park(agent);
    await registry.respond(agent, {
      kind: "agent-consent",
      decision: "accept-once",
    });
    await expect(agentPark).resolves.toEqual({
      kind: "agent-consent",
      decision: "accept-once",
    });

    const mcp = registry.request({
      kind: "mcp-consent",
      chatId: 1,
      serverId: 1,
      serverName: "server",
      toolName: "read",
      classifier: "racing",
    });
    const mcpPark = registry.park(mcp);
    await registry.classifierDecided(mcp, true, "safe");
    await expect(mcpPark).resolves.toEqual({
      kind: "classifier-approved",
      reason: "safe",
    });
  });

  it("retains the classifier review reason in pending snapshots", async () => {
    const { registry } = setup();
    const requestId = registry.request({
      kind: "mcp-consent",
      chatId: 1,
      serverId: 1,
      serverName: "server",
      toolName: "read",
      classifier: "racing",
    });

    await registry.classifierDecided(requestId, false, "sensitive input");

    expect(registry.getPending()[0]).toMatchObject({
      classifier: "review",
      classifierReason: "sensitive input",
    });
  });

  it("supersedes a duplicate live request without orphaning its old park", async () => {
    const { registry } = setup();
    const input = {
      kind: "agent-consent" as const,
      chatId: 1,
      toolName: "write_file",
      classifier: "none" as const,
    };
    const requestId = registry.request(input, "duplicate");
    const oldPark = registry.park(requestId);
    registry.request(input, "duplicate");
    await expect(oldPark).resolves.toBeNull();
    const replacement = registry.park(requestId);
    await registry.respond(requestId, {
      kind: "agent-consent",
      decision: "decline",
    });
    await expect(replacement).resolves.toMatchObject({ decision: "decline" });
  });

  it("turns abort signals into swept settlements", async () => {
    const { registry, recording } = setup();
    const controller = new AbortController();
    const requestId = registry.request({
      kind: "agent-consent",
      chatId: 2,
      toolName: "write_file",
      classifier: "none",
    });
    const park = registry.park(requestId, controller.signal);
    controller.abort();
    await expect(park).resolves.toBeNull();
    expect(recording.commands).toContainEqual(
      expect.objectContaining({ type: "broadcast-settled", outcome: "swept" }),
    );
  });

  it("keeps due entries pending and makes repeated dispatch signals safe", async () => {
    const { registry, broadcast } = setup();
    const requestId = registry.request({
      kind: "integration",
      chatId: 4,
      provider: "supabase",
      classifier: "none",
      followUpPrompt: "continue",
    });
    await registry.respond(requestId, {
      kind: "integration",
      provider: "supabase",
      completed: true,
    });
    expect(registry.getPending()[0].status).toBe("armed");
    registry.streamFinished(4);
    registry.streamFinished(4);
    expect(registry.getPending()[0].status).toBe("due");
    expect(
      broadcast.mock.calls.filter(
        ([channel]) => channel === "user-input:follow-up-due",
      ),
    ).toHaveLength(1);
    await registry.followUpDispatched(requestId);
    expect(registry.getPending()).toEqual([]);
  });

  it("treats rejection after dispatch as an idempotent no-op", async () => {
    const { registry } = setup();
    const requestId = registry.request({
      kind: "integration",
      chatId: 4,
      provider: "supabase",
      classifier: "none",
      followUpPrompt: "continue",
    });
    await registry.respond(requestId, {
      kind: "integration",
      provider: "supabase",
      completed: true,
    });
    registry.streamFinished(4);
    await registry.followUpDispatched(requestId);

    await expect(registry.followUpRejected(requestId)).resolves.toBeUndefined();
  });

  it("never makes an armed continuation due after the chat is swept", async () => {
    const { registry, broadcast } = setup();
    const requestId = registry.request({
      kind: "integration",
      chatId: 8,
      provider: "neon",
      classifier: "none",
      followUpPrompt: "Continue. I have completed the neon integration.",
    });
    await registry.respond(requestId, {
      kind: "integration",
      provider: "neon",
      completed: true,
    });

    registry.sweepChat(8);
    registry.streamFinished(8);

    expect(registry.getPending()).toEqual([]);
    expect(
      broadcast.mock.calls.filter(
        ([channel]) => channel === "user-input:follow-up-due",
      ),
    ).toHaveLength(0);
    expect(broadcast).toHaveBeenCalledWith("user-input:settled", {
      requestId,
      outcome: "swept",
    });
  });

  it("keeps a due follow-up retryable while sweeping other chat inputs", async () => {
    const { registry } = setup();
    const followUp = registry.request({
      kind: "integration",
      chatId: 18,
      provider: "neon",
      classifier: "none",
      followUpPrompt: "continue",
    });
    const consent = registry.request({
      kind: "agent-consent",
      chatId: 18,
      toolName: "read_file",
      classifier: "none",
    });
    await registry.respond(followUp, {
      kind: "integration",
      provider: "neon",
      completed: true,
    });
    registry.streamFinished(18);
    registry.sweepChat(18);

    expect(registry.getPending()).toEqual([
      expect.objectContaining({
        status: "due",
        descriptor: expect.objectContaining({ requestId: followUp }),
      }),
    ]);
    await expect(registry.park(consent)).resolves.toBeNull();
  });

  it("settles an incomplete integration response without arming a follow-up", async () => {
    const { registry, broadcast } = setup();
    const requestId = registry.request({
      kind: "integration",
      chatId: 12,
      classifier: "none",
      followUpPrompt: "Continue. I have completed the database integration.",
    });
    const park = registry.park(requestId);

    await registry.respond(requestId, {
      kind: "integration",
      provider: null,
      completed: false,
    });

    await expect(park).resolves.toEqual({
      kind: "integration",
      provider: null,
      completed: false,
    });
    expect(registry.getPending()).toEqual([]);
    registry.streamFinished(12);
    expect(
      broadcast.mock.calls.some(
        ([channel]) => channel === "user-input:follow-up-due",
      ),
    ).toBe(false);
  });

  it("dispose aborts all live parks and clears deadlines", async () => {
    const { registry, clock } = setup();
    const requestId = registry.request({
      kind: "agent-consent",
      chatId: 5,
      toolName: "write_file",
      classifier: "none",
    });
    const park = registry.park(requestId);
    registry.dispose();
    await expect(park).resolves.toBeNull();
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it("continues terminal cleanup when always-consent persistence fails", async () => {
    const clock = createFakeClock();
    const broadcast = vi.fn();
    const onCommandError = vi.fn();
    const registry = createUserInputRegistry({
      clock,
      idSource: createSequentialIdSource(),
      broadcast,
      persistAlways: async () => {
        throw new Error("disk full");
      },
      onCommandError,
    });
    const requestId = registry.request({
      kind: "agent-consent",
      chatId: 6,
      toolName: "write_file",
      classifier: "none",
    });
    const park = registry.park(requestId);

    await expect(
      registry.respond(requestId, {
        kind: "agent-consent",
        decision: "accept-always",
      }),
    ).rejects.toThrow("disk full");
    await expect(park).resolves.toBeNull();
    expect(clock.pendingTimerCount()).toBe(0);
    expect(broadcast).toHaveBeenCalledWith(
      "user-input:settled",
      expect.objectContaining({ requestId, outcome: "human" }),
    );
    expect(onCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ type: "persist-always" }),
      expect.any(Error),
    );
  });

  it("releases a settled park after it is consumed", async () => {
    const { registry } = setup();
    const requestId = registry.request({
      kind: "agent-consent",
      chatId: 7,
      toolName: "read_file",
      classifier: "none",
    });
    await registry.respond(requestId, {
      kind: "agent-consent",
      decision: "accept-once",
    });
    await expect(registry.park(requestId)).resolves.toMatchObject({
      decision: "accept-once",
    });
    await expect(registry.park(requestId)).resolves.toBeNull();
  });
});
