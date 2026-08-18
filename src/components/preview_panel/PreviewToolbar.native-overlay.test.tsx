import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chatPanelHiddenAtom: Symbol("chatPanelHiddenAtom"),
  previewModeAtom: Symbol("previewModeAtom"),
  previewNativeOverlayAtom: Symbol("previewNativeOverlayAtom"),
  previewNativeViewAtom: Symbol("previewNativeViewAtom"),
  previewOpenAtom: Symbol("previewOpenAtom"),
  selectedAppIdAtom: Symbol("selectedAppIdAtom"),
  setNativeOverlayActive: vi.fn(),
  setOverlayActive: vi.fn(),
}));

vi.mock("jotai", () => ({
  useAtom: (atom: symbol) => {
    if (atom === h.previewModeAtom) return ["preview", vi.fn()];
    if (atom === h.previewOpenAtom) return [true, vi.fn()];
    if (atom === h.chatPanelHiddenAtom) return [false, vi.fn()];
    return [undefined, vi.fn()];
  },
  useAtomValue: (atom: symbol) => {
    if (atom === h.selectedAppIdAtom) return 1;
    if (atom === h.previewNativeViewAtom) return true;
    return undefined;
  },
  useSetAtom: (atom: symbol) =>
    atom === h.previewNativeOverlayAtom ? h.setNativeOverlayActive : vi.fn(),
}));

vi.mock("@/atoms/appAtoms", () => ({
  previewModeAtom: h.previewModeAtom,
  selectedAppIdAtom: h.selectedAppIdAtom,
}));

vi.mock("@/atoms/viewAtoms", () => ({
  isChatPanelHiddenAtom: h.chatPanelHiddenAtom,
  isPreviewOpenAtom: h.previewOpenAtom,
}));

vi.mock("@/atoms/previewAtoms", () => ({
  previewNativeOverlayActiveAtom: h.previewNativeOverlayAtom,
  previewNativeViewAtom: h.previewNativeViewAtom,
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

import { PreviewToolbar } from "./PreviewToolbar";

beforeEach(() => {
  h.setNativeOverlayActive.mockReset();
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
    render(<PreviewToolbar />);
    const overflow = screen.getByTestId("preview-mode-overflow-button");

    fireEvent.click(overflow);
    expect(h.setNativeOverlayActive).toHaveBeenLastCalledWith(true);
    expect(h.setOverlayActive).toHaveBeenLastCalledWith({ active: true });

    fireEvent.click(overflow);
    expect(h.setNativeOverlayActive).toHaveBeenLastCalledWith(false);
    expect(h.setOverlayActive).toHaveBeenLastCalledWith({ active: false });
  });
});
