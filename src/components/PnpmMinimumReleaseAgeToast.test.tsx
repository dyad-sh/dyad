import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PnpmMinimumReleaseAgeToast } from "./PnpmMinimumReleaseAgeToast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { getNodejsStatusMock, openExternalUrlMock } = vi.hoisted(() => ({
  getNodejsStatusMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
  },
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: {
      getNodejsStatus: getNodejsStatusMock,
      openExternalUrl: openExternalUrlMock,
    },
  },
}));

describe("PnpmMinimumReleaseAgeToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getNodejsStatusMock.mockResolvedValue({
      nodeVersion: "v22.14.0",
      pnpmVersion: "10.15.0",
      nodeDownloadUrl: "https://example.com/node.pkg",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderToast(
    props: Partial<ComponentProps<typeof PnpmMinimumReleaseAgeToast>> = {},
  ) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <PnpmMinimumReleaseAgeToast
          toastId="pnpm-toast"
          message="Install pnpm 10.16.0 or newer for the strongest protection"
          onInstallPnpm={vi.fn()}
          onOpenDocs={vi.fn()}
          onNeverShowAgain={vi.fn()}
          {...props}
        />
      </QueryClientProvider>,
    );
  }

  it("keeps the toast open while installing and briefly shows success", async () => {
    const onInstallPnpm = vi.fn().mockResolvedValue(undefined);

    renderToast({ onInstallPnpm });

    const installButton = screen.getByRole("button", {
      name: /install pnpm/i,
    });
    await act(async () => {
      fireEvent.click(installButton);
      await Promise.resolve();
    });

    expect((installButton as HTMLButtonElement).disabled).toBe(true);
    expect(toast.dismiss).not.toHaveBeenCalled();

    screen.getByText("pnpm successfully installed");

    expect(toast.dismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(toast.dismiss).toHaveBeenCalledWith("pnpm-toast");
  });

  it("shows an actionable docs link when installation fails", async () => {
    const onOpenDocs = vi.fn();
    const onInstallPnpm = vi
      .fn()
      .mockRejectedValue(new Error("Could not install pnpm because of EACCES"));

    renderToast({ onInstallPnpm, onOpenDocs });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /install pnpm/i }));
      await Promise.resolve();
    });

    screen.getByText(
      "Could not install pnpm because of EACCES. Please read pnpm docs for other installation options.",
    );

    fireEvent.click(screen.getByRole("button", { name: /open docs/i }));

    expect(onOpenDocs).toHaveBeenCalledTimes(1);
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it("shows a Node.js download action when Node is too old for pnpm v11", async () => {
    vi.useRealTimers();
    getNodejsStatusMock.mockResolvedValue({
      nodeVersion: "v20.11.1",
      pnpmVersion: "10.15.0",
      nodeDownloadUrl: "https://example.com/node.pkg",
    });
    const onInstallPnpm = vi.fn();

    renderToast({ onInstallPnpm });

    const downloadButton = await screen.findByRole("button", {
      name: /download node\.js/i,
    });
    fireEvent.click(downloadButton);

    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://example.com/node.pkg",
    );
    expect(onInstallPnpm).not.toHaveBeenCalled();
  });

  it("treats a Node prerelease as below the final pnpm v11 minimum", async () => {
    vi.useRealTimers();
    getNodejsStatusMock.mockResolvedValue({
      nodeVersion: "v22.13.0-rc.1",
      pnpmVersion: "10.15.0",
      nodeDownloadUrl: "https://example.com/node.pkg",
    });
    const onInstallPnpm = vi.fn();

    renderToast({ onInstallPnpm });

    await screen.findByRole("button", {
      name: /download node\.js/i,
    });

    expect(onInstallPnpm).not.toHaveBeenCalled();
  });
});
