import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * What the flag actually hides.
 *
 * Deploying to your own server is off by default, and off has to mean the
 * Publish panel looks the way it did before the option existed — not a
 * disabled tab, not a greyed-out card. Coolify is early enough that a user
 * who has not asked for it should never be offered it.
 */

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: settings.value, updateSettings: vi.fn() }),
}));

// The two connectors each open IPC channels and queries of their own; this is
// about which of them the panel puts on screen.
vi.mock("@/components/VercelConnector", () => ({
  VercelConnector: () => <div>vercel-connector</div>,
}));
vi.mock("@/components/CoolifyConnector", () => ({
  CoolifyConnector: () => <div>coolify-connector</div>,
}));
vi.mock("@/components/CloudflareConnector", () => ({
  CloudflareConnector: () => <div>cloudflare-connector</div>,
}));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));

const { DeploymentSection } = await import("./DeploymentSection");

const APP = { name: "demo", githubOrg: "acme", githubRepo: "demo" };

describe("with deployment to your own server turned off", () => {
  it("shows the Vercel card alone, with no tabs", () => {
    settings.value = {};
    render(<DeploymentSection appId={1} app={APP} />);

    expect(screen.getByText("vercel-connector")).toBeTruthy();
    expect(screen.queryByText("coolify-connector")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    // Not even the name of the thing they did not opt into.
    expect(screen.queryByText(/own server/i)).toBeNull();
  });
});

describe("with it turned on", () => {
  it("offers both destinations as tabs, Vercel first", () => {
    settings.value = { enableOwnServerDeployment: true };
    render(<DeploymentSection appId={1} app={APP} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Vercel",
      "Your Own Server",
    ]);
    // Vercel is where an app publishes unless the user says otherwise, so it
    // is the tab that opens.
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("vercel-connector")).toBeTruthy();
  });
});

describe("with Cloudflare deployment turned off", () => {
  it("does not mention Cloudflare, even beside your own server", () => {
    settings.value = { enableOwnServerDeployment: true };
    render(<DeploymentSection appId={1} app={APP} />);

    expect(screen.queryByText(/cloudflare/i)).toBeNull();
  });
});

describe("with Cloudflare deployment turned on", () => {
  it("adds a Cloudflare tab without bringing your own server along", () => {
    settings.value = { enableCloudflareDeployment: true };
    render(<DeploymentSection appId={1} app={APP} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Vercel", "Cloudflare"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("coolify-connector")).toBeNull();
  });

  it("orders the tabs the same way whichever options are on", () => {
    settings.value = {
      enableCloudflareDeployment: true,
      enableOwnServerDeployment: true,
    };
    render(<DeploymentSection appId={1} app={APP} />);

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Vercel",
      "Cloudflare",
      "Your Own Server",
    ]);
  });

  it("shows the connector once the app is on GitHub", () => {
    settings.value = { enableCloudflareDeployment: true };
    render(<DeploymentSection appId={1} app={APP} />);

    fireEvent.click(screen.getByRole("tab", { name: "Cloudflare" }));

    expect(screen.getByText("cloudflare-connector")).toBeTruthy();
  });

  it("asks for GitHub first, before any Cloudflare setup", () => {
    // Cloudflare builds from the repository, so without one there is nothing
    // an API token could be used for yet.
    settings.value = { enableCloudflareDeployment: true };
    render(
      <DeploymentSection
        appId={1}
        app={{ name: "demo", githubOrg: null, githubRepo: null }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Cloudflare" }));

    expect(
      screen.getByText("GitHub Required for Cloudflare Deployment"),
    ).toBeTruthy();
    expect(screen.queryByText("cloudflare-connector")).toBeNull();
  });
});
