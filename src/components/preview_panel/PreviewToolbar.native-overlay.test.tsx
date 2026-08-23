import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  setOverlayActive: vi.fn(),
}));

vi.mock("@/hooks/useCheckProblems", () => ({
  useCheckProblems: () => ({ problemReport: null }),
}));

vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotionPref: () => true,
}));

vi.mock("@/hooks/useVersionPreview", () => ({
  useVersionPreview: () => ({
    state: { type: "closed" },
    send: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVersions", () => ({
  useVersions: () => ({ versions: [] }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    previewView: { setOverlayActive: h.setOverlayActive },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("framer-motion", () => ({
  motion: {
    span: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  },
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

vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const MenuContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>({ open: false, onOpenChange: () => {} });

  return {
    DropdownMenu: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (
      <MenuContext.Provider value={{ open, onOpenChange }}>
        {children}
      </MenuContext.Provider>
    ),
    DropdownMenuTrigger: ({ children, ...props }: ComponentProps<"button">) => {
      const menu = React.useContext(MenuContext);
      return (
        <button {...props} onClick={() => menu.onOpenChange(!menu.open)}>
          {children}
        </button>
      );
    },
    DropdownMenuContent: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuItem: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  previewNativeOverlayActiveAtom,
  previewNativeViewAppIdAtom,
} from "@/atoms/previewAtoms";
import { isChatPanelHiddenAtom, isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { PreviewToolbar } from "./PreviewToolbar";

// Real atoms rather than symbol stand-ins: the overlay request now goes through
// a shared reason set, and mocking jotai away would leave that aggregation —
// the part that decides whether the native view hides — untested.
function renderToolbar({
  nativeViewAppId,
}: {
  nativeViewAppId: number | null;
}) {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  store.set(previewModeAtom, "preview");
  store.set(isPreviewOpenAtom, true);
  store.set(isChatPanelHiddenAtom, false);
  store.set(previewNativeViewAppIdAtom, nativeViewAppId);

  render(
    <Provider store={store}>
      <PreviewToolbar />
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  h.setOverlayActive.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

describe("PreviewToolbar native preview overlay", () => {
  it("hides the native surface before opening overflow UI and restores it on close", () => {
    const store = renderToolbar({ nativeViewAppId: 1 });
    // happy-dom measures every tab at 0 width against 0 available width, which
    // the inter-tab gaps push over budget — so the overflow button really renders.
    const overflow = screen.getByTestId("preview-mode-overflow-button");

    fireEvent.click(overflow);
    expect(store.get(previewNativeOverlayActiveAtom)).toBe(true);
    expect(h.setOverlayActive).toHaveBeenLastCalledWith({ active: true });

    fireEvent.click(overflow);
    expect(store.get(previewNativeOverlayActiveAtom)).toBe(false);
    expect(h.setOverlayActive).toHaveBeenLastCalledWith({ active: false });
  });

  it("leaves the iframe preview alone", () => {
    const store = renderToolbar({ nativeViewAppId: null });

    fireEvent.click(screen.getByTestId("preview-mode-overflow-button"));

    expect(store.get(previewNativeOverlayActiveAtom)).toBe(false);
    expect(h.setOverlayActive).not.toHaveBeenCalled();
  });
});
