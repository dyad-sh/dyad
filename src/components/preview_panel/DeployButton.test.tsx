import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewNativeOverlayActiveAtom,
  previewNativeViewAppIdAtom,
} from "@/atoms/previewAtoms";

const h = vi.hoisted(() => ({ setOverlayActive: vi.fn() }));
vi.mock("@/ipc/types", () => ({
  ipc: { previewView: { setOverlayActive: h.setOverlayActive } },
}));
vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({ state: { type: "closed" } }),
}));
vi.mock("./DeployDialog", () => ({
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
vi.mock("@/components/ui/tooltip", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({
      children,
      render: trigger,
    }: {
      children: ReactNode;
      render: ReactElement;
    }) => React.cloneElement(trigger, {}, children),
    TooltipContent: () => null,
  };
});

import { DeployButton } from "./DeployButton";

function mount(nativeViewAppId: number | null = null) {
  const store = createStore();
  store.set(previewNativeViewAppIdAtom, nativeViewAppId);
  const ui = (appId: number | null) => (
    <Provider store={store}>
      <DeployButton appId={appId} />
    </Provider>
  );
  const view = render(ui(1));
  return {
    store,
    ...view,
    changeApp: (appId: number | null) => view.rerender(ui(appId)),
  };
}

beforeEach(() => h.setOverlayActive.mockReset());

describe("DeployButton", () => {
  it("shows only an icon, with an accessible name, and opens the app's dialog", () => {
    mount();
    const button = screen.getByRole("button", { name: "Deploy" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Deploy app 1" })).toBeTruthy();
    expect(h.setOverlayActive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides the native surface for the dialog and restores it on close", () => {
    const { store } = mount(1);
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(store.get(previewNativeOverlayActiveAtom)).toBe(true);
    expect(h.setOverlayActive).toHaveBeenLastCalledWith({ active: true });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(store.get(previewNativeOverlayActiveAtom)).toBe(false);
    expect(h.setOverlayActive).toHaveBeenLastCalledWith({ active: false });
  });

  it("closes the previous app's dialog on app change", () => {
    const { changeApp, store } = mount(1);
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    changeApp(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.get(previewNativeOverlayActiveAtom)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(screen.getByRole("dialog", { name: "Deploy app 2" })).toBeTruthy();
  });

  it("cleans up the overlay on unmount and hides the button without an app", () => {
    const { store, unmount, changeApp } = mount(1);
    changeApp(null);
    expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();
    changeApp(1);
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    unmount();
    expect(store.get(previewNativeOverlayActiveAtom)).toBe(false);
  });
});
