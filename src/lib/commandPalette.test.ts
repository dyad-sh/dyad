import { describe, expect, it, vi } from "vitest";
import {
  parseCommandPaletteQuery,
  revealCommandPaletteTarget,
  scoreCommandPaletteItem,
} from "./commandPalette";

describe("parseCommandPaletteQuery", () => {
  it.each([
    ["chat: auth failure", { scope: "chat", term: "auth failure" }],
    ["CHAT:auth failure", { scope: "chat", term: "auth failure" }],
    [" chat :   auth failure ", { scope: "chat", term: "auth failure" }],
    ["chat: ", { scope: "chat", term: "" }],
    ["theme", { scope: "all", term: "theme" }],
  ])("parses %j", (query, expected) => {
    expect(parseCommandPaletteQuery(query)).toEqual(expected);
  });
});

describe("scoreCommandPaletteItem", () => {
  it("prefers labels over keywords and rejects unrelated entries", () => {
    expect(scoreCommandPaletteItem("Theme", "the", ["appearance"])).toBe(100);
    expect(scoreCommandPaletteItem("Theme", "appear", ["appearance"])).toBe(50);
    expect(scoreCommandPaletteItem("Theme", "database", ["appearance"])).toBe(
      0,
    );
  });
});

describe("revealCommandPaletteTarget", () => {
  it("waits for a destination, scrolls it, and highlights it", async () => {
    vi.useFakeTimers();
    const promise = revealCommandPaletteTarget("destination", {
      attempts: 3,
      delayMs: 10,
    });

    const element = document.createElement("div");
    element.id = "destination";
    element.scrollIntoView = vi.fn();
    document.body.append(element);
    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toBe(true);
    expect(element.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(element.classList.contains("settings-highlight")).toBe(true);

    element.dispatchEvent(new Event("animationend"));
    expect(element.classList.contains("settings-highlight")).toBe(false);
    vi.useRealTimers();
  });
});
