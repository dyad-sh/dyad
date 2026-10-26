import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../preview_panel/FileEditor", () => ({
  FileEditor: () => null,
}));

vi.mock("./CodeHighlight", () => ({
  CodeHighlight: ({ children }: { children: ReactNode }) => (
    <code>{children}</code>
  ),
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: vi.fn() }),
}));

vi.mock("@/hooks/useChatStream", () => ({
  useChatStreamState: () => ({ type: "idle" }),
}));

import { DyadMarkdownParser } from "./DyadMarkdownParser";

describe("DyadMarkdownParser lists separated by bold labels", () => {
  afterEach(cleanup);

  it.each([3, 9])(
    "requires a blank line after a bold label to resume numbering at %i",
    (start) => {
      const prefix = "1. Initial item\n2. Another item\n\n**More changes**";
      const continuation = `${start}. Next item\n${start + 1}. Last item`;
      const { rerender } = render(
        <DyadMarkdownParser content={`${prefix}\n${continuation}`} />,
      );

      // A bold label is a paragraph. CommonMark only lets a list starting at
      // 1 interrupt it; later numbers become paragraph text without a blank line.
      expect(screen.getAllByRole("list")).toHaveLength(1);
      expect(screen.getByText("More changes").closest("p")?.textContent).toBe(
        `More changes\n${continuation}`,
      );

      rerender(<DyadMarkdownParser content={`${prefix}\n\n${continuation}`} />);

      const lists = screen.getAllByRole("list");
      expect(lists).toHaveLength(2);
      expect(lists[1].tagName).toBe("OL");
      expect(lists[1].getAttribute("start")).toBe(String(start));
      expect(
        within(lists[1])
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["Next item", "Last item"]);
      expect(screen.getByText("More changes").closest("p")?.textContent).toBe(
        "More changes",
      );
    },
  );
});
