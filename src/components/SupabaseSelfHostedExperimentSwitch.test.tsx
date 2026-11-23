import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupabaseSelfHostedExperimentSwitch } from "./SupabaseSelfHostedExperimentSwitch";

const mocks = vi.hoisted(() => ({
  settings: undefined as { enableSupabaseSelfHosted?: boolean } | undefined,
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

const toggle = () =>
  screen.getByRole("switch", { name: "Allow self-hosted Supabase" });

describe("SupabaseSelfHostedExperimentSwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings = undefined;
  });
  afterEach(cleanup);

  it("can't be changed until settings have loaded", () => {
    render(<SupabaseSelfHostedExperimentSwitch />);

    fireEvent.click(toggle());

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("leaves a failed save to the mutation's own error toast", async () => {
    mocks.settings = { enableSupabaseSelfHosted: false };
    const failure = Promise.reject(new Error("disk full"));
    const caught = vi.spyOn(failure, "catch");
    mocks.updateSettings.mockReturnValue(failure);
    render(<SupabaseSelfHostedExperimentSwitch />);

    fireEvent.click(toggle());

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableSupabaseSelfHosted: true,
    });
    expect(caught).toHaveBeenCalled();
    await expect(failure).rejects.toThrow("disk full");
  });
});
