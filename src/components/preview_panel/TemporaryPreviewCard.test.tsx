import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TempPreviewStatus } from "@/ipc/types/temp_preview";
import { queryKeys } from "@/lib/queryKeys";
import { TemporaryPreviewCard } from "./TemporaryPreviewCard";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  publish: vi.fn(),
  revoke: vi.fn(),
  openExternalUrl: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
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

function renderCard(appId = 42) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return {
    ...render(<TemporaryPreviewCard appId={appId} />, { wrapper: Wrapper }),
    queryClient,
  };
}

describe("TemporaryPreviewCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStatus.mockResolvedValue(none);
    mocks.publish.mockResolvedValue(active);
    mocks.revoke.mockResolvedValue({ ...active, state: "revoked" });
    mocks.openExternalUrl.mockResolvedValue(undefined);
  });

  it("creates a preview and replaces the create action with its public URL", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(
      await screen.findByRole("button", { name: "Create preview" }),
    );

    expect(mocks.publish).toHaveBeenCalledWith({ appId: 42 });
    expect(await screen.findByText(active.canonicalUrl!)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create preview" })).toBeNull();
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

  it("reports a failure to open an existing preview", async () => {
    mocks.getStatus.mockResolvedValue(active);
    mocks.openExternalUrl.mockRejectedValue(new Error("Could not open URL"));
    const user = userEvent.setup();
    renderCard();

    await user.click(
      await screen.findByRole("button", {
        name: "Open temporary preview",
      }),
    );

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Could not open URL");
    });
  });

  it("keeps a pending publish result scoped to its originating app", async () => {
    let resolvePublish!: (status: TempPreviewStatus) => void;
    mocks.publish.mockReturnValue(
      new Promise((resolve) => {
        resolvePublish = resolve;
      }),
    );
    const user = userEvent.setup();
    const { rerender, queryClient } = renderCard(42);

    await user.click(
      await screen.findByRole("button", { name: "Create preview" }),
    );
    rerender(<TemporaryPreviewCard appId={43} />);
    resolvePublish(active);

    await waitFor(() => {
      expect(
        queryClient.getQueryData(queryKeys.tempPreviews.status({ appId: 42 })),
      ).toEqual(active);
    });
    expect(
      queryClient.getQueryData(queryKeys.tempPreviews.status({ appId: 43 })),
    ).toEqual(none);
  });

  it("keeps a pending revoke result scoped to its originating app", async () => {
    const otherActive = {
      ...active,
      canonicalUrl: "https://other.temp.md",
    };
    const revoked = { ...active, state: "revoked" as const };
    mocks.getStatus.mockImplementation(({ appId }: { appId: number }) =>
      Promise.resolve(appId === 42 ? active : otherActive),
    );
    let resolveRevoke!: (status: TempPreviewStatus) => void;
    mocks.revoke.mockReturnValue(
      new Promise((resolve) => {
        resolveRevoke = resolve;
      }),
    );
    const user = userEvent.setup();
    const { rerender, queryClient } = renderCard(42);

    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    await user.click(screen.getByRole("button", { name: "Revoke preview" }));
    rerender(<TemporaryPreviewCard appId={43} />);
    resolveRevoke(revoked);

    await waitFor(() => {
      expect(
        queryClient.getQueryData(queryKeys.tempPreviews.status({ appId: 42 })),
      ).toEqual(revoked);
    });
    expect(
      queryClient.getQueryData(queryKeys.tempPreviews.status({ appId: 43 })),
    ).toEqual(otherActive);
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

  it("binds revoke confirmation to the app that opened the dialog", async () => {
    mocks.getStatus.mockResolvedValue(active);
    const user = userEvent.setup();
    const { rerender } = renderCard(42);

    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    rerender(<TemporaryPreviewCard appId={43} />);
    await user.click(screen.getByRole("button", { name: "Revoke preview" }));

    await waitFor(() => {
      expect(mocks.revoke).toHaveBeenCalledWith({ appId: 42 });
    });
  });
});
