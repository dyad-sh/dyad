import {
  focusManager,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({
  listCollaborators: vi.fn(),
  inviteCollaborator: vi.fn(),
  removeCollaborator: vi.fn(),
}));
vi.mock("@/ipc/types", () => ({ ipc: { github } }));

const showError = vi.hoisted(() => vi.fn());
const showSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ showError, showSuccess }));

import { GithubCollaboratorManager } from "./GithubCollaboratorManager";

const repo = { githubOrg: "acme", githubRepo: "demo" };

// Mirrors the app's QueryClient: 60s staleTime, no retries, and queries with
// meta.showErrorToast report failures through showError.
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: false } },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.showErrorToast) showError(error);
      },
    }),
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("GithubCollaboratorManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    focusManager.setFocused(undefined);
  });

  it("lists collaborators when the user can manage the repo", async () => {
    github.listCollaborators.mockResolvedValue({
      canManage: true,
      collaborators: [
        {
          login: "octo",
          avatar_url: "https://avatar",
          permissions: { push: true },
        },
      ],
    });

    render(<GithubCollaboratorManager appId={1} {...repo} />, {
      wrapper: createWrapper(),
    });

    expect(await screen.findByTestId("collaborator-item-octo")).toBeTruthy();
    expect(screen.getByTestId("collaborator-invite-input")).toBeTruthy();
    expect(screen.queryByTestId("collaborators-no-access")).toBeNull();
    expect(showError).not.toHaveBeenCalled();
  });

  it("explains missing write access without an error toast", async () => {
    github.listCollaborators.mockResolvedValue({
      canManage: false,
      collaborators: [],
    });

    render(<GithubCollaboratorManager appId={1} {...repo} />, {
      wrapper: createWrapper(),
    });

    expect(await screen.findByTestId("collaborators-no-access")).toBeTruthy();
    expect(screen.queryByTestId("collaborator-invite-input")).toBeNull();
    expect(showError).not.toHaveBeenCalled();
  });

  it("hides the invite form until the access check finishes", async () => {
    let resolveLoad!: (value: unknown) => void;
    github.listCollaborators.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    render(<GithubCollaboratorManager appId={1} {...repo} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByText("Loading collaborators...")).toBeTruthy();
    expect(screen.queryByTestId("collaborator-invite-input")).toBeNull();

    resolveLoad({ canManage: false, collaborators: [] });
    expect(await screen.findByTestId("collaborators-no-access")).toBeTruthy();
    expect(screen.queryByTestId("collaborator-invite-input")).toBeNull();
  });

  it("ignores a late result for an app the user switched away from", async () => {
    let resolveFirst!: (value: unknown) => void;
    github.listCollaborators.mockImplementation(({ appId }) =>
      appId === 1
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({
            canManage: true,
            collaborators: [{ login: "octo", avatar_url: "https://avatar" }],
          }),
    );

    const { rerender } = render(
      <GithubCollaboratorManager appId={1} {...repo} />,
      {
        wrapper: createWrapper(),
      },
    );
    rerender(<GithubCollaboratorManager appId={2} {...repo} />);
    expect(await screen.findByTestId("collaborator-item-octo")).toBeTruthy();

    await act(async () => {
      resolveFirst({ canManage: false, collaborators: [] });
    });

    expect(screen.queryByTestId("collaborators-no-access")).toBeNull();
    expect(screen.getByTestId("collaborator-item-octo")).toBeTruthy();
  });

  it("clears the previous app's no-access message while the next app loads", async () => {
    github.listCollaborators.mockImplementation(({ appId }) =>
      appId === 1
        ? Promise.resolve({ canManage: false, collaborators: [] })
        : new Promise(() => {}),
    );

    const { rerender } = render(
      <GithubCollaboratorManager appId={1} {...repo} />,
      {
        wrapper: createWrapper(),
      },
    );
    expect(await screen.findByTestId("collaborators-no-access")).toBeTruthy();

    rerender(<GithubCollaboratorManager appId={2} {...repo} />);

    expect(screen.queryByTestId("collaborators-no-access")).toBeNull();
    expect(screen.getByText("Loading collaborators...")).toBeTruthy();
  });

  it("still shows an error toast for other failures", async () => {
    github.listCollaborators.mockRejectedValue(
      new Error("Failed to list collaborators: 403 Forbidden (SSO required)"),
    );

    render(<GithubCollaboratorManager appId={1} {...repo} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to list collaborators: 403 Forbidden (SSO required)",
        }),
      ),
    );
  });

  it("does not leave the next app loading when an earlier app's invite finishes", async () => {
    let resolveInvite!: () => void;
    github.inviteCollaborator.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInvite = resolve;
      }),
    );
    github.listCollaborators.mockImplementation(({ appId }) =>
      Promise.resolve({
        canManage: true,
        collaborators: [
          { login: appId === 1 ? "first" : "second", avatar_url: "" },
        ],
      }),
    );

    const { rerender } = render(
      <GithubCollaboratorManager appId={1} {...repo} />,
      {
        wrapper: createWrapper(),
      },
    );
    await screen.findByTestId("collaborator-item-first");
    fireEvent.change(screen.getByTestId("collaborator-invite-input"), {
      target: { value: "newcomer" },
    });
    fireEvent.click(screen.getByTestId("collaborator-invite-button"));
    expect(github.inviteCollaborator).toHaveBeenCalledWith({
      appId: 1,
      username: "newcomer",
    });

    rerender(<GithubCollaboratorManager appId={2} {...repo} />);
    await screen.findByTestId("collaborator-item-second");

    await act(async () => {
      resolveInvite();
    });

    await waitFor(() =>
      expect(screen.queryByText("Loading collaborators...")).toBeNull(),
    );
    expect(screen.getByTestId("collaborator-item-second")).toBeTruthy();
  });

  it("keeps the list visible while it refreshes after an invite", async () => {
    github.inviteCollaborator.mockResolvedValue(undefined);
    github.listCollaborators.mockResolvedValueOnce({
      canManage: true,
      collaborators: [{ login: "octo", avatar_url: "" }],
    });
    github.listCollaborators.mockReturnValue(new Promise(() => {}));

    render(<GithubCollaboratorManager appId={1} {...repo} />, {
      wrapper: createWrapper(),
    });
    await screen.findByTestId("collaborator-item-octo");
    fireEvent.change(screen.getByTestId("collaborator-invite-input"), {
      target: { value: "newcomer" },
    });
    fireEvent.click(screen.getByTestId("collaborator-invite-button"));

    await waitFor(() =>
      expect(github.listCollaborators).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByTestId("collaborator-item-octo")).toBeTruthy();
    expect(screen.queryByText("Loading collaborators...")).toBeNull();
  });

  it("does not show the previous repo's collaborators after the app is re-linked", async () => {
    github.listCollaborators.mockResolvedValueOnce({
      canManage: true,
      collaborators: [{ login: "old-repo-user", avatar_url: "" }],
    });
    github.listCollaborators.mockReturnValue(new Promise(() => {}));
    const wrapper = createWrapper();

    const { unmount } = render(
      <GithubCollaboratorManager appId={1} {...repo} />,
      { wrapper },
    );
    await screen.findByTestId("collaborator-item-old-repo-user");
    unmount();

    render(
      <GithubCollaboratorManager
        appId={1}
        githubOrg="acme"
        githubRepo="other"
      />,
      { wrapper },
    );

    expect(screen.queryByTestId("collaborator-item-old-repo-user")).toBeNull();
    expect(screen.getByText("Loading collaborators...")).toBeTruthy();
  });

  it("refetches when the panel mounts again within the app's stale window", async () => {
    github.listCollaborators.mockResolvedValue({
      canManage: true,
      collaborators: [{ login: "octo", avatar_url: "" }],
    });
    const wrapper = createWrapper();

    const { unmount } = render(
      <GithubCollaboratorManager appId={1} {...repo} />,
      { wrapper },
    );
    await screen.findByTestId("collaborator-item-octo");
    unmount();
    render(<GithubCollaboratorManager appId={1} {...repo} />, { wrapper });

    await waitFor(() =>
      expect(github.listCollaborators).toHaveBeenCalledTimes(2),
    );
  });

  it("does not refetch or repeat the error toast when the window regains focus", async () => {
    github.listCollaborators.mockRejectedValue(
      new Error("Failed to list collaborators: 403 Forbidden (SSO required)"),
    );

    render(<GithubCollaboratorManager appId={1} {...repo} />, {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(github.listCollaborators).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledTimes(1);
  });
});
