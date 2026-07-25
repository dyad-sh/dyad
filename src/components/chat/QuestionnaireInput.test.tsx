import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuestionnaireInput } from "./QuestionnaireInput";

vi.mock("@/user_input/hooks", () => ({
  usePendingQuestionnaires: () =>
    new Map([
      [
        7,
        {
          chatId: 7,
          requestId: "questionnaire-1",
          questions: [
            {
              id: "framework",
              type: "radio",
              question: "Which framework?",
              options: ["React", "Vue"],
            },
          ],
          isResponding: true,
        },
      ],
    ]),
}));

vi.mock("@/atoms/chatAtoms", async () => {
  const { atom } = await import("jotai");
  return { selectedChatIdAtom: atom(7) };
});

vi.mock("@/user_input/read_model", () => ({
  getUserInputReadModel: () => ({ respond: vi.fn() }),
}));

describe("QuestionnaireInput", () => {
  it("keeps the questionnaire visible and disables it while submitting", () => {
    const { container } = render(<QuestionnaireInput />);

    expect(screen.queryByText("Submitting...")).not.toBeNull();
    expect(screen.queryByText("Which framework?")).not.toBeNull();

    const fieldset = container.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    expect(fieldset?.disabled).toBe(true);

    const dismiss = screen.getByRole("button", {
      name: "Dismiss questionnaire",
    }) as HTMLButtonElement;
    expect(dismiss.disabled).toBe(true);
  });
});
