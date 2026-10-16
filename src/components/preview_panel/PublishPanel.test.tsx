import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {}, settingsLoading: false }),
}));
vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: (appId: number | null) => ({
    app:
      appId === null
        ? null
        : {
            id: appId,
            name: "app",
            files: [],
            neonProjectId: appId !== 2 ? "neon-project" : null,
            ...(appId === 3 && {
              gitlabInstanceUrl: "https://gitlab.com",
              gitlabProjectId: 9,
              gitlabProjectPath: "me/app",
            }),
          },
    loading: false,
  }),
}));
vi.mock("@/components/RepositoryConnector", () => ({
  RepositoryConnector: () => <div>Repository connector</div>,
}));
vi.mock("@/components/preview_panel/DeploymentSection", () => ({
  DeploymentSection: () => <div>Deployment section</div>,
}));
vi.mock("@/components/preview_panel/DeployDialog", () => ({
  DeployDialog: ({
    appId,
    onClose,
  }: {
    appId: number;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={`Deploy app ${appId}`}>
      <button onClick={onClose}>Finish</button>
    </div>
  ),
}));

import { PublishPanel } from "./PublishPanel";

describe("PublishPanel", () => {
  it("keeps the existing cards and opens guided deployment for a Neon app", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    render(
      <Provider store={store}>
        <PublishPanel />
      </Provider>,
    );

    expect(screen.getByText("Repository connector")).toBeTruthy();
    expect(screen.getByText("Deployment section")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Publish app" }));
    expect(screen.getByRole("dialog", { name: "Deploy app 1" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps publishing options without guided deployment for a non-Neon app", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 2);
    render(
      <Provider store={store}>
        <PublishPanel />
      </Provider>,
    );

    expect(screen.getByText("Repository connector")).toBeTruthy();
    expect(screen.getByText("Deployment section")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publish app" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not reopen the dialog when switching back to its app", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    render(
      <Provider store={store}>
        <PublishPanel />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Publish app" }));
    expect(screen.getByRole("dialog", { name: "Deploy app 1" })).toBeTruthy();
    act(() => store.set(selectedAppIdAtom, 2));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish app" })).toBeNull();
    act(() => store.set(selectedAppIdAtom, 1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish app" })).toBeTruthy();
  });

  it("preserves the GitLab repository card alongside the Neon publish button", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 3);
    render(
      <Provider store={store}>
        <PublishPanel />
      </Provider>,
    );

    expect(screen.getByText("preview.publish_panel.gitlab")).toBeTruthy();
    expect(screen.queryByText("preview.publish_panel.github")).toBeNull();
    expect(screen.getByText("Repository connector")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish app" })).toBeTruthy();
  });
});
