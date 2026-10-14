import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
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
  createDeployment: vi.fn(),
  coolifyDeploy: vi.fn(),
  coolifySnapshot: { type: "idle" } as Record<string, unknown>,
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
    vercel: {
      syncNeonConfig: h.sync,
      getDeployments: h.deployments,
      createDeployment: h.createDeployment,
    },
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
vi.mock("@/hooks/useCoolifyDeploy", () => ({
  useCoolifyDeploy: () => ({
    snapshot: h.coolifySnapshot,
    deploy: { mutate: h.coolifyDeploy, isError: false, error: null },
  }),
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
    { wrapper: StrictMode },
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
  const confirm = within(
    await screen.findByRole("region", {
      name: "integrations.migration.migrateToProduction",
    }),
  ).getByRole("button", { name: "integrations.migration.migrateToProduction" });
  fireEvent.click(confirm);
}
async function connectVercel() {
  await act(async () => {
    h.app = { ...h.app, vercelProjectId: "vercel-1" };
    client.setQueryData(queryKeys.apps.detail({ appId: 1 }), h.app);
  });
}
async function refetchDeployments() {
  await act(() =>
    client.refetchQueries({
      queryKey: queryKeys.vercel.deployments({ appId: 1 }),
    }),
  );
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
  h.createDeployment.mockResolvedValue({ uid: "new" });
  h.deployments.mockResolvedValue([
    { uid: "new", readyState: "READY", createdAt: 2 },
    { uid: "old", readyState: "READY", createdAt: 1 },
  ]);
  h.coolifySnapshot = { type: "idle" };
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

describe.each([false, true])(
  "inline migration preview (hosted: %s)",
  (hosted) => {
    it("keeps loading, errors, review, and confirmation in the deployment dialog", async () => {
      if (hosted) h.app.vercelProjectId = "vercel-1";
      let rejectPreview!: (error: Error) => void;
      h.preview.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectPreview = reject;
          }),
      );
      mount();
      const dialog = await screen.findByRole("dialog", { name: "Deploy Demo" });
      if (hosted) {
        const review = await screen.findByRole("button", {
          name: "Review and deploy",
        });
        await waitFor(() =>
          expect((review as HTMLButtonElement).disabled).toBe(false),
        );
        fireEvent.click(review);
      } else {
        fireEvent.click(
          await screen.findByRole("button", { name: "Production database" }),
        );
        fireEvent.click(button("integrations.migration.migrateToProduction"));
      }

      const card = await within(dialog).findByRole("region", {
        name: "integrations.migration.preview.title",
      });
      await within(card).findByText("integrations.migration.preview.loading");
      expect(document.activeElement).toBe(within(card).getByRole("heading"));
      expect(screen.getAllByRole("dialog")).toEqual([dialog]);
      expect(
        within(dialog).queryByRole("button", {
          name: "integrations.migration.computingMigrationPlan",
        }),
      ).toBeNull();
      expect(h.migrate).not.toHaveBeenCalled();
      expect(h.dispatch).not.toHaveBeenCalled();

      await act(async () => rejectPreview(new Error("Could not read schemas")));
      await within(card).findByText(
        "integrations.migration.preview.loadingError",
      );
      expect(screen.getAllByRole("dialog")).toEqual([dialog]);
      fireEvent.click(
        within(card).getByRole("button", {
          name: "integrations.migration.preview.retry",
        }),
      );
      await within(card).findByText(plan.statements[0]);
      expect(screen.getAllByRole("dialog")).toEqual([dialog]);

      fireEvent.click(
        within(card).getByRole("button", {
          name: "integrations.migration.preview.continue",
        }),
      );
      const confirm = await within(dialog).findByRole("region", {
        name: "integrations.migration.migrateToProduction",
      });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getAllByRole("dialog")).toEqual([dialog]);
      expect(document.activeElement).toBe(within(confirm).getByRole("heading"));
      expect(
        within(confirm).getByText(
          "integrations.migration.confirmDescriptionWithBranches",
        ),
      ).toBeTruthy();
      expect(h.migrate).not.toHaveBeenCalled();
      fireEvent.click(
        within(confirm).getByRole("button", {
          name: "integrations.migration.backToReview",
        }),
      );
      await within(dialog).findByText(plan.statements[0]);
      expect(document.activeElement).toBe(
        within(dialog).getByRole("heading", {
          name: "integrations.migration.preview.title",
        }),
      );
      expect(screen.getAllByRole("dialog")).toEqual([dialog]);
      expect(h.preview).toHaveBeenCalledTimes(2);

      fireEvent.click(button("integrations.migration.preview.continue"));
      fireEvent.click(button("integrations.migration.cancel"));
      expect(
        screen.queryByRole("region", {
          name: "integrations.migration.migrateToProduction",
        }),
      ).toBeNull();
      expect(document.activeElement).toBe(
        button("integrations.migration.migrateToProduction"),
      );
      expect(screen.getAllByRole("dialog")).toEqual([dialog]);
      expect(h.migrate).not.toHaveBeenCalled();
      expect(h.dispatch).not.toHaveBeenCalled();
      if (!hosted) expect(button("Continue to GitHub").disabled).toBe(true);
    });

    it.each([false, true])(
      "applies the reviewed plan only after inline confirmation (data loss: %s)",
      async (hasDataLoss) => {
        if (hosted) h.app.vercelProjectId = "vercel-1";
        h.preview.mockResolvedValue({ ...plan, hasDataLoss });
        let finishMigration!: (result: { success: boolean }) => void;
        h.migrate.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishMigration = resolve;
            }),
        );
        mount();
        if (hosted) {
          const review = await screen.findByRole("button", {
            name: "Review and deploy",
          });
          await waitFor(() =>
            expect((review as HTMLButtonElement).disabled).toBe(false),
          );
          fireEvent.click(review);
        } else {
          fireEvent.click(
            await screen.findByRole("button", { name: "Production database" }),
          );
          fireEvent.click(button("integrations.migration.migrateToProduction"));
        }
        await screen.findByText(plan.statements[0]);
        fireEvent.click(
          button(
            hasDataLoss
              ? "integrations.migration.preview.continueWithDataLoss"
              : "integrations.migration.preview.continue",
          ),
        );
        const dialog = screen.getByRole("dialog", { name: "Deploy Demo" });
        const confirm = within(dialog).getByRole("region", {
          name: "integrations.migration.migrateToProduction",
        });
        expect(screen.queryByRole("alertdialog")).toBeNull();
        expect(
          Boolean(
            within(confirm).queryByText(
              "integrations.migration.confirmDestructiveWarning",
            ),
          ),
        ).toBe(hasDataLoss);
        expect(h.migrate).not.toHaveBeenCalled();
        expect(h.dispatch).not.toHaveBeenCalled();
        fireEvent.click(
          within(confirm).getByRole("button", {
            name: hasDataLoss
              ? "integrations.migration.migrateToProductionDestructive"
              : "integrations.migration.migrateToProduction",
          }),
        );
        await waitFor(() =>
          expect(h.migrate).toHaveBeenCalledExactlyOnceWith({
            appId: 1,
            migrationId: "plan-1",
          }),
        );
        expect(button("integrations.migration.migrating").disabled).toBe(true);
        expect(h.dispatch).not.toHaveBeenCalled();
        if (!hosted) expect(button("Continue to GitHub").disabled).toBe(true);

        await act(async () => finishMigration({ success: true }));
        if (hosted)
          await waitFor(() =>
            expect(h.dispatch).toHaveBeenCalledWith({
              type: "OP_REQUESTED",
              op: { type: "push", mode: "normal" },
            }),
          );
        else {
          await screen.findByText(
            "Migration applied successfully. You can continue.",
          );
          expect(button("Continue to GitHub").disabled).toBe(false);
        }
      },
    );
  },
);

