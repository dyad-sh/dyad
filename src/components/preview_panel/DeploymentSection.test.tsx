import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeploymentProvidersInUse } from "@/ipc/types";

/**
 * What the flag actually hides, and which tab the card opens on.
 *
 * Deploying to your own server is off by default, and off has to mean the
 * Publish panel looks the way it did before the option existed — not a
 * disabled tab, not a greyed-out card. Coolify is early enough that a user
 * who has not asked for it should never be offered it.
 *
 * With tabs on screen, the card opens on the first one the app is actually
 * connected to. A user with a Cloudflare Worker and no Vercel project should
 * not land on Vercel every time.
 */

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: settings.value, updateSettings: vi.fn() }),
}));

// The connectors each open IPC channels and queries of their own; this is
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

const { DeploymentSection, chooseDefaultDeploymentTab } =
  await import("./DeploymentSection");

const NONE: DeploymentProvidersInUse = {
  vercel: false,
  cloudflare: false,
  coolify: false,
};

function app(inUse: Partial<DeploymentProvidersInUse> = {}) {
  return {
    name: "demo",
    githubOrg: "acme",
    githubRepo: "demo",
    deploymentProvidersInUse: { ...NONE, ...inUse },
  };
}

const APP = app();
const ALL_ON = {
  enableCloudflareDeployment: true,
  enableOwnServerDeployment: true,
};

function selectedTab(): string | null {
  const tab = screen
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true");
  return tab?.textContent ?? null;
}

beforeEach(() => {
  settings.value = {};
});

describe("with deployment to your own server turned off", () => {
  it("shows the Vercel card alone, with no tabs", () => {
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
    settings.value = ALL_ON;
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
        app={{ ...APP, githubOrg: null, githubRepo: null }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Cloudflare" }));

    expect(
      screen.getByText("GitHub Required for Cloudflare Deployment"),
    ).toBeTruthy();
    expect(screen.queryByText("cloudflare-connector")).toBeNull();
  });
});

describe("which tab opens", () => {
  it("opens on Cloudflare when that is where the app is deployed", () => {
    settings.value = ALL_ON;
    render(<DeploymentSection appId={1} app={app({ cloudflare: true })} />);

    expect(selectedTab()).toBe("Cloudflare");
    expect(screen.getByText("cloudflare-connector")).toBeTruthy();
    expect(screen.queryByText("vercel-connector")).toBeNull();
  });

  it("opens on your own server when only Coolify is connected", () => {
    settings.value = ALL_ON;
    render(<DeploymentSection appId={1} app={app({ coolify: true })} />);

    expect(selectedTab()).toBe("Your Own Server");
  });

  it("prefers the earlier tab when the app is deployed to several", () => {
    settings.value = ALL_ON;
    render(
      <DeploymentSection
        appId={1}
        app={app({ vercel: true, cloudflare: true, coolify: true })}
      />,
    );

    expect(selectedTab()).toBe("Vercel");
  });

  it("skips a destination whose tab is not on screen", () => {
    // Connected to Coolify, but with only the Cloudflare option turned on
    // there is no Coolify tab to open, so this is an app deployed nowhere
    // the card can show.
    settings.value = { enableCloudflareDeployment: true };
    render(<DeploymentSection appId={1} app={app({ coolify: true })} />);

    expect(selectedTab()).toBe("Vercel");
  });

  it("does not follow a connection made or removed after opening", () => {
    // A user who disconnects Cloudflare from its tab is reading the result
    // there; the card must not carry them off to Vercel mid-thought.
    settings.value = ALL_ON;
    const { rerender } = render(
      <DeploymentSection appId={1} app={app({ cloudflare: true })} />,
    );
    expect(selectedTab()).toBe("Cloudflare");

    rerender(<DeploymentSection appId={1} app={app()} />);

    expect(selectedTab()).toBe("Cloudflare");
  });

  it("chooses again for the next app", () => {
    // The section stays mounted when the selected app changes, so the tab
    // picked for one app must not leak into another.
    settings.value = ALL_ON;
    const { rerender } = render(
      <DeploymentSection appId={1} app={app({ cloudflare: true })} />,
    );
    expect(selectedTab()).toBe("Cloudflare");

    rerender(<DeploymentSection appId={2} app={app()} />);

    expect(selectedTab()).toBe("Vercel");
  });
});

describe("chooseDefaultDeploymentTab", () => {
  it("takes the first tab in display order that is in use", () => {
    expect(
      chooseDefaultDeploymentTab(["vercel", "cloudflare", "own-server"], {
        vercel: false,
        cloudflare: true,
        coolify: true,
      }),
    ).toBe("cloudflare");
  });

  it("takes the first tab when nothing is in use", () => {
    expect(chooseDefaultDeploymentTab(["vercel", "own-server"], NONE)).toBe(
      "vercel",
    );
  });
});
