import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which step of the setup the tab puts in front of the user, and what it
 * sends when they act on it.
 */

const settings = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  refreshSettings: vi.fn(),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: settings.value,
    refreshSettings: settings.refreshSettings,
  }),
}));

const cloudflare = vi.hoisted(() => ({
  saveToken: vi.fn(),
  listAccounts: vi.fn(),
  listWorkers: vi.fn(),
  getAppStatus: vi.fn(),
  checkRepoAccess: vi.fn(),
  connectWorker: vi.fn(),
  getDeploymentStatus: vi.fn(),
  disconnect: vi.fn(),
}));
const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/types", () => ({
  ipc: { cloudflare, system: { openExternalUrl } },
}));

const showWarning = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ showWarning }));

const { CloudflareConnector } = await import("./CloudflareConnector");

const TARGET = {
  rootDirectory: "worker",
  configPath: "worker/wrangler.jsonc",
  label: "worker",
  suggestedWorkerName: "shop-api",
};
const CONNECTION = {
  rootDirectory: "worker",
  accountId: "acct-1",
  workerName: "shop-api",
  workerUrl: "https://shop-api.acme.workers.dev",
  dashboardUrl: "https://dash.cloudflare.com/acct-1/workers/shop-api",
};

function appStatus(overrides: Record<string, unknown> = {}) {
  return {
    synced: true,
    branch: "main",
    targets: [TARGET],
    connections: [],
    ...overrides,
  };
}

function renderConnector() {
  const queryClient = new QueryClient({
    // The app's own defaults: a result stays "fresh" for a minute unless a
    // query says otherwise.
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CloudflareConnector appId={7} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.value = { cloudflareAccessToken: { value: "cf-token" } };
  cloudflare.listAccounts.mockResolvedValue([{ id: "acct-1", name: "Acme" }]);
  cloudflare.listWorkers.mockResolvedValue([]);
  cloudflare.getAppStatus.mockResolvedValue(appStatus());
  cloudflare.checkRepoAccess.mockResolvedValue({ hasAccess: true });
  cloudflare.getDeploymentStatus.mockResolvedValue({
    state: "live",
    commitHash: "abc1234def",
    logTail: [],
    tokenRevoked: false,
    ruleMissing: false,
    ruleDeploys: null,
    workerUrl: CONNECTION.workerUrl,
  });
});

afterEach(cleanup);

describe("without an API token", () => {
  beforeEach(() => {
    settings.value = {};
  });

  it("sends the user to the prefilled token form and asks Cloudflare for nothing", () => {
    renderConnector();

    fireEvent.click(screen.getByRole("button", { name: "Create API Token" }));

    const url = new URL(openExternalUrl.mock.calls[0][0]);
    expect(url.pathname).toBe("/profile/api-tokens");
    expect(url.searchParams.get("permissionGroupKeys")).toContain("workers_ci");
    expect(cloudflare.listAccounts).not.toHaveBeenCalled();
    expect(cloudflare.getAppStatus).not.toHaveBeenCalled();
  });

  it("saves the pasted token and reloads settings", async () => {
    cloudflare.saveToken.mockResolvedValue(undefined);
    renderConnector();

    fireEvent.change(screen.getByLabelText("Cloudflare API Token"), {
      target: { value: "  pasted-token " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save API Token" }));

    await waitFor(() =>
      expect(settings.refreshSettings).toHaveBeenCalledTimes(1),
    );
    expect(cloudflare.saveToken).toHaveBeenCalledWith({
      token: "pasted-token",
    });
  });

  it("shows why a token was refused and keeps the form", async () => {
    cloudflare.saveToken.mockRejectedValue(
      new Error("This API token is missing a permission."),
    );
    renderConnector();

    fireEvent.change(screen.getByLabelText("Cloudflare API Token"), {
      target: { value: "bad-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save API Token" }));

    expect(await screen.findByText(/missing a permission/)).toBeTruthy();
    expect(settings.refreshSettings).not.toHaveBeenCalled();
  });
});

describe("before a Worker can be connected", () => {
  it("explains what is needed when the app has no Worker", async () => {
    cloudflare.getAppStatus.mockResolvedValue(appStatus({ targets: [] }));
    renderConnector();

    expect(await screen.findByText("No Cloudflare Worker found")).toBeTruthy();
    expect(cloudflare.checkRepoAccess).not.toHaveBeenCalled();
  });

  it("asks for a sync first, without offering the Worker form", async () => {
    cloudflare.getAppStatus.mockResolvedValue(appStatus({ synced: false }));
    renderConnector();

    expect(await screen.findByText("Sync to GitHub first")).toBeTruthy();
    expect(screen.queryByTestId("cloudflare-worker-form")).toBeNull();
    // Nothing is asked of Cloudflare about a repository that is out of date.
    expect(cloudflare.checkRepoAccess).not.toHaveBeenCalled();
  });

  it("says so when the token can no longer see any account", async () => {
    cloudflare.listAccounts.mockResolvedValue([]);
    renderConnector();

    expect(await screen.findByTestId("cloudflare-no-accounts")).toBeTruthy();
    expect(cloudflare.checkRepoAccess).not.toHaveBeenCalled();
  });

  it("shows why the accounts could not be listed when a folder needs setting up", async () => {
    cloudflare.listAccounts.mockRejectedValue(
      new Error("Authentication error"),
    );
    renderConnector();

    const error = await screen.findByTestId("cloudflare-accounts-error");
    expect(error.textContent).toContain("Authentication error");
    expect(screen.queryByTestId("cloudflare-worker-form")).toBeNull();
  });

  it("offers both ways to grant access when Cloudflare cannot see the repository", async () => {
    cloudflare.checkRepoAccess.mockResolvedValue({ hasAccess: false });
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Connect GitHub on Cloudflare",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add This Repository on GitHub" }),
    );

    expect(openExternalUrl.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining("dash.cloudflare.com"),
      expect.stringContaining("github.com/apps/cloudflare-workers-and-pages"),
    ]);
    expect(screen.queryByTestId("cloudflare-worker-form")).toBeNull();
  });
});

