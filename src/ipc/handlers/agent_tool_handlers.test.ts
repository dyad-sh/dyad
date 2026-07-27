import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcContract } from "@/ipc/contracts/core";
import { DyadErrorKind } from "@/errors/dyad_error";

const registeredHandlers = vi.hoisted(
  () =>
    new Map<
      string,
      (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
    >(),
);

vi.mock("@/ipc/handlers/base", () => ({
  createTypedHandler: vi.fn(
    (
      contract: IpcContract<string, never, never>,
      handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>,
    ) => {
      registeredHandlers.set(contract.channel, handler);
    },
  ),
}));

const registry = vi.hoisted(() => ({
  getAllAgentToolConsents: vi.fn(() => ({ bash: "ask" as const })),
  setAgentToolConsent: vi.fn(),
  getDefaultConsent: vi.fn(() => "ask" as const),
  TOOL_DEFINITIONS: [
    {
      name: "bash",
      description: "Run a shell command",
    },
  ],
}));

vi.mock("@/ipc/pi/tools/dyad/tool_registry", () => registry);

import { agentContracts } from "@/ipc/types";
import { registerAgentToolHandlers } from "./agent_tool_handlers";

function getHandler(channel: string) {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler;
}

describe("registerAgentToolHandlers", () => {
  beforeEach(() => {
    registeredHandlers.clear();
    registry.setAgentToolConsent.mockClear();
    registerAgentToolHandlers();
  });

  it("returns registered tools with their effective consent", async () => {
    await expect(
      getHandler(agentContracts.getTools.channel)(
        {} as IpcMainInvokeEvent,
        undefined,
      ),
    ).resolves.toEqual([
      {
        name: "bash",
        description: "Run a shell command",
        isAllowedByDefault: false,
        consent: "ask",
      },
    ]);
  });

  it("sets consent for a registered tool and honors the void contract", async () => {
    await expect(
      getHandler(agentContracts.setConsent.channel)({} as IpcMainInvokeEvent, {
        toolName: "bash",
        consent: "never",
      }),
    ).resolves.toBeUndefined();
    expect(registry.setAgentToolConsent).toHaveBeenCalledWith("bash", "never");
  });

  it("rejects consent updates for unknown tools", async () => {
    await expect(
      getHandler(agentContracts.setConsent.channel)({} as IpcMainInvokeEvent, {
        toolName: "unknown",
        consent: "always",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    expect(registry.setAgentToolConsent).not.toHaveBeenCalled();
  });
});
