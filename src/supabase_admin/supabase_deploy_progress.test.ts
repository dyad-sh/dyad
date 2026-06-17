import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deployAllSupabaseFunctions,
  deploySupabaseFunctions,
  type SupabaseDeployProgress,
} from "@/supabase_admin/supabase_utils";
import {
  bulkUpdateFunctions,
  deleteSupabaseFunction,
  deploySupabaseFunction,
  listSupabaseFunctions,
} from "@/supabase_admin/supabase_management_client";

vi.mock("@/supabase_admin/supabase_management_client", async () => {
  const actual = await vi.importActual<
    typeof import("@/supabase_admin/supabase_management_client")
  >("@/supabase_admin/supabase_management_client");

  return {
    ...actual,
    bulkUpdateFunctions: vi.fn(),
    deleteSupabaseFunction: vi.fn(),
    deploySupabaseFunction: vi.fn(),
    listSupabaseFunctions: vi.fn(),
  };
});

async function waitForAssertion(assertion: () => void) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

describe("deployAllSupabaseFunctions progress", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-supabase-"));
    for (const functionName of ["alpha", "beta"]) {
      await fs.mkdir(
        path.join(appPath, "supabase", "functions", functionName),
        {
          recursive: true,
        },
      );
      await fs.writeFile(
        path.join(appPath, "supabase", "functions", functionName, "index.ts"),
        "Deno.serve(() => new Response('ok'));",
      );
    }

    vi.mocked(deploySupabaseFunction).mockImplementation(
      async ({ functionName }) =>
        ({
          slug: functionName,
        }) as any,
    );
    vi.mocked(listSupabaseFunctions).mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("emits finished only after bulk activation completes", async () => {
    const progressEvents: SupabaseDeployProgress[] = [];
    let finishActivation: () => void = () => {};
    vi.mocked(bulkUpdateFunctions).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishActivation = resolve;
        }),
    );

    const deployment = deployAllSupabaseFunctions({
      appPath,
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      skipPruneEdgeFunctions: true,
      onProgress: (progress) => progressEvents.push(progress),
    });

    await waitForAssertion(() => {
      expect(bulkUpdateFunctions).toHaveBeenCalledOnce();
    });

    expect(progressEvents.map((event) => event.phase)).not.toContain(
      "finished",
    );

    finishActivation();
    await expect(deployment).resolves.toEqual([]);

    expect(progressEvents.at(-1)?.phase).toBe("finished");
  });

  it("emits failed instead of finished when bulk activation fails", async () => {
    const progressEvents: SupabaseDeployProgress[] = [];
    vi.mocked(bulkUpdateFunctions).mockRejectedValue(
      new Error("activation down"),
    );

    await expect(
      deployAllSupabaseFunctions({
        appPath,
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: null,
        skipPruneEdgeFunctions: true,
        onProgress: (progress) => progressEvents.push(progress),
      }),
    ).resolves.toEqual(["Failed to bulk update functions: activation down"]);

    expect(progressEvents.map((event) => event.phase)).not.toContain(
      "finished",
    );
    expect(progressEvents.at(-1)?.phase).toBe("failed");
  });

  it("bundles and activates only the requested subset with subset progress totals", async () => {
    const progressEvents: SupabaseDeployProgress[] = [];

    await expect(
      deploySupabaseFunctions({
        appPath,
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: null,
        skipPruneEdgeFunctions: true,
        functionNames: ["alpha"],
        onProgress: (progress) => progressEvents.push(progress),
      }),
    ).resolves.toEqual([]);

    expect(deploySupabaseFunction).toHaveBeenCalledTimes(1);
    expect(deploySupabaseFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "alpha",
        bundleOnly: true,
      }),
    );
    expect(bulkUpdateFunctions).toHaveBeenCalledWith(
      expect.objectContaining({
        functions: [expect.objectContaining({ slug: "alpha" })],
      }),
    );
    expect(progressEvents.every((event) => event.total === 1)).toBe(true);
    expect(progressEvents.at(-1)?.phase).toBe("finished");
  });

  it("prunes against the complete local function set during partial deploys", async () => {
    vi.mocked(listSupabaseFunctions).mockResolvedValue([
      { slug: "alpha" },
      { slug: "beta" },
      { slug: "old-fn" },
    ] as any);

    await expect(
      deploySupabaseFunctions({
        appPath,
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: "org",
        skipPruneEdgeFunctions: false,
        functionNames: ["alpha"],
      }),
    ).resolves.toEqual([]);

    expect(deleteSupabaseFunction).toHaveBeenCalledTimes(1);
    expect(deleteSupabaseFunction).toHaveBeenCalledWith({
      supabaseProjectId: "project-id",
      functionName: "old-fn",
      organizationSlug: "org",
    });
  });

  it("runs pruning without bundling when the requested subset is empty", async () => {
    vi.mocked(listSupabaseFunctions).mockResolvedValue([
      { slug: "alpha" },
      { slug: "old-fn" },
    ] as any);

    await expect(
      deploySupabaseFunctions({
        appPath,
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: "org",
        skipPruneEdgeFunctions: false,
        functionNames: [],
      }),
    ).resolves.toEqual([]);

    expect(deploySupabaseFunction).not.toHaveBeenCalled();
    expect(bulkUpdateFunctions).not.toHaveBeenCalled();
    expect(deleteSupabaseFunction).toHaveBeenCalledWith({
      supabaseProjectId: "project-id",
      functionName: "old-fn",
      organizationSlug: "org",
    });
  });

  it("returns an error when a non-empty requested subset has no valid local functions", async () => {
    await expect(
      deploySupabaseFunctions({
        appPath,
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: null,
        skipPruneEdgeFunctions: false,
        functionNames: ["missing"],
      }),
    ).resolves.toEqual([
      "Requested Supabase functions do not exist locally or are missing index.ts: missing",
    ]);

    expect(deploySupabaseFunction).not.toHaveBeenCalled();
    expect(listSupabaseFunctions).not.toHaveBeenCalled();
  });

  it("does not prune during partial deploys when pruning is skipped", async () => {
    vi.mocked(listSupabaseFunctions).mockResolvedValue([
      { slug: "old-fn" },
    ] as any);

    await expect(
      deploySupabaseFunctions({
        appPath,
        supabaseProjectId: "project-id",
        supabaseOrganizationSlug: null,
        skipPruneEdgeFunctions: true,
        functionNames: ["alpha"],
      }),
    ).resolves.toEqual([]);

    expect(listSupabaseFunctions).not.toHaveBeenCalled();
    expect(deleteSupabaseFunction).not.toHaveBeenCalled();
  });
});
