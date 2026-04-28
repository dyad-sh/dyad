import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deployAllSupabaseFunctions,
  type SupabaseDeployProgress,
} from "@/supabase_admin/supabase_utils";
import {
  bulkUpdateFunctions,
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
});