describe("first deployment", () => {
  it.each([false, true])(
    "settles an automatic Vercel deployment when the project is connected before the step mounts (Neon=%s)",
    async (withNeon) => {
      h.app.neonActiveBranchId = "prod";
      if (!withNeon) h.app.neonProjectId = null;
      mount();
      await continueDatabase();
      await connectVercel();
      fireEvent.click(button("Continue to deployment"));

      await screen.findByText(
        withNeon
          ? "Deployment verified and environment variables configured."
          : "Deployment verified.",
      );
      expect(
        screen.queryByText("Configuring Vercel environment variables…"),
      ).toBeNull();
      expect(screen.queryByText("Starting a Vercel deployment…")).toBeNull();
      expect(h.createDeployment).toHaveBeenCalledOnce();
      expect(h.sync).toHaveBeenCalledTimes(withNeon ? 1 : 0);
    },
  );

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
    await screen.findByText(
      "Migration applied successfully. You can continue.",
    );
    expect(screen.queryByText(/No schema changes needed/)).toBeNull();
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
    expect(screen.queryByText(/Migration applied successfully/)).toBeNull();
    expect(screen.queryByText(/No schema changes needed/)).toBeNull();
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

  it("reports no schema changes for an empty migration plan without applying SQL", async () => {
    h.preview.mockResolvedValue({ ...plan, statements: [] });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Production database" }),
    );
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    await screen.findByText("No schema changes needed. You can continue.");
    expect(screen.queryByText(/Migration applied successfully/)).toBeNull();
    await continueDatabase();
    expect(h.migrate).not.toHaveBeenCalled();
  });

  it("reports no schema changes when the migration returns no changes", async () => {
    h.migrate.mockResolvedValue({ success: true, noChanges: true });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Production database" }),
    );
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    await approveMigration();
    await screen.findByText("No schema changes needed. You can continue.");
    expect(screen.queryByText(/Migration applied successfully/)).toBeNull();
    await continueDatabase();
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
            resolve([{ uid: "new", readyState: "READY", createdAt: 2 }]);
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

  it("builds again after env setup and ignores an older READY deployment", async () => {
    h.deployments.mockResolvedValue([
      { uid: "old", readyState: "READY", createdAt: 1 },
    ]);
    await reachDeployment();
    await connectVercel();
    await screen.findByText("Building on Vercel…");
    expect(h.createDeployment).toHaveBeenCalledWith({ appId: 1 });
    expect(h.sync.mock.invocationCallOrder[0]).toBeLessThan(
      h.createDeployment.mock.invocationCallOrder[0],
    );
    expect(screen.queryByText(/Deployment verified/)).toBeNull();
    h.deployments.mockResolvedValue([
      { uid: "new", readyState: "BUILDING", createdAt: 2 },
      { uid: "old", readyState: "READY", createdAt: 1 },
    ]);
    await refetchDeployments();
    expect(screen.queryByText(/Deployment verified/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    h.deployments.mockResolvedValue([
      { uid: "new", readyState: "READY", createdAt: 2 },
      { uid: "old", readyState: "READY", createdAt: 1 },
    ]);
    await refetchDeployments();
    await screen.findByText(
      "Deployment verified and environment variables configured.",
    );
  });

  it("reports a failed Vercel build and retries it", async () => {
    h.deployments.mockResolvedValue([
      { uid: "new", readyState: "ERROR", createdAt: 2 },
    ]);
    await reachDeployment();
    await connectVercel();
    await screen.findByText(/The Vercel deployment did not finish/);
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    h.createDeployment.mockResolvedValueOnce({ uid: "retry" });
    h.deployments.mockResolvedValue([
      { uid: "retry", readyState: "READY", createdAt: 3 },
      { uid: "new", readyState: "ERROR", createdAt: 2 },
    ]);
    fireEvent.click(button("Retry deployment"));
    await screen.findByText(
      "Deployment verified and environment variables configured.",
    );
    expect(h.createDeployment).toHaveBeenCalledTimes(2);
    expect(h.sync).toHaveBeenCalledOnce();
  });

  it("builds without env setup for an app without a database", async () => {
    h.app.neonProjectId = null;
    mount();
    await continueDatabase();
    fireEvent.click(button("Continue to deployment"));
    await screen.findByText("Vercel setup controls");
    await connectVercel();
    await screen.findByText("Deployment verified.");
    expect(h.sync).not.toHaveBeenCalled();
    expect(h.createDeployment).toHaveBeenCalledWith({ appId: 1 });
  });

  it("keeps the migration review mounted while database branches refetch", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Production database" }),
    );
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    await screen.findByText(plan.statements[0]);
    let finishRefetch!: (value: unknown) => void;
    h.getProject.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefetch = resolve;
        }),
    );
    let refetch!: Promise<void>;
    act(() => {
      refetch = client.refetchQueries({
        queryKey: queryKeys.neon.project({ appId: 1 }),
      });
    });
    await waitFor(() =>
      expect(
        client.isFetching({ queryKey: queryKeys.neon.project({ appId: 1 }) }),
      ).toBe(1),
    );
    expect(screen.queryByText("Checking database branches…")).toBeNull();
    expect(screen.getByText(plan.statements[0])).toBeTruthy();
    await act(async () => {
      finishRefetch({
        branches: [
          { branchId: "prod", type: "production" },
          { branchId: "dev", type: "development" },
        ],
      });
      await refetch;
    });
    await approveMigration();
    await continueDatabase();
    expect(h.migrate).toHaveBeenCalledOnce();
  });

  it("does not verify an empty plan that finishes loading after the review was cancelled", async () => {
    let finishPreview!: (value: unknown) => void;
    h.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPreview = resolve;
        }),
    );
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Production database" }),
    );
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "integrations.migration.preview.cancel",
      }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.queryByRole("region", {
        name: "integrations.migration.preview.title",
      }),
    ).toBeNull();
    expect(document.activeElement).toBe(
      button("integrations.migration.migrateToProduction"),
    );
    await act(async () => finishPreview({ ...plan, statements: [] }));
    expect(screen.queryByText(/No schema changes needed/)).toBeNull();
    expect(screen.queryByText(/Migration applied successfully/)).toBeNull();
    expect(button("Continue to GitHub").disabled).toBe(true);
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
    expect(screen.queryByText("Pushing latest code to GitHub…")).toBeNull();
    expect(
      h.dispatch.mock.calls.filter(([event]) => event.type === "OP_REQUESTED"),
    ).toHaveLength(1);
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

  it("ends the push spinner on failure and allows one explicit retry", async () => {
    h.app.neonActiveBranchId = "prod";
    let rejectPush!: (error: Error) => void;
    h.dispatch.mockImplementation(async (event) => {
      if (event.type === "OP_REQUESTED") {
        return new Promise((_resolve, reject) => {
          rejectPush = reject;
        });
      }
      return { kind: "applied" };
    });
    const view = mount();
    const confirm = await screen.findByRole("button", {
      name: "Review and deploy",
    });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    await screen.findByText("Pushing latest code to GitHub…");
    await waitFor(() => expect(rejectPush).toBeTypeOf("function"));

    await act(async () => rejectPush(new Error("Could not start GitHub push")));
    await screen.findByText("Could not start GitHub push");
    expect(screen.queryByText("Pushing latest code to GitHub…")).toBeNull();
    expect(
      h.dispatch.mock.calls.filter(([event]) => event.type === "OP_REQUESTED"),
    ).toHaveLength(1);

    h.dispatch.mockResolvedValue({ kind: "applied" });
    fireEvent.click(button("Retry deployment push"));
    await waitFor(() =>
      expect(
        h.dispatch.mock.calls.filter(
          ([event]) => event.type === "OP_REQUESTED",
        ),
      ).toHaveLength(2),
    );
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
    expect(screen.queryByText("Pushing latest code to GitHub…")).toBeNull();
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

  it("verifies GitHub before reviewing or applying a migration", async () => {
    h.verify.mockRejectedValueOnce(
      new Error("Reconnect your GitHub account to continue."),
    );
    mount();
    const confirm = await screen.findByRole("button", {
      name: "Review and deploy",
    });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(confirm);
    await screen.findByText("Reconnect your GitHub account to continue.");
    expect(screen.getByText("GitHub setup controls")).toBeTruthy();
    expect(h.preview).not.toHaveBeenCalled();
    fireEvent.click(button("Review and deploy"));
    await screen.findByText(plan.statements[0]);
    expect(h.verify).toHaveBeenNthCalledWith(2, { appId: 1 });
    expect(h.verify.mock.invocationCallOrder[1]).toBeLessThan(
      h.preview.mock.invocationCallOrder[0],
    );
  });
});

