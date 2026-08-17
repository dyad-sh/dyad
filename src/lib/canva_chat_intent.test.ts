import { describe, expect, it } from "vitest";

import {
  inferCanvaDesignAction,
  inferCanvaDesignIntent,
  isCanvaCandidateSelection,
} from "./canva_chat_intent";

const request = (content: string) => [{ role: "user" as const, content }];

describe("Canva Chat Agent intent", () => {
  it.each([
    "Create a 10-slide presentation about AI in fitness",
    "Generate a pitch deck for my startup",
    "Find my Canva designs about guitars",
    "Export this Canva design as a PDF",
  ])("routes actionable design requests: %s", (content) => {
    expect(inferCanvaDesignIntent(request(content))).toBe(true);
  });

  it.each([
    "What is Canva?",
    "Tell me about presentation skills",
    "Write an outline about AI in fitness",
  ])("leaves ordinary discussion in chat: %s", (content) => {
    expect(inferCanvaDesignIntent(request(content))).toBe(false);
  });

  it.each(["Use the second option", "Choose candidate 3", "Pick design #1"])(
    "recognizes a candidate follow-up: %s",
    (content) => {
      expect(isCanvaCandidateSelection(request(content))).toBe(true);
    },
  );

  it.each([
    ["Create a pitch deck", "generate"],
    ["Find my Canva launch design", "search"],
    ["Edit this Canva presentation", "edit"],
    ["Export this Canva deck", "export"],
  ] as const)("classifies %s as %s", (content, action) => {
    expect(inferCanvaDesignAction(request(content))).toBe(action);
  });

  it("keeps a presentation request active through audience refinements", () => {
    const turns = [
      {
        role: "user" as const,
        content: "Create a 10-slide presentation about AI in fitness",
      },
      {
        role: "assistant" as const,
        content:
          "Who is the target audience, and should the presentation be technical or simple?",
      },
      { role: "user" as const, content: "gym members" },
      {
        role: "assistant" as const,
        content: "What is the gym's vibe and how long are you presenting?",
      },
      {
        role: "user" as const,
        content: "hardcore lifting, about 10 minutes",
      },
      {
        role: "assistant" as const,
        content: "Is the room mostly powerlifters or bodybuilders?",
      },
      { role: "user" as const, content: "body builders" },
    ];

    expect(inferCanvaDesignAction(turns)).toBe("generate");
    expect(inferCanvaDesignIntent(turns)).toBe(true);
  });

  it.each(["thanks", "okay", "never mind", "what does hypertrophy mean?"])(
    "does not reopen Canva for an ordinary follow-up: %s",
    (content) => {
      const turns = [
        {
          role: "user" as const,
          content: "Create a presentation about AI in fitness",
        },
        {
          role: "assistant" as const,
          content: "I can help refine the presentation.",
        },
        { role: "user" as const, content },
      ];

      expect(inferCanvaDesignIntent(turns)).toBe(false);
    },
  );
});
