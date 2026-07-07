import { describe, expect, it } from "vitest";
import {
  DesignSpecSchema,
  StoredDesignSpecSchema,
  type DesignSpec,
} from "./design";

const sampleSpec: DesignSpec = {
  title: "Habit Tracker",
  summary: "A calm, minimal habit tracker.",
  designSystem: {
    mood: "calm, minimal, trustworthy",
    colors: [
      { name: "Primary", hex: "#4F46E5" },
      { name: "Background", hex: "#0B1020" },
    ],
    typography: { heading: "Inter 600", body: "Inter 400" },
    spacing: "8px grid, rounded-xl corners",
  },
  interfaces: [
    {
      id: "home",
      name: "Home",
      purpose: "See today's habits at a glance",
      prompt: "A dashboard with a vertical list of habit cards...",
      copy: "Today · 3 of 5 done",
      imagePath: ".dyad/media/generated-home.png",
    },
    {
      id: "add",
      name: "Add habit",
      purpose: "Create a new habit",
      prompt: "A focused form with a large title input...",
    },
  ],
};

describe("design spec schemas", () => {
  it("accepts a well-formed design spec", () => {
    expect(DesignSpecSchema.safeParse(sampleSpec).success).toBe(true);
  });

  it("allows interfaces without an image yet", () => {
    const parsed = DesignSpecSchema.parse(sampleSpec);
    expect(parsed.interfaces[1].imagePath).toBeUndefined();
  });

  it("round-trips a stored design spec through JSON", () => {
    const stored = {
      ...sampleSpec,
      appId: 1,
      chatId: 42,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    };
    const json = JSON.stringify(stored);
    const parsed = StoredDesignSpecSchema.safeParse(JSON.parse(json));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.chatId).toBe(42);
      expect(parsed.data.interfaces).toHaveLength(2);
    }
  });

  it("rejects a spec missing the design system", () => {
    const { designSystem: _omit, ...withoutSystem } = sampleSpec;
    expect(DesignSpecSchema.safeParse(withoutSystem).success).toBe(false);
  });
});
