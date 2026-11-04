import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

describe("GithubCollaboratorManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
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

    render(<GithubCollaboratorManager appId={1} />);

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

    render(<GithubCollaboratorManager appId={1} />);

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

    render(<GithubCollaboratorManager appId={1} />);

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

    const { rerender } = render(<GithubCollaboratorManager appId={1} />);
    rerender(<GithubCollaboratorManager appId={2} />);
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

    const { rerender } = render(<GithubCollaboratorManager appId={1} />);
    expect(await screen.findByTestId("collaborators-no-access")).toBeTruthy();

    rerender(<GithubCollaboratorManager appId={2} />);

    expect(screen.queryByTestId("collaborators-no-access")).toBeNull();
    expect(screen.getByText("Loading collaborators...")).toBeTruthy();
  });

  it("still shows an error toast for other failures", async () => {
    github.listCollaborators.mockRejectedValue(
      new Error("Failed to list collaborators: 403 Forbidden (SSO required)"),
    );

    render(<GithubCollaboratorManager appId={1} />);

    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith(
        "Failed to load collaborators: Failed to list collaborators: 403 Forbidden (SSO required)",
      ),
    );
  });
});
