import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcRemoteMachineConnection } from "./ipc_connection";
import { REMOTE_MACHINE_PROTOCOL_VERSION } from "./remote_protocol";

const onProtocolMismatch = vi.hoisted(() => vi.fn());
const subscribe = vi.hoisted(() => vi.fn());
const unsubscribe = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/types", () => ({
  ipc: {
    events: {
      distributedMachine: {
        onProtocolMismatch,
        onSnapshot: vi.fn(),
        onDisposed: vi.fn(),
        onOperationOutcome: vi.fn(),
      },
    },
    distributedMachine: {
      subscribe,
      unsubscribe,
      dispatch,
    },
  },
}));

describe("IpcRemoteMachineConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("fences every request with a stable connection ID", () => {
    const connection = new IpcRemoteMachineConnection();
    const address = {
      protocolVersion: REMOTE_MACHINE_PROTOCOL_VERSION,
      machineId: "app_run",
      encodedKey: { appId: 1 },
    };

    connection.subscribe(address);
    connection.dispatch({
      ...address,
      messageId: "message:1",
      encodedEvent: { type: "START" },
    });
    connection.unsubscribe(address);

    const subscribeInput = subscribe.mock.calls[0][0];
    const dispatchInput = dispatch.mock.calls[0][0];
    const unsubscribeInput = unsubscribe.mock.calls[0][0];
    expect(subscribeInput.rendererConnectionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(unsubscribeInput.rendererConnectionId).toBe(
      subscribeInput.rendererConnectionId,
    );
    expect(dispatchInput.rendererConnectionId).toBe(
      subscribeInput.rendererConnectionId,
    );

    new IpcRemoteMachineConnection().subscribe(address);
    expect(subscribe.mock.calls[1][0].rendererConnectionId).not.toBe(
      subscribeInput.rendererConnectionId,
    );
  });
});
