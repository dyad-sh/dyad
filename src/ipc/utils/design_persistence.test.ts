import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getDesignFilePath,
  loadDesignState,
  saveDesignBrief,
  saveDesignInterface,
} from "./design_persistence";
import type {
  DesignBriefData,
  DesignInterfaceData,
} from "@/ipc/types/design";

// electron-log pulls in electron; stub it so the module loads under vitest.
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), debug: vi.fn(), log: vi.fn() }) },
}));

const brief: DesignBriefData = {
  appName: "FreshBite",
  userPrompt: "A restaurant website",
  designDirection: "Warm and appetizing.",
  palette: {
    primary: "#E85D04",
    secondary: "#6A040F",
    accent: "#FFBA08",
    background: "#FFFDF9",
    surface: "#FFFFFF",
    text: "#1B1B1B",
  },
  typography: { headingFont: "Poppins", bodyFont: "Inter" },
  interfaces: [{ id: "screen_1", name: "Landing page" }],
};

function iface(id: string, name: string): DesignInterfaceData {
  return {
    id,
    name,
    width: 1440,
    height: 1024,
    background: "#FFFDF9",
    nodes: [{ id: "n1", type: "text", x: 10, y: 10, text: name }],
  };
}

let appPath: string;
const chatId = 42;

beforeEach(async () => {
  appPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "design-persist-"));
});

afterEach(async () => {
  await fs.promises.rm(appPath, { recursive: true, force: true });
});

describe("design_persistence", () => {
  it("writes under <appPath>/.dyad/designs/<chatId>.json", () => {
    expect(getDesignFilePath(appPath, chatId)).toBe(
      path.join(appPath, ".dyad", "designs", "42.json"),
    );
  });

  it("returns an empty state when nothing is saved", async () => {
    expect(await loadDesignState(appPath, chatId)).toEqual({
      brief: null,
      interfaces: [],
    });
  });

  it("round-trips a saved brief", async () => {
    await saveDesignBrief(appPath, chatId, brief);
    const state = await loadDesignState(appPath, chatId);
    expect(state.brief?.appName).toBe("FreshBite");
    expect(state.interfaces).toEqual([]);
  });

  it("appends interfaces in order and preserves the brief", async () => {
    await saveDesignBrief(appPath, chatId, brief);
    await saveDesignInterface(appPath, chatId, iface("a", "Landing"));
    await saveDesignInterface(appPath, chatId, iface("b", "Menu"));
    const state = await loadDesignState(appPath, chatId);
    expect(state.brief?.appName).toBe("FreshBite");
    expect(state.interfaces.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("upserts an interface with an existing id in place", async () => {
    await saveDesignInterface(appPath, chatId, iface("a", "Landing"));
    await saveDesignInterface(appPath, chatId, iface("b", "Menu"));
    await saveDesignInterface(appPath, chatId, iface("a", "Landing v2"));
    const state = await loadDesignState(appPath, chatId);
    expect(state.interfaces.map((i) => i.id)).toEqual(["a", "b"]);
    expect(state.interfaces[0].name).toBe("Landing v2");
  });

  it("recovers from a corrupt file by returning an empty state", async () => {
    const filePath = getDesignFilePath(appPath, chatId);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, "{ not valid json", "utf-8");
    expect(await loadDesignState(appPath, chatId)).toEqual({
      brief: null,
      interfaces: [],
    });
  });
});
