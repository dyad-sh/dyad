import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  listOrganizations: vi.fn(),
  listAllProjects: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    supabase: {
      createProject: mocks.createProject,
      listOrganizations: mocks.listOrganizations,
      listAllProjects: mocks.listAllProjects,
    },
    events: { supabase: { onRedeployProgress: () => () => {} } },
  },
  // The hook compares the failure's code against this. Left out of the mock it
  // would be undefined, and every code-less failure would match.
  SUPABASE_PROJECT_CREATED_BUT_UNLINKED:
    "supabase_project_created_but_unlinked",
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({ settings: {} }),
}));

vi.mock("@/lib/schemas", () => ({
  isSupabaseConnected: () => true,
}));

vi.mock("@/app_run/AppRunRemoteProvider", () => ({
  useAppRunRemoteManager: () => ({
    previewConsole: { append: vi.fn() },
  }),
}));

import { isCreatedButUnlinkedError, useSupabase } from "./useSupabase";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

function renderSupabase() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSupabase(), { wrapper });
}

/** A create whose settlement this test controls. */
function deferredCreate() {
  let settle: (project: unknown) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle: (p: unknown) => settle(p), fail };
}

const PROJECT = {
  id: "proj-new",
  name: "My App",
  region: "us-east-1",
  organizationSlug: "org-1",
};

const params = (appId: number) => ({
  appId,
  name: "My App",
  organizationSlug: "org-1",
  region: "us-east-1",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listOrganizations.mockResolvedValue([]);
  mocks.listAllProjects.mockResolvedValue([]);
});

describe("useSupabase — in-flight creates", () => {
  it("reports the app a create is running for, and no other", async () => {
    const create = deferredCreate();
    mocks.createProject.mockReturnValue(create.promise);

    const { result } = renderSupabase();
    act(() => {
      void result.current.createProject(params(7));
    });

    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(7)).toBe(true),
    );
    expect(result.current.isCreatingProjectForApp(8)).toBe(false);

    await act(async () => {
      create.settle(PROJECT);
      await create.promise;
    });
    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(7)).toBe(false),
    );
  });

  // The reason this is tracked per app rather than read off the mutation: a
  // single observer only reports its most recent call, so app 8's create would
  // otherwise describe app 7's pending state.
  it("keeps each app's state when two creates overlap", async () => {
    const first = deferredCreate();
    const second = deferredCreate();
    mocks.createProject
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderSupabase();
    act(() => {
      void result.current.createProject(params(7));
    });
    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(7)).toBe(true),
    );

    act(() => {
      void result.current.createProject(params(8));
    });
    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(8)).toBe(true),
    );
    // App 7 is still running; the newer call must not have taken over its state.
    expect(result.current.isCreatingProjectForApp(7)).toBe(true);

    await act(async () => {
      second.settle(PROJECT);
      await second.promise;
    });
    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(8)).toBe(false),
    );
    expect(result.current.isCreatingProjectForApp(7)).toBe(true);
  });

  // Counted, not a membership set: the first settle must not unlock a form
  // whose second create is still running.
  it("stays pending until every create for that app has settled", async () => {
    const first = deferredCreate();
    const second = deferredCreate();
    mocks.createProject
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderSupabase();
    act(() => {
      void result.current.createProject(params(7));
      void result.current.createProject(params(7));
    });
    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(7)).toBe(true),
    );

    await act(async () => {
      first.settle(PROJECT);
      await first.promise;
    });
    expect(result.current.isCreatingProjectForApp(7)).toBe(true);

    await act(async () => {
      second.settle(PROJECT);
      await second.promise;
    });
    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(7)).toBe(false),
    );
  });

  it("clears the app when a create fails", async () => {
    const create = deferredCreate();
    mocks.createProject.mockReturnValue(create.promise);

    const { result } = renderSupabase();
    act(() => {
      result.current.createProject(params(7)).catch(() => {});
    });
    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(7)).toBe(true),
    );

    await act(async () => {
      create.fail(new Error("network unreachable"));
      await create.promise.catch(() => {});
    });
    await waitFor(() =>
      expect(result.current.isCreatingProjectForApp(7)).toBe(false),
    );
  });
});

describe("isCreatedButUnlinkedError", () => {
  // The message tells the user a real project is sitting orphaned in their
  // Supabase account, so it must only fire for the failure that made one.
  it("matches the failure the handler marks, and nothing else", () => {
    const unlinked = new DyadError(
      "Created but not linked",
      DyadErrorKind.Internal,
    ) as DyadError & { code: string };
    unlinked.code = "supabase_project_created_but_unlinked";

    expect(isCreatedButUnlinkedError(unlinked)).toBe(true);
    // Same kind, no marker: nothing was created.
    expect(
      isCreatedButUnlinkedError(
        new DyadError("Renderer is not trusted", DyadErrorKind.Internal),
      ),
    ).toBe(false);
    expect(isCreatedButUnlinkedError(new Error("offline"))).toBe(false);
    expect(isCreatedButUnlinkedError(null)).toBe(false);
    expect(isCreatedButUnlinkedError(undefined)).toBe(false);
  });
});

describe("useSupabase — refetching the project list after a failed create", () => {
  // Only the created-but-unlinked failure leaves something new in the list to
  // find. `listAllProjects` reports a partial result as a success, so an
  // offline create refetching here would replace a good cached list with an
  // empty one — the opposite of helpful.
  it("refetches only for a create that left a project behind", async () => {
    mocks.listOrganizations.mockResolvedValue([
      { organizationSlug: "org-1", name: "Acme" },
    ]);
    mocks.listAllProjects.mockResolvedValue([
      {
        id: "proj-1",
        name: "One",
        region: "us-east-1",
        organizationSlug: "org-1",
      },
    ]);

    const { result } = renderSupabase();
    await waitFor(() => expect(mocks.listAllProjects).toHaveBeenCalledTimes(1));

    mocks.createProject.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await result.current.createProject(params(7)).catch(() => {});
    });
    await act(async () => {});
    expect(mocks.listAllProjects).toHaveBeenCalledTimes(1);

    const unlinked = new DyadError(
      "Created but not linked",
      DyadErrorKind.Internal,
    ) as DyadError & { code: string };
    unlinked.code = "supabase_project_created_but_unlinked";
    mocks.createProject.mockRejectedValueOnce(unlinked);
    await act(async () => {
      await result.current.createProject(params(7)).catch(() => {});
    });
    await waitFor(() => expect(mocks.listAllProjects).toHaveBeenCalledTimes(2));
  });
});
