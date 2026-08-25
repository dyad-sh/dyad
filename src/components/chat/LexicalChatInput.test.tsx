import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasVisibleMentionsMenu, LexicalChatInput } from "./LexicalChatInput";

vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({ apps: [] }),
}));
vi.mock("@/hooks/usePrompts", () => ({
  usePrompts: () => ({ prompts: [] }),
}));
vi.mock("@/hooks/useAppMediaFiles", () => ({
  useAppMediaFiles: () => ({ mediaApps: [] }),
}));
vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: undefined }),
}));
vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => null,
}));

describe("LexicalChatInput", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reactively updates editor editability when disabled changes", async () => {
    const props = {
      value: "",
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      messageHistory: [],
      excludeCurrentApp: false,
      disableSendButton: false,
    };
    const { container, rerender } = render(
      <LexicalChatInput {...props} disabled={false} />,
    );

    const editor = container.querySelector('[contenteditable="true"]');
    expect(editor).not.toBeNull();

    rerender(<LexicalChatInput {...props} disabled />);

    await waitFor(() => {
      expect(
        container.querySelector('[contenteditable="false"]'),
      ).not.toBeNull();
    });
  });

  it("checks only the owning editor for a visible mentions menu", () => {
    const firstEditor = document.createElement("div");
    const secondEditor = document.createElement("div");
    const menu = document.createElement("ul");
    menu.dataset.mentionsMenu = "true";
    menu.append(document.createElement("li"));
    firstEditor.append(menu);

    expect(hasVisibleMentionsMenu(firstEditor)).toBe(true);
    expect(hasVisibleMentionsMenu(secondEditor)).toBe(false);
  });
});
