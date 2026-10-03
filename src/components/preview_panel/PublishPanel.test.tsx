import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: (appId: number | null) => ({
    app: appId === null ? null : { id: appId, name: "app", files: [] },
    loading: false,
  }),
}));
vi.mock("@/components/GitHubConnector", () => ({
  GitHubConnector: () => <div>GitHub connector</div>,
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
  it("keeps the existing cards and opens the guided deployment dialog", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    render(
      <Provider store={store}>
        <PublishPanel />
      </Provider>,
    );

    expect(screen.getByText("GitHub connector")).toBeTruthy();
    expect(screen.getByText("Deployment section")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Guided deployment" }));
    expect(screen.getByRole("dialog", { name: "Deploy app 1" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Guided deployment" }));
    expect(screen.getByRole("dialog", { name: "Deploy app 1" })).toBeTruthy();
    act(() => store.set(selectedAppIdAtom, 2));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => store.set(selectedAppIdAtom, 1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