describe("choosing a Worker", () => {
  it("defaults to creating one named after the Wrangler config", async () => {
    cloudflare.connectWorker.mockResolvedValue({
      status: "connected",
      connection: CONNECTION,
    });
    renderConnector();

    const name = (await screen.findByTestId(
      "cloudflare-worker-name",
    )) as HTMLInputElement;
    expect(name.value).toBe("shop-api");
    fireEvent.click(screen.getByRole("button", { name: "Connect and Deploy" }));

    await waitFor(() =>
      expect(cloudflare.connectWorker).toHaveBeenCalledWith({
        appId: 7,
        accountId: "acct-1",
        rootDirectory: "worker",
        workerName: "shop-api",
        mode: "create",
        overwrite: false,
      }),
    );
  });

  it("defaults to the existing Worker when one already has that name", async () => {
    cloudflare.listWorkers.mockResolvedValue([{ name: "shop-api" }]);
    cloudflare.connectWorker.mockResolvedValue({
      status: "connected",
      connection: CONNECTION,
    });
    renderConnector();

    await screen.findByTestId("cloudflare-worker-select");
    fireEvent.click(screen.getByRole("button", { name: "Connect and Deploy" }));

    await waitFor(() =>
      expect(cloudflare.connectWorker).toHaveBeenCalledWith(
        expect.objectContaining({ workerName: "shop-api", mode: "existing" }),
      ),
    );
  });

  it("will not submit a name Cloudflare would refuse or one that is taken", async () => {
    cloudflare.listWorkers.mockResolvedValue([{ name: "taken" }]);
    renderConnector();

    const name = await screen.findByTestId("cloudflare-worker-name");
    const submit = screen.getByRole("button", {
      name: "Connect and Deploy",
    }) as HTMLButtonElement;

    fireEvent.change(name, { target: { value: "Not Valid" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "taken" } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/already exists/)).toBeTruthy();
    fireEvent.change(name, { target: { value: "free-name" } });
    expect(submit.disabled).toBe(false);
  });

  it("asks before taking over a Worker that deploys from another repository", async () => {
    cloudflare.connectWorker
      .mockResolvedValueOnce({
        status: "conflict",
        existingRepo: "someone/other-site",
      })
      .mockResolvedValueOnce({ status: "connected", connection: CONNECTION });
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Connect and Deploy" }),
    );
    expect(await screen.findByText(/someone\/other-site/)).toBeTruthy();
    expect(cloudflare.connectWorker).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Replace Rule" }));

    await waitFor(() =>
      expect(cloudflare.connectWorker).toHaveBeenLastCalledWith(
        expect.objectContaining({ overwrite: true }),
      ),
    );
  });

  it("goes back to the form when the user declines", async () => {
    cloudflare.connectWorker.mockResolvedValue({
      status: "conflict",
      existingRepo: "someone/other-site",
    });
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Connect and Deploy" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.getByTestId("cloudflare-worker-form")).toBeTruthy();
    expect(cloudflare.connectWorker).toHaveBeenCalledTimes(1);
  });

  it("passes on the warning when the first deployment did not start", async () => {
    cloudflare.connectWorker.mockResolvedValue({
      status: "connected",
      connection: CONNECTION,
      warning:
        "The Worker is connected, but the first deployment did not start.",
    });
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Connect and Deploy" }),
    );

    await waitFor(() =>
      expect(showWarning).toHaveBeenCalledWith(
        "The Worker is connected, but the first deployment did not start.",
      ),
    );
  });

  it("says nothing extra when the connection went through cleanly", async () => {
    cloudflare.connectWorker.mockResolvedValue({
      status: "connected",
      connection: CONNECTION,
    });
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Connect and Deploy" }),
    );

    await waitFor(() => expect(cloudflare.connectWorker).toHaveBeenCalled());
    expect(showWarning).not.toHaveBeenCalled();
  });

  it("shows why the setup failed", async () => {
    cloudflare.connectWorker.mockRejectedValue(
      new Error("Could not connect the Worker: simulated"),
    );
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Connect and Deploy" }),
    );

    expect(await screen.findByText(/simulated/)).toBeTruthy();
  });
});

