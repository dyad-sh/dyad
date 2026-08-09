import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * What the panel shows before it has an answer.
 *
 * There are three states without data and they are not the same thing: still
 * loading, paused because the renderer is offline, and failed. A paused query
 * is pending with no data and no error — react-query's default network mode
 * holds it until connectivity returns — so treating "no data" as failure put
 * a red error card in front of a read that had not been attempted.
 */

const deploy = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/useCoolifyDeploy", () => ({
  useCoolifyDeploy: () => ({
    snapshot: { type: "idle" },
    status: undefined,
    isStatusLoading: false,
    statusError: null,
    refetchStatus: vi.fn(),
    discovery: undefined,
    discoveryError: null,
    isDiscovering: false,
    refetchDiscovery: vi.fn(),
    saveToken: { mutateAsync: vi.fn(), isPending: false },
    clearToken: { mutateAsync: vi.fn(), isPending: false },
    saveConnection: { mutateAsync: vi.fn(), isPending: false },
    disconnect: { mutateAsync: vi.fn(), isPending: false },
    createProject: { mutateAsync: vi.fn(), isPending: false },
    checkDomain: { mutateAsync: vi.fn(), isPending: false },
    deploy: { mutateAsync: vi.fn(), isPending: false },
    ...deploy.value,
  }),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: { name: "demo" }, loading: false }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));

const { CoolifyConnector } = await import("./CoolifyConnector");

describe("before the status query has answered", () => {
  it("waits rather than claiming a failure when it is merely paused", () => {
    // Offline: pending, no data, no error. Nothing has gone wrong.
    deploy.value = { status: undefined, statusError: null };
    render(<CoolifyConnector appId={1} />);

    expect(screen.queryByTestId("coolify-status-error")).toBeNull();
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });

  it("says what went wrong once the read actually fails", () => {
    // Blank with no message and no retry was the old behaviour, and the query
    // neither retries nor raises a toast, so nothing else would have said it.
    deploy.value = {
      status: undefined,
      statusError: new Error("settings unreadable"),
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-status-error")).toBeTruthy();
    expect(screen.getByText(/settings unreadable/)).toBeTruthy();
  });
});
