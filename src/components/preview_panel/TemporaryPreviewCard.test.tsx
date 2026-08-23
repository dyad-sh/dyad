import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TempPreviewStatus } from "@/ipc/types/temp_preview";
import { TemporaryPreviewCard } from "./TemporaryPreviewCard";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  publish: vi.fn(),
  revoke: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    tempPreview: {
      getStatus: mocks.getStatus,
      publish: mocks.publish,
      revoke: mocks.revoke,
    },
    system: { openExternalUrl: mocks.openExternalUrl },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const none: TempPreviewStatus = {
  state: "none",
  canonicalUrl: null,
  expiresAt: null,
  lastPublishedAt: null,
};

const active: TempPreviewStatus = {
  state: "active",
  canonicalUrl: "https://friendly-name.temp.md",
  expiresAt: "2026-08-30T12:00:00.000Z",
  lastPublishedAt: "2026-08-23T12:00:00.000Z",
};

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<TemporaryPreviewCard appId={42} />, { wrapper: Wrapper });
}

describe("TemporaryPreviewCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStatus.mockResolvedValue(none);
    mocks.publish.mockResolvedValue(active);
    mocks.revoke.mockResolvedValue({ ...active, state: "revoked" });
  });

  it("creates a preview and replaces the create action with its public URL", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(
      await screen.findByRole("button", { name: "Create preview" }),
    );

    expect(mocks.publish).toHaveBeenCalledWith({ appId: 42 });
    expect(await screen.findByText(active.canonicalUrl!)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
  });

  it("opens an existing preview through the main process", async () => {
    mocks.getStatus.mockResolvedValue(active);
    const user = userEvent.setup();
    renderCard();

    await user.click(
      await screen.findByRole("button", {
        name: "Open temporary preview",
      }),
    );

    expect(mocks.openExternalUrl).toHaveBeenCalledWith(active.canonicalUrl);
  });

  it("requires confirmation before revoking the public link", async () => {
    mocks.getStatus.mockResolvedValue(active);
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(mocks.revoke).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Revoke preview" }));

    await waitFor(() => {
      expect(mocks.revoke).toHaveBeenCalledWith({ appId: 42 });
    });
  });
});
