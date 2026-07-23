import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LexicalChatInput } from "./LexicalChatInput";

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
});
