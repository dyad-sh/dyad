import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { PnpmMinimumReleaseAgeToast } from "./PnpmMinimumReleaseAgeToast";

vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
  },
}));

describe("PnpmMinimumReleaseAgeToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the toast open while installing and briefly shows success", async () => {
    const onInstallPnpm = vi.fn().mockResolvedValue(undefined);

    render(
      <PnpmMinimumReleaseAgeToast
        toastId="pnpm-toast"
        message="Install pnpm 10.16.0 or newer."
        onInstallPnpm={onInstallPnpm}
        onOpenDocs={vi.fn()}
        onNeverShowAgain={vi.fn()}
      />,
    );

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

    render(
      <PnpmMinimumReleaseAgeToast
        toastId="pnpm-toast"
        message="Install pnpm 10.16.0 or newer."
        onInstallPnpm={onInstallPnpm}
        onOpenDocs={onOpenDocs}
        onNeverShowAgain={vi.fn()}
      />,
    );

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
});
