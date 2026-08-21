import { describe, expect, it, vi } from "vitest";
import {
  getCommandPaletteSnippet,
  getSelectedChatId,
  hasBlockingCommandPaletteDialogOpen,
  isMonacoShortcutTarget,
  isTerminalShortcutTarget,
  parseCommandPaletteQuery,
  revealCommandPaletteTarget,
  scoreCommandPaletteItem,
  shouldPreserveCommandPaletteShortcut,
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
    expect(
      scoreCommandPaletteItem("Configure environment variables", "env vars", [
        "env",
        "secrets",
      ]),
    ).toBeGreaterThan(0);
  });
});

describe("getCommandPaletteSnippet", () => {
  it("bounds long content while preserving the matched context", () => {
    const text = `${"a".repeat(80)}needle${"b".repeat(80)}`;
    const snippet = getCommandPaletteSnippet(text, "needle", 10);

    expect(snippet).toBe(`…${"a".repeat(10)}needle${"b".repeat(10)}…`);
    expect(snippet.length).toBeLessThan(text.length);
  });
});

describe("getSelectedChatId", () => {
  it("does not fall back to an arbitrary chat", () => {
    expect(getSelectedChatId([{ id: 1 }, { id: 2 }], null)).toBeNull();
    expect(getSelectedChatId([{ id: 1 }, { id: 2 }], 2)).toBe(2);
    expect(getSelectedChatId([{ id: 1 }, { id: 2 }], 3)).toBeNull();
  });
});

describe("hasBlockingCommandPaletteDialogOpen", () => {
  it("protects open confirmations and dialogs with pending input", () => {
    const alert = document.createElement("div");
    alert.dataset.slot = "alert-dialog-content";
    alert.dataset.open = "";
    document.body.append(alert);

    expect(hasBlockingCommandPaletteDialogOpen()).toBe(true);
    alert.remove();

    const dialog = document.createElement("div");
    dialog.dataset.slot = "dialog-content";
    dialog.dataset.open = "";
    document.body.append(dialog);
    expect(hasBlockingCommandPaletteDialogOpen()).toBe(true);

    dialog.dataset.commandPaletteDismissible = "true";
    expect(hasBlockingCommandPaletteDialogOpen()).toBe(false);
    dialog.remove();
  });
});

describe("editor shortcut targets", () => {
  it("recognizes descendants of terminal and Monaco editor surfaces", () => {
    const terminal = document.createElement("div");
    terminal.dataset.testid = "terminal-xterm";
    const child = document.createElement("textarea");
    terminal.append(child);

    const monaco = document.createElement("div");
    monaco.className = "monaco-editor";
    const monacoInput = document.createElement("textarea");
    monaco.append(monacoInput);

    expect(isTerminalShortcutTarget(child)).toBe(true);
    expect(isMonacoShortcutTarget(monacoInput)).toBe(true);
    expect(
      shouldPreserveCommandPaletteShortcut(monacoInput, {
        ctrlKey: false,
        metaKey: true,
      }),
    ).toBe(true);
    expect(
      shouldPreserveCommandPaletteShortcut(child, {
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      shouldPreserveCommandPaletteShortcut(child, {
        ctrlKey: false,
        metaKey: true,
      }),
    ).toBe(false);
    expect(isTerminalShortcutTarget(document.body)).toBe(false);
    expect(isMonacoShortcutTarget(document.body)).toBe(false);
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
