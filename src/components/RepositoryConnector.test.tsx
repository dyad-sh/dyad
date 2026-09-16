import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const h = vi.hoisted(() => ({
  app: null as Record<string, unknown> | null,
  settings: {} as Record<string, unknown>,
  gitlabStatus: null as Record<string, unknown> | null,
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: h.app, loading: false }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: h.settings }),
}));
vi.mock("@/hooks/useGitLabStatus", () => ({
  useGitLabStatus: () => ({ status: h.gitlabStatus }),
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
  h.gitlabStatus = null;
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
});
