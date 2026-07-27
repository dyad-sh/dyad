import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGeneratorDialog } from "./ImageGeneratorDialog";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));
vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({ apps: [{ id: 7, name: "App" }] }),
}));
vi.mock("@/hooks/useGenerateImage", () => ({
  useGenerateImage: () => ({ start: mocks.start }),
}));
vi.mock("@/hooks/useUserBudgetInfo", () => ({
  useUserBudgetInfo: () => ({
    userBudget: { remaining: 1 },
    isLoadingUserBudget: false,
  }),
}));
vi.mock("./ProBanner", () => ({ AiAccessBanner: () => null }));
vi.mock("./AppSearchSelect", () => ({ AppSearchSelect: () => null }));

describe("ImageGeneratorDialog", () => {
  beforeEach(() => {
    mocks.start.mockReset();
  });

  it("keeps the dialog and prompt open when submit admission is rejected", async () => {
    mocks.start.mockResolvedValue(null);
    const onOpenChange = vi.fn();
    render(
      <ImageGeneratorDialog
        open
        defaultAppId={7}
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "A lighthouse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe(
      "A lighthouse",
    );
  });
});
