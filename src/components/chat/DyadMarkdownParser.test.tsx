import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DyadMarkdownParser } from "./DyadMarkdownParser";

vi.mock("../preview_panel/FileEditor", () => ({
  FileEditor: () => null,
}));

describe("DyadMarkdownParser dyad-status", () => {
  afterEach(() => {
    cleanup();
  });

  it("honors explicit aborted state on closed status tags", () => {
    render(
      <DyadMarkdownParser
        content={
          '<dyad-status title="Supabase functions failed" state="aborted">\n0 succeeded\n1 failed\n</dyad-status>'
        }
      />,
    );

    const statusCard = screen.getByRole("button");

    expect(screen.getByText("Supabase functions failed")).toBeTruthy();
    expect(statusCard.className).toContain("border-l-red-500");
  });
});
