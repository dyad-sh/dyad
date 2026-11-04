import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
