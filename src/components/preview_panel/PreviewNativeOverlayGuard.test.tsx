import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Renders the real Base UI primitives rather than stand-ins with hand-written
 * roles. The guard's whole job is to recognize the markup those primitives
 * actually emit, so a fake `<div role="listbox">` would test the fixture and
 * not the selector — which is how the previous Radix-era selectors survived
 * long after the dependency they targeted was gone.
 */

const h = vi.hoisted(() => ({
  nativeViewAppId: 1 as number | null,
  setOverlayActive: vi.fn(),
  toasts: [] as unknown[],
}));

vi.mock("jotai", () => ({
  useAtomValue: () => h.nativeViewAppId,
}));

vi.mock("@/atoms/previewAtoms", () => ({
  previewNativeViewAppIdAtom: Symbol("previewNativeViewAppIdAtom"),
}));

vi.mock("sonner", () => ({
  useSonner: () => ({ toasts: h.toasts }),
}));

vi.mock("./usePreviewNativeOverlay", () => ({
  usePreviewNativeOverlay: () => h.setOverlayActive,
}));

import { PreviewNativeOverlayGuard } from "./PreviewNativeOverlayGuard";

/** The most recent value the guard pushed, or undefined if it never spoke. */
function lastOverlayState(): boolean | undefined {
  return h.setOverlayActive.mock.calls.at(-1)?.[0] as boolean | undefined;
}

function SelectHarness({ open }: { open: boolean }) {
  return (
    <>
      <PreviewNativeOverlayGuard />
      <Select open={open}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">alpha</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

function TooltipHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <PreviewNativeOverlayGuard />
      <button data-testid="close" onClick={() => setOpen(false)}>
        close
      </button>
      <Tooltip open={open}>
        <TooltipTrigger>trigger</TooltipTrigger>
        <TooltipContent>tip body</TooltipContent>
      </Tooltip>
    </>
  );
}

beforeEach(() => {
  h.nativeViewAppId = 1;
  h.toasts = [];
  h.setOverlayActive.mockReset();
});

describe("PreviewNativeOverlayGuard", () => {
  it("steps the native view aside for an open select popup", async () => {
    render(<SelectHarness open />);

    await screen.findByText("alpha");
    await waitFor(() => expect(lastOverlayState()).toBe(true));
  });

  it("steps aside for a tooltip, which carries no ARIA role of its own", async () => {
    // Base UI's tooltip popup has no `role`, so a role-based selector cannot
    // see it — it would composite underneath the WebContentsView, invisible.
    render(<TooltipHarness />);

    await screen.findByText("tip body");
    await waitFor(() => expect(lastOverlayState()).toBe(true));
  });

  it("brings the native view back when the popup closes", async () => {
    render(<TooltipHarness />);

    await screen.findByText("tip body");
    await waitFor(() => expect(lastOverlayState()).toBe(true));

    screen.getByTestId("close").click();
    await waitFor(() => expect(lastOverlayState()).toBe(false));
  });

  it("does not latch on a closed select's leftover listbox", async () => {
    // A closed Base UI select leaves `role="listbox"` behind inside a hidden
    // positioner. Keying on that role would hide the native preview for the
    // rest of the session after any select was opened once.
    const { rerender } = render(<SelectHarness open />);
    await screen.findByText("alpha");
    await waitFor(() => expect(lastOverlayState()).toBe(true));

    rerender(<SelectHarness open={false} />);

    // Wait for the leftover to actually settle in the DOM before judging the
    // guard: closing briefly unmounts the popup, so checking too early would
    // pass even for a selector that latches on the residue.
    await waitFor(() =>
      expect(document.body.querySelector('[role="listbox"]')).not.toBeNull(),
    );
    await waitFor(() => expect(lastOverlayState()).toBe(false));
  });

  it("stays quiet while no native view is up", async () => {
    h.nativeViewAppId = null;
    render(<SelectHarness open />);

    await screen.findByText("alpha");
    await waitFor(() => expect(lastOverlayState()).toBe(false));
  });
});
