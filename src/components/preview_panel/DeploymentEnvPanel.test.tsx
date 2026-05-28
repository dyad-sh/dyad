import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentEnvPanel } from "./DeploymentEnvPanel";

const { getBranchConnectionUriMock, openExternalUrlMock } = vi.hoisted(() => ({
  getBranchConnectionUriMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    neon: {
      getBranchConnectionUri: getBranchConnectionUriMock,
    },
    system: {
      openExternalUrl: openExternalUrlMock,
    },
  },
}));

function renderDeploymentEnvPanel(appId = 123) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DeploymentEnvPanel appId={appId} />
    </QueryClientProvider>,
  );
}

describe("DeploymentEnvPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("falls back to the legacy database URL panel environment selection", async () => {
    localStorage.setItem("dyad.databaseUrlPanel.env.123", "prod");
    getBranchConnectionUriMock.mockResolvedValue({
      connectionUri: "postgresql://prod.example/test",
    });

    renderDeploymentEnvPanel();

    await waitFor(() => {
      expect(getBranchConnectionUriMock).toHaveBeenCalledWith({
        appId: 123,
        branchType: "production",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to selection" }));

    expect(localStorage.getItem("dyad.databaseUrlPanel.env.123")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("does not flash Neon Auth rows while loading a non-auth project", async () => {
    localStorage.setItem("dyad.deploymentEnvPanel.env.123", "dev");
    let resolveQuery!: (value: { connectionUri: string }) => void;
    getBranchConnectionUriMock.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );

    renderDeploymentEnvPanel();

    expect(
      screen.queryByRole("textbox", { name: "NEON_AUTH_BASE_URL" }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "NEON_AUTH_COOKIE_SECRET" }),
    ).toBeNull();

    await act(async () => {
      resolveQuery({ connectionUri: "postgresql://dev.example/test" });
    });

    await waitFor(() => {
      expect(
        (
          screen.getByRole("textbox", {
            name: "DATABASE_URL",
          }) as HTMLInputElement
        ).value,
      ).toBe("postgresql://dev.example/test");
    });
    expect(
      screen.queryByRole("textbox", { name: "NEON_AUTH_BASE_URL" }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "NEON_AUTH_COOKIE_SECRET" }),
    ).toBeNull();
  });
});
