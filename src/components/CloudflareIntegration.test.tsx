import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: settings.value, updateSettings: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ showSuccess: vi.fn() }));

const { CloudflareIntegration } = await import("./CloudflareIntegration");

afterEach(cleanup);

describe("the Cloudflare card in Settings", () => {
  it("is not shown without a saved token", () => {
    settings.value = { enableCloudflareDeployment: true };
    render(<CloudflareIntegration />);
    expect(screen.queryByText("Cloudflare Integration")).toBeNull();
  });

  it("still offers to remove a saved token with the experiment off", () => {
    // Otherwise turning the experiment off strands the token in settings.
    settings.value = { cloudflareAccessToken: { value: "cf-token" } };
    render(<CloudflareIntegration />);
    expect(
      screen.getByRole("button", { name: /Disconnect from Cloudflare/ }),
    ).toBeTruthy();
  });

  it("says how to reach the Publish panel tab when the experiment hides it", () => {
    settings.value = { cloudflareAccessToken: { value: "cf-token" } };
    render(<CloudflareIntegration />);
    expect(screen.getByText(/turn it back on to do that/)).toBeTruthy();
  });

  it("does not mention the experiment while it is on", () => {
    settings.value = {
      cloudflareAccessToken: { value: "cf-token" },
      enableCloudflareDeployment: true,
    };
    render(<CloudflareIntegration />);
    expect(screen.getByText(/Publish panel first/)).toBeTruthy();
    expect(screen.queryByText(/turn it back on/)).toBeNull();
  });

  it("says that removing the token does not stop Workers deploying", () => {
    settings.value = { cloudflareAccessToken: { value: "cf-token" } };
    render(<CloudflareIntegration />);
    expect(
      screen.getByText(/does not stop\s+connected Workers from deploying/),
    ).toBeTruthy();
  });
});
