import { describe, expect, it, vi, beforeEach } from "vitest";
import { showError } from "./toast";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    custom: vi.fn(() => "toast-id"),
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

vi.mock("../components/McpConsentToast", () => ({
  McpConsentToast: () => null,
}));

describe("showError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("auto-dismisses non-actionable error toasts", () => {
    showError("Could not read settings");

    expect(toast.custom).toHaveBeenCalledWith(expect.any(Function), {
      duration: 8_000,
    });
  });
});
