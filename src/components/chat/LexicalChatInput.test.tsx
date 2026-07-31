import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LexicalChatInput } from "./LexicalChatInput";

const mocks = vi.hoisted(() => ({
  apps: [] as Array<{ id: number; name: string }>,
}));

vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({ apps: mocks.apps }),
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
    mocks.apps = [];
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

  it("restores an app mention containing spaces as one mention node", async () => {
    mocks.apps = [{ id: 1, name: "This Is My App" }];

    const { container } = render(
      <LexicalChatInput
        value="Compare @app:This Is My App."
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        messageHistory={[]}
        excludeCurrentApp={false}
        disableSendButton={false}
      />,
    );

    await waitFor(() => {
      const mention = container.querySelector("[data-beautiful-mention]");
      expect(mention).not.toBeNull();
      expect(mention?.getAttribute("data-beautiful-mention")).toBe(
        "@This Is My App",
      );
    });

    expect(container.querySelectorAll("[data-beautiful-mention]")).toHaveLength(
      1,
    );
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Compare @This Is My App.");
  });

  it("does not rebuild a non-ASCII app mention on parent rerender", async () => {
    mocks.apps = [{ id: 1, name: "猫" }];
    const props = {
      value: "Compare @app:猫.",
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      messageHistory: [],
      excludeCurrentApp: false,
      disableSendButton: false,
    };
    const { container, rerender } = render(<LexicalChatInput {...props} />);

    await waitFor(() => {
      const mention = container.querySelector("[data-beautiful-mention]");
      expect(mention?.getAttribute("data-beautiful-mention")).toBe("@猫");
    });

    const editor = container.querySelector('[contenteditable="true"]');
    if (!editor) {
      throw new Error("Expected editor");
    }
    const textWalker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const leadingText = textWalker.nextNode();
    if (!leadingText) {
      throw new Error("Expected leading editor text");
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(leadingText, 2);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    mocks.apps = [{ id: 1, name: "猫" }];
    rerender(<LexicalChatInput {...props} />);

    await waitFor(() => {
      expect(selection?.anchorNode).toBe(leadingText);
      expect(selection?.anchorOffset).toBe(2);
    });
  });

  it("rebuilds a spaced app mention when app names finish loading", async () => {
    const props = {
      value: "Compare @app:This Is My App.",
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      messageHistory: [],
      excludeCurrentApp: false,
      disableSendButton: false,
    };
    const { container, rerender } = render(<LexicalChatInput {...props} />);

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-beautiful-mention]")
          ?.getAttribute("data-beautiful-mention"),
      ).toBe("@This");
    });

    mocks.apps = [{ id: 1, name: "This Is My App" }];
    rerender(<LexicalChatInput {...props} />);

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-beautiful-mention]")
          ?.getAttribute("data-beautiful-mention"),
      ).toBe("@This Is My App");
    });
    expect(container.querySelectorAll("[data-beautiful-mention]")).toHaveLength(
      1,
    );
  });

  it("does not emit changes while restoring an external app mention", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <LexicalChatInput
        value="Compare @app:This Is My App."
        onChange={onChange}
        onSubmit={vi.fn()}
        messageHistory={[]}
        excludeCurrentApp={false}
        disableSendButton={false}
      />,
    );

    await waitFor(() => {
      expect(
        container.querySelector("[data-beautiful-mention]"),
      ).not.toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("preserves an unknown app mention when known apps finish loading", async () => {
    const props = {
      value: "Compare @app:MissingApp.",
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      messageHistory: [],
      excludeCurrentApp: false,
      disableSendButton: false,
    };
    const { container, rerender } = render(<LexicalChatInput {...props} />);

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-beautiful-mention]")
          ?.getAttribute("data-beautiful-mention"),
      ).toBe("@MissingApp");
    });

    mocks.apps = [{ id: 1, name: "Another App" }];
    rerender(<LexicalChatInput {...props} />);

    await waitFor(() => {
      expect(
        container
          .querySelector("[data-beautiful-mention]")
          ?.getAttribute("data-beautiful-mention"),
      ).toBe("@MissingApp");
    });
    expect(
      container.querySelector('[contenteditable="true"]')?.textContent,
    ).toBe("Compare @MissingApp.");
  });
});
