import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("DeleteConfirmationDialog", () => {
  it("disables a custom trigger while deleting", () => {
    render(
      <DeleteConfirmationDialog
        itemName="Lab"
        onDelete={vi.fn()}
        isDeleting
        trigger={<span>Deleting…</span>}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Deleting…" })
        .disabled,
    ).toBe(true);
  });

  it("leaves a custom trigger usable otherwise", () => {
    render(
      <DeleteConfirmationDialog
        itemName="Lab"
        onDelete={vi.fn()}
        trigger={<span>Delete</span>}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Delete" })
        .disabled,
    ).toBe(false);
  });
});