describe("a connected Worker", () => {
  beforeEach(() => {
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({ connections: [CONNECTION] }),
    );
  });

  it("says a folder deploys on changes inside it, not on every sync", async () => {
    renderConnector();

    expect(
      await screen.findByText(
        "Deploys whenever a sync pushes changes inside worker to GitHub.",
      ),
    ).toBeTruthy();
  });

  it("says the app root deploys on any pushed commit", async () => {
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({
        targets: [{ ...TARGET, rootDirectory: "", label: "App root" }],
        connections: [{ ...CONNECTION, rootDirectory: "" }],
      }),
    );
    renderConnector();

    expect(
      await screen.findByText(
        "Deploys whenever a sync pushes new commits to GitHub.",
      ),
    ).toBeTruthy();
  });

  it("shows where it is live and which commit", async () => {
    renderConnector();

    expect(await screen.findByText("Live")).toBeTruthy();
    expect(screen.getByText("abc1234")).toBeTruthy();
    fireEvent.click(screen.getByText(CONNECTION.workerUrl));
    expect(openExternalUrl).toHaveBeenCalledWith(CONNECTION.workerUrl);
    // Connected means no setup questions are asked again.
    expect(cloudflare.checkRepoAccess).not.toHaveBeenCalled();
  });

  it("shows no address for a Worker that is not served at workers.dev", async () => {
    // The route was on when it was connected and has been turned off since.
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({ connections: [CONNECTION] }),
    );
    cloudflare.getDeploymentStatus.mockResolvedValue({
      state: "live",
      commitHash: "abc1234def",
      logTail: [],
      tokenRevoked: false,
      ruleMissing: false,
      ruleDeploys: null,
      workerUrl: null,
    });
    renderConnector();

    await screen.findByText("Live");
    expect(screen.queryByTestId("cloudflare-worker-url")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cloudflare" }));
    expect(openExternalUrl).toHaveBeenCalledWith(CONNECTION.dashboardUrl);
  });

  it("shows an address the Worker gained after it was connected", async () => {
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({ connections: [{ ...CONNECTION, workerUrl: null }] }),
    );
    renderConnector();

    const link = await screen.findByTestId("cloudflare-worker-url");
    expect(link.textContent).toBe(CONNECTION.workerUrl);
  });

  it("shows the end of the log for a failed deployment", async () => {
    cloudflare.getDeploymentStatus.mockResolvedValue({
      state: "failed",
      commitHash: null,
      logTail: ["npm error missing script: build"],
      tokenRevoked: false,
      ruleMissing: false,
    });
    renderConnector();

    expect(await screen.findByText("Deployment failed")).toBeTruthy();
    expect(screen.getByText(/missing script: build/)).toBeTruthy();
  });

  it("warns that syncing no longer deploys when the rule is gone", async () => {
    cloudflare.getDeploymentStatus.mockResolvedValue({
      state: "live",
      commitHash: null,
      logTail: [],
      tokenRevoked: false,
      ruleMissing: true,
    });
    renderConnector();

    const warning = await screen.findByTestId("cloudflare-rule-missing");
    expect(warning.textContent).toMatch(/no longer exists on Cloudflare/);
    // It would contradict the warning.
    expect(screen.queryByText(/Deploys whenever/)).toBeNull();
    // "Live" alone would say everything is fine.
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("warns when the rule deploys something other than what the app syncs", async () => {
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({ connections: [CONNECTION] }),
    );
    cloudflare.getDeploymentStatus.mockResolvedValue({
      state: "live",
      commitHash: "abc1234def",
      logTail: [],
      tokenRevoked: false,
      ruleMissing: false,
      ruleDeploys: "acme/shop (branch main, folder worker)",
    });
    renderConnector();

    const warning = await screen.findByTestId("cloudflare-rule-elsewhere");
    expect(warning.textContent).toContain(
      "acme/shop (branch main, folder worker)",
    );
    // It would be untrue here.
    expect(screen.queryByText(/Deploys whenever/)).toBeNull();
  });

  it("says a new token is needed when the old one was revoked", async () => {
    cloudflare.getDeploymentStatus.mockResolvedValue({
      state: "failed",
      commitHash: null,
      logTail: ["Failed: The build token ... has been deleted or rolled"],
      tokenRevoked: true,
      ruleMissing: false,
    });
    renderConnector();

    const notice = await screen.findByTestId("cloudflare-token-revoked");
    // It outlives a new token until the next deploy, so it speaks of the
    // token last used and says when it goes away.
    expect(notice.textContent).toMatch(/token last used for this deployment/);
    expect(notice.textContent).toMatch(/clears on the next deploy/);
  });

  it("does not show a reconnected folder the status of the connection it replaced", async () => {
    cloudflare.getDeploymentStatus.mockResolvedValue({
      state: "live",
      commitHash: null,
      logTail: [],
      tokenRevoked: false,
      ruleMissing: true,
    });
    cloudflare.disconnect.mockResolvedValue(undefined);
    cloudflare.connectWorker.mockResolvedValue({
      status: "connected",
      connection: CONNECTION,
    });
    renderConnector();
    await screen.findByTestId("cloudflare-rule-missing");

    // Disconnect: the folder goes back to the Worker form.
    cloudflare.getAppStatus.mockResolvedValue(appStatus());
    fireEvent.click(screen.getByRole("button", { name: "Disconnect worker" }));
    await screen.findByTestId("cloudflare-worker-form");

    // Reconnect, moments later. Cloudflare takes a while to answer.
    let answer: (status: unknown) => void = () => {};
    cloudflare.getDeploymentStatus.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({ connections: [CONNECTION] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect and Deploy" }));

    // While it waits, the card must not fall back on the old connection's
    // answer: that is the warning the user just acted on.
    await screen.findByTestId("cloudflare-deployment");
    expect(screen.getByText("Checking deployment...")).toBeTruthy();
    expect(screen.queryByTestId("cloudflare-rule-missing")).toBeNull();

    answer({
      state: "queued",
      commitHash: null,
      logTail: [],
      tokenRevoked: false,
      ruleMissing: false,
    });
    expect(await screen.findByText("Deployment queued")).toBeTruthy();
    expect(screen.queryByTestId("cloudflare-rule-missing")).toBeNull();
  });

  it("stays reachable after its Wrangler config leaves the branch", async () => {
    // The rule is still on Cloudflare, so the way to remove it has to be here.
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({ targets: [], connections: [CONNECTION] }),
    );
    cloudflare.disconnect.mockResolvedValue(undefined);
    renderConnector();

    const warning = await screen.findByTestId("cloudflare-config-missing");
    // Also shown when the branch cannot be read, so it does not claim the
    // config is gone.
    expect(warning.textContent).toMatch(
      /Dyad cannot find a Wrangler config for worker on main\./,
    );
    expect(screen.queryByText("No Cloudflare Worker found")).toBeNull();
    // Cloudflare cannot build it, so the card must not say that it deploys.
    expect(screen.queryByText(/Deploys whenever/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect worker" }));
    await waitFor(() =>
      expect(cloudflare.disconnect).toHaveBeenCalledWith({
        appId: 7,
        rootDirectory: "worker",
      }),
    );
  });

  it("stays reachable when the token can no longer see an account", async () => {
    cloudflare.listAccounts.mockResolvedValue([]);
    renderConnector();

    expect(
      await screen.findByRole("button", { name: "Disconnect worker" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("cloudflare-no-accounts")).toBeNull();
  });

  it("stays reachable when the accounts cannot be listed", async () => {
    // A revoked token fails this call, which is when the card matters most.
    cloudflare.listAccounts.mockRejectedValue(
      new Error("Authentication error"),
    );
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({ connections: [CONNECTION] }),
    );
    renderConnector();

    expect(await screen.findByTestId("cloudflare-deployment")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Disconnect worker" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Authentication error/)).toBeNull();
  });

  it("disconnects the target it is showing", async () => {
    cloudflare.disconnect.mockResolvedValue(undefined);
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect worker" }),
    );

    await waitFor(() =>
      expect(cloudflare.disconnect).toHaveBeenCalledWith({
        appId: 7,
        rootDirectory: "worker",
      }),
    );
  });
});

describe("an app with several Workers", () => {
  const CRON_TARGET = {
    rootDirectory: "cron",
    configPath: "cron/wrangler.toml",
    label: "cron",
    suggestedWorkerName: "shop-cron",
  };

  beforeEach(() => {
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({
        targets: [TARGET, CRON_TARGET],
        connections: [CONNECTION],
      }),
    );
  });

  it("shows every folder and its state at once, not one at a time", async () => {
    renderConnector();

    const list = await screen.findByTestId("cloudflare-target-list");
    expect(list.textContent).toContain("worker");
    expect(list.textContent).toContain("Connected to shop-api");
    expect(list.textContent).toContain("cron");
    expect(list.textContent).toContain("Not connected");
    // Both can be connected; the list says so rather than implying a choice.
    expect(list.textContent).toMatch(/each connected one deploys/);
  });

  it("opens on the first folder, showing its deployment", async () => {
    renderConnector();

    expect(await screen.findByText("Live")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^worker/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("sets up a second folder without touching the first", async () => {
    cloudflare.connectWorker.mockResolvedValue({
      status: "connected",
      connection: { ...CONNECTION, rootDirectory: "cron" },
    });
    renderConnector();

    fireEvent.click(await screen.findByRole("button", { name: /^cron/ }));

    const name = (await screen.findByTestId(
      "cloudflare-worker-name",
    )) as HTMLInputElement;
    expect(name.value).toBe("shop-cron");
    fireEvent.click(screen.getByRole("button", { name: "Connect and Deploy" }));

    await waitFor(() =>
      expect(cloudflare.connectWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          rootDirectory: "cron",
          workerName: "shop-cron",
        }),
      ),
    );
    expect(cloudflare.disconnect).not.toHaveBeenCalled();
    // The first folder is still listed as connected while this one is set up.
    expect(screen.getByTestId("cloudflare-target-list").textContent).toContain(
      "Connected to shop-api",
    );
  });

  it("does not offer a Worker another folder already deploys to", async () => {
    // Both Wrangler configs name the same Worker, which is what copying a
    // Worker folder produces.
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({
        targets: [TARGET, { ...CRON_TARGET, suggestedWorkerName: "shop-api" }],
        connections: [CONNECTION],
      }),
    );
    cloudflare.listWorkers.mockResolvedValue([{ name: "shop-api" }]);
    renderConnector();

    fireEvent.click(await screen.findByRole("button", { name: /^cron/ }));

    // It opens on "create", not on the Worker the first folder is using, and
    // that Worker is the only one in the account, so there is none to pick.
    await screen.findByTestId("cloudflare-worker-name");
    expect(
      (
        screen.getByRole("button", {
          name: "Use existing Worker",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Connect and Deploy",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/Each folder needs its own/)).toBeTruthy();
  });

  it("disconnects only the folder being shown", async () => {
    cloudflare.disconnect.mockResolvedValue(undefined);
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect worker" }),
    );

    await waitFor(() =>
      expect(cloudflare.disconnect).toHaveBeenCalledWith({
        appId: 7,
        rootDirectory: "worker",
      }),
    );
    expect(cloudflare.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not show one folder's failed disconnect under another", async () => {
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({
        targets: [TARGET, CRON_TARGET],
        connections: [
          CONNECTION,
          { ...CONNECTION, rootDirectory: "cron", workerName: "shop-cron" },
        ],
      }),
    );
    cloudflare.disconnect.mockRejectedValue(new Error("Cloudflare refused"));
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Disconnect worker" }),
    );
    expect(await screen.findByText(/Cloudflare refused/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^cron/ }));

    await screen.findByRole("button", { name: "Disconnect cron" });
    expect(screen.queryByText(/Cloudflare refused/)).toBeNull();
  });

  it("keeps showing a folder's deployment when a later status check fails", async () => {
    let calls = 0;
    cloudflare.getAppStatus.mockImplementation(async () => {
      calls += 1;
      // Unsynced, so the tab polls; every poll after the first fails.
      if (calls === 1) return appStatus({ synced: false });
      throw new Error("offline");
    });
    renderConnector();

    expect(await screen.findByText("Sync to GitHub first")).toBeTruthy();
    await waitFor(() => expect(calls).toBeGreaterThan(1), { timeout: 8000 });

    expect(screen.getByText("Sync to GitHub first")).toBeTruthy();
    expect(screen.queryByText("offline")).toBeNull();
  }, 12_000);
});

describe("a folder that lost its config beside one that still has it", () => {
  it("lists both, and sets up only the one that can deploy", async () => {
    cloudflare.getAppStatus.mockResolvedValue(
      appStatus({
        connections: [{ ...CONNECTION, rootDirectory: "old-worker" }],
      }),
    );
    renderConnector();

    const list = await screen.findByTestId("cloudflare-target-list");
    expect(list.textContent).toContain("old-worker");
    expect(list.textContent).toContain("Connected to shop-api, config missing");
    // The deployable folder comes first and opens on its setup form.
    expect(await screen.findByTestId("cloudflare-worker-form")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^old-worker/ }));
    expect(await screen.findByTestId("cloudflare-config-missing")).toBeTruthy();
    expect(screen.queryByTestId("cloudflare-worker-form")).toBeNull();
  });
});

describe("an app with one Worker", () => {
  it("shows no list, since there is nothing to switch between", async () => {
    renderConnector();

    await screen.findByTestId("cloudflare-worker-form");
    expect(screen.queryByTestId("cloudflare-target-list")).toBeNull();
  });
});