describe("already hosted on Coolify", () => {
  beforeEach(() => {
    h.app.neonActiveBranchId = "prod";
    h.app.deploymentProvidersInUse = {
      vercel: false,
      cloudflare: false,
      coolify: true,
    };
  });

  async function pushAndVerify() {
    const view = mount();
    const rerender = () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <DeployDialog appId={1} onClose={onClose} />
        </QueryClientProvider>,
      );
    const confirm = await screen.findByRole("button", {
      name: "Review and deploy",
    });
    await waitFor(() =>
      expect((confirm as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByText(/Start a deployment on your Coolify/)).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith({
        type: "OP_REQUESTED",
        op: { type: "push", mode: "normal" },
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
    rerender();
    await screen.findByText("Latest code verified on GitHub.");
    return rerender;
  }
  const running = (startedAt: number) => ({
    type: "running",
    appId: 1,
    startedAt,
    stage: "building",
    log: "",
    deploymentUuid: null,
    invocationRef: { kind: "coolify-deploy", entityKey: 1, operationId: "op" },
  });
  const succeeded = (finishedAt: number) => ({
    type: "succeeded",
    appId: 1,
    log: "",
    url: null,
    finishedAt,
  });

  it("starts a Coolify deployment after the push and finishes only when it succeeds", async () => {
    const rerender = await pushAndVerify();
    expect(screen.queryByText(/Your hosting provider will build/)).toBeNull();
    expect(h.coolifyDeploy).toHaveBeenCalledOnce();
    expect(screen.getByText("Deploying to Coolify…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    h.coolifySnapshot = running(Date.now());
    rerender();
    h.coolifySnapshot = {
      type: "failed",
      appId: 1,
      log: "",
      error: "Coolify build failed",
      finishedAt: Date.now(),
      deploymentUuid: null,
    };
    rerender();
    await screen.findByText("Coolify build failed");
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    fireEvent.click(button("Retry Coolify deployment"));
    expect(h.coolifyDeploy).toHaveBeenCalledTimes(2);
    await screen.findByText("Deploying to Coolify…");
    h.coolifySnapshot = running(Date.now());
    rerender();
    h.coolifySnapshot = succeeded(Date.now());
    rerender();
    await screen.findByText("Coolify deployment finished.");
    fireEvent.click(button("Finish"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks again once a deployment that was already running ends", async () => {
    h.coolifySnapshot = running(Date.now() - 60_000);
    const rerender = await pushAndVerify();
    expect(h.coolifyDeploy).toHaveBeenCalledOnce();
    h.coolifySnapshot = succeeded(Date.now() + 1);
    rerender();
    await waitFor(() => expect(h.coolifyDeploy).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Coolify deployment finished.")).toBeNull();
    h.coolifySnapshot = running(Date.now());
    rerender();
    h.coolifySnapshot = succeeded(Date.now());
    rerender();
    await screen.findByText("Coolify deployment finished.");
    expect(h.coolifyDeploy).toHaveBeenCalledTimes(2);
  });
});
