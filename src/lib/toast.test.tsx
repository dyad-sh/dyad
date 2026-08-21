import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, showError } from "./toast";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    custom: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../components/CustomErrorToast", () => ({
  CustomErrorToast: () => null,
}));

vi.mock("../components/InputRequestToast", () => ({
  InputRequestToast: () => null,
}));

describe("showError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps actionable error toasts open until the user dismisses them", () => {
    showError("Could not read settings", {
      action: {
        label: "Read restore docs",
        onClick: vi.fn(),
      },
    });

    expect(toast.custom).toHaveBeenCalledWith(expect.any(Function), {
      duration: Infinity,
    });
  });

  it("keeps producer-scoped persistent error toasts open", () => {
    showError("Git push failed", {
      persist: true,
      toastId: "github-ops-probe-7",
    });

    expect(toast.custom).toHaveBeenCalledWith(expect.any(Function), {
      duration: Infinity,
      id: "github-ops-probe-7",
    });
  });

  it("auto-dismisses non-actionable error toasts", () => {
    showError("Could not read settings");

    expect(toast.custom).toHaveBeenCalledWith(expect.any(Function), {
      duration: 8_000,
    });
  });

  it("does not let a stale copy timer replace a newer toast", () => {
    vi.useFakeTimers();
    showError("Old Git error", { toastId: "github-ops-7" });
    const oldToastRenderer = vi.mocked(toast.custom).mock.calls[0][0];
    const oldToast = oldToastRenderer("github-ops-7") as {
      props: { onCopy: () => void };
    };
    oldToast.props.onCopy();

    showError("New Git error", { toastId: "github-ops-7" });
    vi.advanceTimersByTime(2_000);

    expect(toast.custom).toHaveBeenCalledTimes(3);
  });

  it("dismisses a producer-scoped toast by id", () => {
    dismissToast("github-ops-7");

    expect(toast.dismiss).toHaveBeenCalledWith("github-ops-7");
  });
});
