import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRemoteMachineConnection } from "./ipc_connection";

const onProtocolMismatch = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/types", () => ({
  ipc: {
    events: {
      distributedMachine: {
        onProtocolMismatch,
        onSnapshot: vi.fn(),
        onDisposed: vi.fn(),
      },
    },
    distributedMachine: {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      dispatch: vi.fn(),
    },
  },
}));

describe("IpcRemoteMachineConnection", () => {
  beforeEach(() => {
    onProtocolMismatch.mockReset();
    onProtocolMismatch.mockReturnValue(vi.fn());
  });

  it("restores connected status across lifecycle replay", () => {
    const connection = new IpcRemoteMachineConnection();
    const statuses: string[] = [];
    connection.onStatusChange((status) => statuses.push(status));

    const stop = connection.start();
    stop();
    expect(connection.getStatus()).toBe("disconnected");

    connection.start();
    expect(connection.getStatus()).toBe("connected");
    expect(statuses).toEqual(["disconnected", "connected"]);
  });
});
