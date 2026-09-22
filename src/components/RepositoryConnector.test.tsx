import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const h = vi.hoisted(() => ({
  app: null as Record<string, unknown> | null,
  settings: {} as Record<string, unknown> | undefined,
  settingsLoading: false,
  gitlabStatus: null as Record<string, unknown> | null,
  gitlabStatusLoading: false,
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: h.app, loading: false }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: h.settings,
    settingsLoading: h.settingsLoading,
  }),
}));
vi.mock("@/hooks/useGitLabStatus", () => ({
  useGitLabStatus: () => ({
    status: h.gitlabStatus,
    isLoading: h.gitlabStatusLoading,
  }),
}));
vi.mock("@/components/GitHubConnector", () => ({
  GitHubConnector: () => <div data-testid="stub-github-connector" />,
}));
vi.mock("@/components/GitLabConnector", () => ({
  GitLabConnector: () => <div data-testid="stub-gitlab-connector" />,
}));

const { RepositoryConnector } = await import("./RepositoryConnector");

beforeEach(() => {
  h.app = { id: 1 };
  h.settings = {};
  h.settingsLoading = false;
  h.gitlabStatus = null;
  h.gitlabStatusLoading = false;
});

describe("RepositoryConnector", () => {
  it("is the GitHub connector while the experiment is off", () => {
    render(<RepositoryConnector appId={1} folderName="demo" />);
    expect(screen.getByTestId("stub-github-connector")).toBeInTheDocument();
    expect(screen.queryByTestId("repository-provider-choice")).toBeNull();
  });

  it("keeps a GitLab-linked app on GitLab even with the experiment off", () => {
    h.app = {
      id: 1,
      gitlabHost: "https://gitlab.com",
      gitlabProjectId: 9,
      gitlabProjectPath: "me/demo",
    };
    render(<RepositoryConnector appId={1} folderName="demo" />);
    expect(screen.getByTestId("stub-gitlab-connector")).toBeInTheDocument();
    expect(screen.queryByTestId("repository-provider-choice")).toBeNull();
  });

  it("offers no choice for a GitHub-linked app", () => {
    h.settings = { enableGitlabPublishing: true };
    h.app = { id: 1, githubOrg: "acme", githubRepo: "demo" };
    render(<RepositoryConnector appId={1} folderName="demo" />);
    expect(screen.getByTestId("stub-github-connector")).toBeInTheDocument();
    expect(screen.queryByTestId("repository-provider-choice")).toBeNull();
  });

  it("offers the choice for an unlinked app and switches connectors", async () => {
    h.settings = { enableGitlabPublishing: true };
    render(<RepositoryConnector appId={1} folderName="demo" />);

    expect(
      screen.getByTestId("repository-provider-choice"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("stub-github-connector")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("repository-provider-gitlab"));
    expect(screen.getByTestId("stub-gitlab-connector")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-github-connector")).toBeNull();
  });

  it("defaults to GitLab when only GitLab is connected", () => {
    h.settings = { enableGitlabPublishing: true };
    h.gitlabStatus = { connected: true };
    render(<RepositoryConnector appId={1} folderName="demo" />);
    expect(screen.getByTestId("stub-gitlab-connector")).toBeInTheDocument();
  });

  it("shows neither connector until settings have loaded", () => {
    // Settings read as undefined while the query is in flight, which makes
    // `enableGitlabPublishing` look false — so without this gate a user with
    // the experiment on would be shown the GitHub flow and could start
    // linking to the wrong provider.
    h.settings = undefined;
    h.settingsLoading = true;

    render(<RepositoryConnector appId={1} folderName="demo" />);

    expect(
      screen.getByTestId("repository-connector-loading"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("stub-github-connector")).toBeNull();
    expect(screen.queryByTestId("stub-gitlab-connector")).toBeNull();
  });

  it("waits for the GitLab status before defaulting a provider", () => {
    h.settings = { enableGitlabPublishing: true };
    h.gitlabStatusLoading = true;

    render(<RepositoryConnector appId={1} folderName="demo" />);

    expect(
      screen.getByTestId("repository-connector-loading"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("repository-provider-choice")).toBeNull();
  });

  it("still shows a linked app's connector while settings load", () => {
    // A linked app's provider comes from its own row, so it does not have to
    // wait for either query.
    h.settings = undefined;
    h.settingsLoading = true;
    h.app = {
      id: 1,
      gitlabHost: "https://gitlab.com",
      gitlabProjectId: 9,
      gitlabProjectPath: "me/demo",
    };

    render(<RepositoryConnector appId={1} folderName="demo" />);

    expect(screen.getByTestId("stub-gitlab-connector")).toBeInTheDocument();
  });

  it("forgets a provider choice when the selected app changes", async () => {
    // The publish panel keeps this subtree mounted across app switches, so a
    // choice made for one app would decide the provider for the next.
    h.settings = { enableGitlabPublishing: true };
    const { rerender } = render(
      <RepositoryConnector appId={1} folderName="demo" />,
    );

    await userEvent.click(screen.getByTestId("repository-provider-gitlab"));
    expect(screen.getByTestId("stub-gitlab-connector")).toBeInTheDocument();

    rerender(<RepositoryConnector appId={2} folderName="other" />);

    expect(screen.getByTestId("stub-github-connector")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-gitlab-connector")).toBeNull();
  });
});
