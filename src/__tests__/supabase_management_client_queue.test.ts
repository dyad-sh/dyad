import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkUpdateFunctions } from "@/supabase_admin/supabase_management_client";
import {
  enqueueSupabaseDeploy,
  resetSupabaseDeployQueuesForTests,
} from "@/supabase_admin/supabase_deploy_queue";

vi.mock("../main/settings", () => ({
  readSettings: vi.fn(() => ({
    supabase: {
      accessToken: { value: "test-token" },
      expiresIn: 60 * 60,
      tokenTimestamp: Math.floor(Date.now() / 1000),
    },
  })),
  writeSettings: vi.fn(),
}));

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

describe("bulkUpdateFunctions deploy queueing", () => {
  afterEach(() => {
    resetSupabaseDeployQueuesForTests();
    vi.unstubAllGlobals();
  });

  it("queues bulk activations behind active bundle jobs and ahead of later bundles for the same project", async () => {
    resetSupabaseDeployQueuesForTests();

    let releaseBundle: () => void = () => {};
    const activeBundle = enqueueSupabaseDeploy("project-1", true, async () => {
      await new Promise<void>((resolve) => {
        releaseBundle = resolve;
      });
    });

    let resolveBulkUpdate: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveBulkUpdate = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    let bulkUpdateResolved = false;
    const bulkUpdate = bulkUpdateFunctions({
      supabaseProjectId: "project-1",
      functions: [],
      organizationSlug: null,
    }).then(() => {
      bulkUpdateResolved = true;
    });

    let laterBundleStarted = false;
    const laterBundle = enqueueSupabaseDeploy("project-1", true, async () => {
      laterBundleStarted = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(bulkUpdateResolved).toBe(false);
    expect(laterBundleStarted).toBe(false);

    releaseBundle();
    await activeBundle;

    await waitForAssertion(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    expect(bulkUpdateResolved).toBe(false);
    expect(laterBundleStarted).toBe(false);

    resolveBulkUpdate(new Response("", { status: 200 }));

    await bulkUpdate;
    await laterBundle;

    expect(bulkUpdateResolved).toBe(true);
    expect(laterBundleStarted).toBe(true);
  });
});
