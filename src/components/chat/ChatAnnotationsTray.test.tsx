import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  chatAnnotationsAtom,
  type ChatAnnotation,
} from "@/atoms/chatAnnotationAtoms";
import { ChatAnnotationsTray } from "./ChatAnnotationsTray";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      ({
        "annotations.commentCount": `${options?.count ?? 0} comment`,
        "annotations.discard": "Discard",
        "annotations.deleteComment": "Delete comment",
      })[key] ?? key,
  }),
}));

const annotation: ChatAnnotation = {
  id: "annotation-1",
  chatId: 7,
  messageId: 11,
  selectedText: "selected text",
  comment: "Change this",
  createdAt: 1,
  startOffset: 0,
  selectionLength: 13,
};

function renderTray() {
  const store = createStore();
  store.set(chatAnnotationsAtom, new Map([[annotation.chatId, [annotation]]]));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );

  return render(<ChatAnnotationsTray chatId={annotation.chatId} />, {
    wrapper,
  });
}

describe("ChatAnnotationsTray", () => {
  it("uses an X to discard annotations and has no separate send action", () => {
    renderTray();

    const discardButton = screen.getByRole("button", { name: "Discard" });
    expect(discardButton.textContent).toBe("");
    expect(discardButton.querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send/i })).toBeNull();

    fireEvent.click(discardButton);

    expect(screen.queryByTestId("chat-annotations-tray")).toBeNull();
  });
});
