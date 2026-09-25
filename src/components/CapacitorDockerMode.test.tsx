import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: settings.value }),
}));

const ipcMocks = vi.hoisted(() => ({
  isCapacitor: vi.fn(),
  getAppUpgrades: vi.fn(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    capacitor: { isCapacitor: ipcMocks.isCapacitor },
    upgrade: { getAppUpgrades: ipcMocks.getAppUpgrades },
    system: { openExternalUrl: vi.fn() },
  },
}));

vi.mock("@/lib/toast", () => ({ showSuccess: vi.fn() }));

const { CapacitorControls } = await import("./CapacitorControls");
const { AppUpgrades } = await import("./AppUpgrades");

function renderWithQuery(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  ipcMocks.isCapacitor.mockResolvedValue(true);
  ipcMocks.getAppUpgrades.mockResolvedValue([
    {
      id: "capacitor",
      title: "Upgrade to hybrid mobile app with Capacitor",
      description: "Adds Capacitor",
      isNeeded: true,
    },
    {
      id: "component-tagger",
      title: "Enable select component to edit",
      description: "Installs the tagger",
      isNeeded: true,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function button(element: HTMLElement): HTMLButtonElement {
  return element as HTMLButtonElement;
}

describe("Capacitor actions in Docker mode", () => {
  it("disables sync-and-open and explains why", async () => {
    settings.value = { runtimeMode2: "docker" };
    renderWithQuery(<CapacitorControls appId={1} />);

    const note = await screen.findByTestId("capacitor-docker-unsupported");
    expect(note.textContent).toContain(
      "Capacitor isn't available in Docker mode",
    );
    const ios = screen.getByRole("button", { name: /Sync & Open iOS/ });
    const android = screen.getByRole("button", { name: /Sync & Open Android/ });
    expect(button(ios).disabled).toBe(true);
    expect(button(android).disabled).toBe(true);
  });

  it("keeps sync-and-open enabled in Local mode", async () => {
    settings.value = { runtimeMode2: "host" };
    renderWithQuery(<CapacitorControls appId={1} />);

    const ios = await screen.findByRole("button", { name: /Sync & Open iOS/ });
    expect(button(ios).disabled).toBe(false);
    expect(screen.queryByTestId("capacitor-docker-unsupported")).toBeNull();
  });

  it("disables only the Capacitor upgrade", async () => {
    settings.value = { runtimeMode2: "docker" };
    renderWithQuery(<AppUpgrades appId={1} />);

    const capacitor = await screen.findByTestId("app-upgrade-capacitor");
    expect(button(capacitor).disabled).toBe(true);
    expect(
      screen.getByTestId("app-upgrade-capacitor-docker-unsupported")
        .textContent,
    ).toContain("Capacitor isn't available in Docker mode");
    const tagger = screen.getByTestId("app-upgrade-component-tagger");
    expect(button(tagger).disabled).toBe(false);
  });

  it("leaves the Capacitor upgrade available in Local mode", async () => {
    settings.value = {};
    renderWithQuery(<AppUpgrades appId={1} />);

    const capacitor = await screen.findByTestId("app-upgrade-capacitor");
    expect(button(capacitor).disabled).toBe(false);
    expect(
      screen.queryByTestId("app-upgrade-capacitor-docker-unsupported"),
    ).toBeNull();
  });
});
