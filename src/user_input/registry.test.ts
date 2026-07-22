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
  return { registry, clock, recording, broadcast };
}

describe("user-input registry", () => {
  it("uses its injected clock as the only deadline source", async () => {
    const { registry, clock } = setup();
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
    await expect(registry.followUpDispatched(requestId)).rejects.toMatchObject({
      kind: "not_found",
    });
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
});
