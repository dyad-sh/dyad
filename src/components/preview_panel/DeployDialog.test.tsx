import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "@/ipc/types";
import type { GithubOpsProjection } from "@/github_ops/projection";
import { projectGithubOps } from "@/github_ops/projection";

const h = vi.hoisted(() => ({
  app: {} as App,
  cloudflare: false,
  projection: {} as GithubOpsProjection,
  getProject: vi.fn(),
  setBranch: vi.fn(),
  preview: vi.fn(),
  migrate: vi.fn(),
  verify: vi.fn(),
  dispatch: vi.fn(),
  sync: vi.fn(),
  deployments: vi.fn(),
  files: vi.fn(),
  commit: vi.fn(),
  cfStatus: vi.fn(),
  cfDeployment: vi.fn(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    app: { getApp: vi.fn(async () => h.app) },
    neon: {
      getProject: h.getProject,
      setSelectedDatabaseBranchType: h.setBranch,
    },
    migration: { preview: h.preview, migrate: h.migrate },
    github: { verifyConnection: h.verify },
    git: { getUncommittedFiles: h.files, commitChanges: h.commit },
    vercel: { syncNeonConfig: h.sync, getDeployments: h.deployments },
    cloudflare: {
      getAppStatus: h.cfStatus,
      getDeploymentStatus: h.cfDeployment,
    },
  },
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enableCloudflareDeployment: h.cloudflare },
  }),
}));
vi.mock("@/hooks/useNeon", () => ({
  useNeon: () => ({
    branches: [
      { branchId: "prod", branchName: "main", type: "production" },
      { branchId: "dev", branchName: "development", type: "development" },
    ],
  }),
}));
vi.mock("@/github_ops/useGithubOps", () => ({
  useGithubOps: () => ({
    projection: h.projection,
    connection: "ready",
    dispatch: h.dispatch,
  }),
  isAppliedGithubOpsReceipt: (receipt: { kind: string }) =>
    receipt?.kind === "applied",
}));
vi.mock("@/components/GitHubConnector", () => ({
  GitHubConnector: () => <div>GitHub setup controls</div>,
}));
vi.mock("@/components/VercelConnector", () => ({
  VercelConnector: () => <div>Vercel setup controls</div>,
}));
vi.mock("@/components/CloudflareConnector", () => ({
  CloudflareConnector: () => <div>Cloudflare setup controls</div>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { DeployDialog } from "./DeployDialog";
import { queryKeys } from "@/lib/queryKeys";
const plan = {
  migrationId: "plan-1",
  statements: ["CREATE TABLE tasks (id integer);"],
  hasDataLoss: false,
  warningReasons: [],
  destructiveStatements: [],
};
let client: QueryClient;
let onClose: ReturnType<typeof vi.fn>;
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <DeployDialog appId={1} onClose={onClose} />
    </QueryClientProvider>,
  );
}
function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}
async function continueDatabase() {
  const next = await screen.findByRole("button", {
    name: "Continue to GitHub",
  });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(next);
  await screen.findByText("Step 2 — GitHub repository");
}
async function reachDeployment() {
  h.app.neonActiveBranchId = "prod";
  mount();
  await continueDatabase();
  fireEvent.click(button("Continue to deployment"));
  await screen.findByText("Vercel setup controls");
}
async function approveMigration() {
  await screen.findByText(plan.statements[0]);
  fireEvent.click(button("integrations.migration.preview.continue"));
  const confirm = screen
    .getAllByRole("button", {
      name: "integrations.migration.migrateToProduction",
    })
    .at(-1)!;
  fireEvent.click(confirm);
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  onClose = vi.fn();
  h.app = {
    id: 1,
    name: "Demo",
    neonProjectId: "neon",
    neonActiveBranchId: "dev",
    neonDevelopmentBranchId: "dev",
    selectedDatabaseBranchType: null,
    githubOrg: "acme",
    githubRepo: "demo",
    githubBranch: "main",
    vercelProjectId: null,
    deploymentProvidersInUse: {
      vercel: false,
      cloudflare: false,
      coolify: false,
    },
  } as App;
  h.cloudflare = false;
  h.projection = projectGithubOps({ type: "idle", banner: null });
  h.getProject.mockResolvedValue({
    branches: [
      { branchId: "prod", type: "production" },
      { branchId: "dev", type: "development" },
    ],
  });
  h.setBranch.mockImplementation(async ({ branchType }) => {
    h.app = { ...h.app, selectedDatabaseBranchType: branchType };
  });
  h.preview.mockResolvedValue(plan);
  h.migrate.mockResolvedValue({ success: true });
  h.verify.mockResolvedValue({ owner: "acme", repo: "demo", branch: "main" });
  h.dispatch.mockResolvedValue({ kind: "applied" });
  h.files.mockResolvedValue([]);
  h.commit.mockResolvedValue("commit-sha");
  h.sync.mockResolvedValue({ envPushed: true, domainsAdded: [], skipped: [] });
  h.deployments.mockResolvedValue([
    { uid: "d1", readyState: "READY", createdAt: 1 },
  ]);
  h.cfStatus.mockResolvedValue({
    connections: [],
    synced: true,
    targets: [],
    branch: "main",
  });
  h.cfDeployment.mockResolvedValue({
    state: "live",
    ruleMissing: false,
    ruleDeploys: null,
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe("first deployment", () => {
  it("requires a choice and successful migration, replaces each step, and verifies GitHub before deployment", async () => {
    mount();
    await screen.findByText("Production database");
    expect(button("Continue to GitHub").disabled).toBe(true);
    expect(screen.queryByText("GitHub setup controls")).toBeNull();
    expect(screen.queryByText("Vercel setup controls")).toBeNull();
    fireEvent.click(button("Production database"));
    expect(button("Continue to GitHub").disabled).toBe(true);
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    await approveMigration();
    await continueDatabase();
    expect(h.migrate).toHaveBeenCalledWith({ appId: 1, migrationId: "plan-1" });
    expect(screen.queryByText("Production database")).toBeNull();
    h.verify.mockRejectedValueOnce(new Error("Repository is missing"));
    fireEvent.click(button("Continue to deployment"));
    await screen.findByText("Repository is missing");
    expect(screen.queryByText("Vercel setup controls")).toBeNull();
    fireEvent.click(button("Continue to deployment"));
    await screen.findByText("Vercel setup controls");
    expect(h.verify).toHaveBeenLastCalledWith({
      appId: 1,
      requireSynced: true,
    });
    expect(screen.queryByText("GitHub setup controls")).toBeNull();
    expect(screen.queryByText("Cloudflare")).toBeNull();
  });

  it("does not unlock GitHub after a failed migration or a cancelled review", async () => {
    h.migrate.mockRejectedValue(new Error("Migration failed"));
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Production database" }),
    );
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    await screen.findByText(plan.statements[0]);
    fireEvent.click(button("integrations.migration.preview.cancel"));
    expect(button("Continue to GitHub").disabled).toBe(true);
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    await approveMigration();
    await screen.findByText("Migration failed");
    expect(button("Continue to GitHub").disabled).toBe(true);
    expect(screen.queryByText("GitHub setup controls")).toBeNull();
  });

  it("allows the development database without migration and persists that choice", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Development database" }),
    );
    await continueDatabase();
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.setBranch).toHaveBeenCalledWith({
      appId: 1,
      branchType: "development",
    });
  });

  it("skips migration on main and corrects a stale development deployment choice", async () => {
    h.app.neonActiveBranchId = "prod";
    h.app.selectedDatabaseBranchType = "development";
    mount();
    await continueDatabase();
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.setBranch).toHaveBeenCalledWith({
      appId: 1,
      branchType: "production",
    });
  });

  it("blocks database errors and failed persistence", async () => {
    h.getProject.mockRejectedValueOnce(new Error("Neon unavailable"));
    mount();
    await screen.findByText("Neon unavailable");
    expect(button("Continue to GitHub").disabled).toBe(true);
    fireEvent.click(button("Retry database check"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Development database" }),
    );
    h.setBranch.mockRejectedValueOnce(
      new Error("Selection could not be saved"),
    );
    fireEvent.click(button("Continue to GitHub"));
    await screen.findByText("Selection could not be saved");
    expect(screen.queryByText("GitHub setup controls")).toBeNull();
  });

  it("accepts a verified empty migration plan without applying SQL", async () => {
    h.preview.mockResolvedValue({ ...plan, statements: [] });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Production database" }),
    );
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    await continueDatabase();
    expect(h.migrate).not.toHaveBeenCalled();
  });

  it("automatically configures Vercel after connection and blocks success until env setup succeeds", async () => {
    await reachDeployment();
    h.sync.mockResolvedValueOnce({
      envPushed: false,
      warning: "Environment setup failed",
    });
    await act(async () => {
      h.app = { ...h.app, vercelProjectId: "vercel-1" };
      client.setQueryData(queryKeys.apps.detail({ appId: 1 }), h.app);
    });
    await screen.findByText("Environment setup failed");
    expect(screen.queryByText(/Deployment verified/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    expect(h.sync).toHaveBeenCalledWith({ appId: 1, branchType: "production" });
    fireEvent.click(button("Retry environment setup"));
    await screen.findByText(
      "Deployment verified and environment variables configured.",
    );
    expect(screen.queryByText(/Neon Auth redirect allowlist/)).toBeNull();
    // Connecting during setup never switches to the already-hosted flow.
    expect(screen.queryByText("Review and deploy")).toBeNull();
    fireEvent.click(button("Finish"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers Cloudflare only when enabled and shows setup notes after a deployment is connected", async () => {
    h.cloudflare = true;
    await reachDeployment();
    fireEvent.click(button("Cloudflare"));
    await screen.findByText("Cloudflare setup controls");
    expect(screen.queryByText(/find them in the Publish/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    await act(async () => {
      client.setQueryData(queryKeys.cloudflare.appStatus({ appId: 1 }), {
        connections: [{ rootDirectory: "" }],
        synced: true,
      });
    });
    await screen.findByText(/find them in the Publish/);
    await screen.findByText("Cloudflare deployment verified.");
    expect(screen.getByText(/Neon Auth redirect allowlist/)).toBeTruthy();
    expect(h.sync).not.toHaveBeenCalled();
    fireEvent.click(button("Finish"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the success message and Finish button visible during background deployment checks", async () => {
    await reachDeployment();
    await act(async () => {
      h.app = { ...h.app, vercelProjectId: "vercel-1" };
      client.setQueryData(queryKeys.apps.detail({ appId: 1 }), h.app);
    });
    const successMessage =
      "Deployment verified and environment variables configured.";
    await screen.findByText(successMessage);
    const finish = button("Finish");
    let completeRefresh!: () => void;
    h.deployments.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeRefresh = () =>
            resolve([{ uid: "d1", readyState: "READY", createdAt: 1 }]);
        }),
    );
    let refresh!: Promise<void>;
    act(() => {
      refresh = client.refetchQueries({
        queryKey: queryKeys.vercel.deployments({ appId: 1 }),
      });
    });
    await waitFor(() =>
      expect(
        client.isFetching({
          queryKey: queryKeys.vercel.deployments({ appId: 1 }),
        }),
      ).toBe(1),
    );
    expect(screen.getByText(successMessage)).toBeTruthy();
    expect(button("Finish")).toBe(finish);
    await act(async () => {
      completeRefresh();
      await refresh;
    });
    expect(screen.getByText(successMessage)).toBeTruthy();
    expect(button("Finish")).toBe(finish);
  });
});

describe("already hosted", () => {
  beforeEach(() => {
    h.app.vercelProjectId = "vercel-1";
  });

  it("waits for confirmation, review, and migration success before pushing, and verifies push completion", async () => {
    const view = mount();
    const confirm = await screen.findByRole("button", {
      name: "Review and deploy",
    });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await screen.findByText(plan.statements[0]);
    expect(h.dispatch).not.toHaveBeenCalled();
    await approveMigration();
    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith({
        type: "OP_REQUESTED",
        op: { type: "push", mode: "normal" },
      }),
    );
    expect(h.migrate.mock.invocationCallOrder[0]).toBeLessThan(
      h.dispatch.mock.invocationCallOrder[0],
    );
    expect(screen.queryByText(/Latest code verified/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    h.projection = projectGithubOps({
      type: "idle",
      banner: {
        kind: "success",
        completedOperation: "push",
        message: "Pushed",
      },
    });
    view.rerender(
      <QueryClientProvider client={client}>
        <DeployDialog appId={1} onClose={onClose} />
      </QueryClientProvider>,
    );
    await screen.findByText(/Latest code verified on GitHub/);
    expect(h.verify).toHaveBeenLastCalledWith({
      appId: 1,
      requireSynced: true,
    });
    fireEvent.click(button("Finish"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("skips an empty migration and commits pending files before pushing", async () => {
    h.preview.mockResolvedValue({ ...plan, statements: [] });
    h.files.mockResolvedValue([{ path: "index.ts", status: "modified" }]);
    mount();
    const confirm = await screen.findByRole("button", {
      name: "Review and deploy",
    });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith({
        type: "OP_REQUESTED",
        op: { type: "push", mode: "normal" },
      }),
    );
    expect(h.migrate).not.toHaveBeenCalled();
    expect(h.commit).toHaveBeenCalledOnce();
    expect(h.commit.mock.invocationCallOrder[0]).toBeLessThan(
      h.dispatch.mock.invocationCallOrder[0],
    );
  });

  it("keeps the verified result after the GitHub success banner disappears", async () => {
    h.app.neonActiveBranchId = "prod";
    const view = mount();
    const confirm = await screen.findByRole("button", {
      name: "Review and deploy",
    });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith({
        type: "OP_REQUESTED",
        op: { type: "push", mode: "normal" },
      }),
    );
    let finishVerification!: () => void;
    h.verify.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishVerification = resolve;
        }),
    );
    h.projection = projectGithubOps({
      type: "idle",
      banner: {
        kind: "success",
        completedOperation: "push",
        message: "Pushed",
      },
    });
    const rerender = () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <DeployDialog appId={1} onClose={onClose} />
        </QueryClientProvider>,
      );
    rerender();
    await screen.findByText("Verifying the latest code on GitHub…");
    h.projection = projectGithubOps({ type: "idle", banner: null });
    rerender();
    await act(async () => finishVerification());
    await screen.findByText(/Latest code verified on GitHub/);
  });

  it.each(["main", "development"])(
    "skips migrations for a hosted app using %s",
    async (kind) => {
      if (kind === "main") h.app.neonActiveBranchId = "prod";
      else h.app.selectedDatabaseBranchType = "development";
      mount();
      const confirm = await screen.findByRole("button", {
        name: "Review and deploy",
      });
      await waitFor(() =>
        expect((confirm as HTMLButtonElement).disabled).toBe(false),
      );
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(h.dispatch).toHaveBeenCalledWith({
          type: "OP_REQUESTED",
          op: { type: "push", mode: "normal" },
        }),
      );
      expect(h.preview).not.toHaveBeenCalled();
    },
  );

  it("does not push when migration fails", async () => {
    h.migrate.mockRejectedValue(new Error("Migration failed"));
    mount();
    const confirm = await screen.findByRole("button", {
      name: "Review and deploy",
    });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    await approveMigration();
    await screen.findByText("Migration failed");
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
