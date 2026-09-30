// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSupabaseFunction,
  captureSupabaseSharedFiles,
  deploySupabaseFunction,
  bulkUpdateFunctions,
  SUPABASE_DEPLOY_REQUEST_TIMEOUT_MS,
} from "./supabase_management_client";
import {
  enqueueSupabaseDeploy,
  resetSupabaseDeployQueuesForTests,
} from "./supabase_deploy_queue";
import { deployAllSupabaseFunctions } from "./supabase_utils";
import { executeCopyFile } from "@/ipc/utils/copy_file_utils";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";

const { findApp, gitAdd } = vi.hoisted(() => ({
  findApp: vi.fn(),
  gitAdd: vi.fn(),
}));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: (value: string) => value }));
vi.mock("@/ipc/utils/git_utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/git_utils")>()),
  gitAdd,
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      apps: { findFirst: findApp },
    },
  },
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    supabase: {
      accessToken: { value: "test-token" },
      expiresIn: 3600,
      tokenTimestamp: Math.floor(Date.now() / 1000),
    },
  }),
  writeSettings: vi.fn(),
}));

describe("captured Supabase deployment inputs", () => {
  let appPath: string;
  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-deploy-snapshot-"));
    findApp.mockResolvedValue({ path: appPath, supabaseProjectId: "project" });
    gitAdd.mockReset();
    for (const name of ["alpha", "beta", "_shared"]) {
      await fs.mkdir(path.join(appPath, "supabase/functions", name), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(appPath, "supabase/functions", name, "index.ts"),
        `original ${name}`,
      );
    }
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSupabaseDeployQueuesForTests();
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("deploys a copied function from its current path after a queued app move", async () => {
    let finishStaging!: () => void;
    gitAdd.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStaging = resolve;
        }),
    );
    await fs.writeFile(path.join(appPath, "source.ts"), "copied after move");
    const uploads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: RequestInit) => {
        const files = (init.body as FormData).getAll("file") as File[];
        uploads.push(
          await files.find((file) => file.name === "alpha/index.ts")!.text(),
        );
        return new Response(JSON.stringify({ slug: "alpha" }), { status: 201 });
      }),
    );
    const copying = executeCopyFile({
      from: "source.ts",
      to: "supabase/functions/alpha/index.ts",
      appId: 7745,
    });
    await vi.waitFor(() => expect(gitAdd).toHaveBeenCalledOnce());
    const moving = appOperationCoordinator.run(
      {
        appId: 7745,
        operation: "move app",
        resources: ["app-path", "repository"],
      },
      async () => {
        const movedPath = `${appPath}-moved`;
        await fs.rename(appPath, movedPath);
        appPath = movedPath;
        findApp.mockResolvedValue({
          path: appPath,
          supabaseProjectId: "project",
        });
      },
    );
    finishStaging();
    const [result] = await Promise.all([copying, moving]);
    expect(result.deployError).toBeUndefined();
    expect(uploads).toEqual(["copied after move"]);
  });

  it("uploads captured function and shared bytes after the source tree is replaced", async () => {
    const sharedFiles = await captureSupabaseSharedFiles(appPath);
    const alpha = await captureSupabaseFunction({
      appPath,
      functionName: "alpha",
      sharedFiles,
    });
    const beta = await captureSupabaseFunction({
      appPath,
      functionName: "beta",
      sharedFiles,
    });
    expect(alpha.files.find((f) => f.relativePath === "_shared/index.ts")).toBe(
      beta.files.find((f) => f.relativePath === "_shared/index.ts"),
    );
    expect(Object.isFrozen(alpha.files)).toBe(true);
    await fs.rm(path.join(appPath, "supabase"), { recursive: true });
    const uploads: Record<string, string>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: RequestInit) => {
        const body = init.body as FormData;
        const files = await Promise.all(
          body.getAll("file").map(async (file) => {
            const entry = file as File;
            return [entry.name, await entry.text()] as const;
          }),
        );
        uploads.push(Object.fromEntries(files));
        return new Response(JSON.stringify({ slug: "alpha" }), { status: 201 });
      }),
    );
    for (const [functionName, snapshot] of [
      ["alpha", alpha],
      ["beta", beta],
    ] as const) {
      await deploySupabaseFunction({
        appPath,
        functionName,
        supabaseProjectId: "project",
        organizationSlug: null,
        snapshot,
        bundleOnly: true,
      });
    }
    expect(uploads[0]).toMatchObject({
      "alpha/index.ts": "original alpha",
      "_shared/index.ts": "original _shared",
    });
    expect(uploads[1]).toMatchObject({
      "beta/index.ts": "original beta",
      "_shared/index.ts": "original _shared",
    });
  });

  it("deploys a newer chat edit after an older bulk snapshot completes", async () => {
    let finishFirstBundle!: () => void;
    const firstBundle = new Promise<Response>((resolve) => {
      finishFirstBundle = () =>
        resolve(
          new Response(JSON.stringify({ slug: "alpha" }), { status: 201 }),
        );
    });
    const uploads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init: RequestInit) => {
        if (init.method === "PUT") return new Response("", { status: 200 });
        const files = (init.body as FormData).getAll("file") as File[];
        const entry = files.find(
          (file) =>
            file.name.endsWith("/index.ts") &&
            !file.name.startsWith("_shared/"),
        )!;
        uploads.push(await entry.text());
        if (entry.name === "alpha/index.ts" && uploads.length <= 2)
          return firstBundle;
        return new Response(
          JSON.stringify({ slug: entry.name.split("/")[0] }),
          { status: 201 },
        );
      }),
    );
    const bulk = deployAllSupabaseFunctions({
      appId: 7744,
      appPath,
      supabaseProjectId: "project",
      supabaseOrganizationSlug: null,
      skipPruneEdgeFunctions: true,
    });
    await vi.waitFor(() => expect(uploads).toHaveLength(2));
    await fs.writeFile(
      path.join(appPath, "supabase/functions/alpha/index.ts"),
      "newer alpha",
    );
    const newer = deploySupabaseFunction({
      appId: 7744,
      appPath,
      functionName: "alpha",
      supabaseProjectId: "project",
      organizationSlug: null,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect([...uploads].sort()).toEqual(["original alpha", "original beta"]);
    } finally {
      finishFirstBundle();
      await Promise.all([bulk, newer]);
    }
    expect(uploads).toEqual(["original alpha", "original beta", "newer alpha"]);
  });

  it("removes cancelled jobs from project admission without waiting for active work", async () => {
    let release!: () => void;
    const active = enqueueSupabaseDeploy(
      "project",
      false,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const operation = vi.fn(async () => {});
    const cancelled = enqueueSupabaseDeploy(
      "project",
      true,
      operation,
      controller.signal,
    );
    const detach = vi.spyOn(controller.signal, "removeEventListener");
    controller.abort(new Error("Stopped"));
    try {
      await expect(cancelled).rejects.toThrow("Stopped");
      expect(operation).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally {
      release();
      await active;
    }
  });

  it("keeps activation excluded until an aborted upload physically settles", async () => {
    const snapshot = await captureSupabaseFunction({
      appPath,
      functionName: "alpha",
    });
    let settle!: () => void;
    const aborted = new Promise<void>((resolve) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init.signal!.addEventListener(
                "abort",
                () => {
                  resolve();
                  settle = () => reject(init.signal!.reason);
                },
                { once: true },
              );
            }),
        ),
      );
    });
    const controller = new AbortController();
    const upload = deploySupabaseFunction({
      appPath,
      functionName: "alpha",
      supabaseProjectId: "project",
      organizationSlug: null,
      snapshot,
      bundleOnly: true,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const activate = vi.fn(async () => {});
    const activation = enqueueSupabaseDeploy("project", false, activate);
    controller.abort(new Error("Stopped"));
    await aborted;
    expect(activate).not.toHaveBeenCalled();
    const rejected = expect(upload).rejects.toThrow("Stopped");
    settle();
    await rejected;
    await activation;
    expect(activate).toHaveBeenCalledOnce();
  });

  it("starts request deadlines after queue admission", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let release!: () => void;
    const active = enqueueSupabaseDeploy(
      "project",
      true,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const activation = bulkUpdateFunctions({
      supabaseProjectId: "project",
      functions: [],
      organizationSlug: null,
    });
    expect(timeout).not.toHaveBeenCalled();
    release();
    await Promise.all([active, activation]);
    expect(timeout).toHaveBeenCalledWith(SUPABASE_DEPLOY_REQUEST_TIMEOUT_MS);
  });

  it("aborts a hung activation when its request deadline expires", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(10));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener(
              "abort",
              () => reject(init.signal!.reason),
              { once: true },
            );
          }),
      ),
    );
    await expect(
      bulkUpdateFunctions({
        supabaseProjectId: "project",
        functions: [],
        organizationSlug: null,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels a rate-limit backoff without sending a retry", async () => {
    const snapshot = await captureSupabaseFunction({
      appPath,
      functionName: "alpha",
    });
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const upload = deploySupabaseFunction({
      appPath,
      functionName: "alpha",
      supabaseProjectId: "project",
      organizationSlug: null,
      snapshot,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort(new Error("Stopped"));
    await expect(upload).rejects.toThrow("Stopped");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
