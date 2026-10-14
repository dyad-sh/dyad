import { expect, it, vi } from "vitest";
import { planningQuestionnaireTool } from "./planning_questionnaire";
import type { AgentContext } from "./types";
const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
  request: vi.fn(),
  park: vi.fn(),
}));
vi.mock("@/user_input/main", () => ({
  userInputRegistry: { request: mocks.request, park: mocks.park },
}));
vi.mock("@/user_input/questionnaire_journal", () => ({
  persistQuestionnaire: mocks.persist,
}));
it.each([false, true])(
  "journals only Claude-owned questionnaire requests (%s)",
  async (persistQuestionnaireRecovery) => {
    vi.clearAllMocks();
    mocks.park.mockResolvedValue({
      kind: "questionnaire",
      answers: { label: "Hello" },
    });
    const ctx = {
      chatId: 7,
      persistQuestionnaireRecovery,
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;
    await expect(
      planningQuestionnaireTool.execute(
        { questions: [{ id: "label", type: "text", question: "Label?" }] },
        ctx,
      ),
    ).resolves.toContain("Hello");
    expect(mocks.persist).toHaveBeenCalledTimes(
      persistQuestionnaireRecovery ? 1 : 0,
    );
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        requiresRecovery: persistQuestionnaireRecovery,
      }),
      expect.any(String),
    );
  },
);
