import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LexicalChatInput } from "./LexicalChatInput";

const appMocks = vi.hoisted(() => ({
  apps: [] as { id: number; name: string }[],
}));

vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({ apps: appMocks.apps }),
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
    appMocks.apps = [];
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

  it("rehydrates an app name containing spaces as one mention node", async () => {
    appMocks.apps = [{ id: 1, name: "App With Spaces" }];
    const { container } = render(
      <LexicalChatInput
        value="Compare @app:App With Spaces."
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        messageHistory={[]}
        excludeCurrentApp={false}
        disableSendButton={false}
      />,
    );

    await waitFor(() => {
      const mentions = container.querySelectorAll(
        '[data-beautiful-mention="@App With Spaces"]',
      );
      expect(mentions).toHaveLength(1);
      expect(
        container.querySelector('[contenteditable="true"]')?.textContent,
      ).toBe("Compare @App With Spaces.");
    });
  });
});
