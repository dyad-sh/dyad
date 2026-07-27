import { describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { getRegisteredHandlerForTesting } from "./base";
import { registerConnectionFlowHandlers } from "./connection_flow_handlers";

vi.mock("electron", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: undefined,
}));

registerConnectionFlowHandlers();

function event() {
  return {
    sender: {
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
    },
  };
}

describe("connection-flow remote admission", () => {
  it("rejects a stale two-window start and requires the exact ref to cancel", async () => {
    const start = getRegisteredHandlerForTesting("connection-flow:start");
    const cancel = getRegisteredHandlerForTesting("connection-flow:cancel");
    const firstWindow = event();
    const secondWindow = event();

    const first = (await start(firstWindow as never, {
      provider: "neon",
      appId: null,
      expectedRevision: 0,
    })) as {
      invocationRef: {
        kind: "connection-flow";
        entityKey: "neon";
        operationId: string;
      };
      state: { revision: number };
    };
    await expect(
      start(secondWindow as never, {
        provider: "neon",
        appId: null,
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Conflict });

    await cancel(secondWindow as never, {
      provider: "neon",
      invocationRef: {
        ...first.invocationRef,
        operationId: "stale-window-ref",
      },
    });
    await expect(
      start(secondWindow as never, {
        provider: "neon",
        appId: null,
        expectedRevision: first.state.revision,
      }),
    ).resolves.toMatchObject({
      started: false,
      invocationRef: first.invocationRef,
    });
  });
});
