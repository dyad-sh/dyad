import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowSessionId } from "../types";
import {
  clearWindowSessionPersistence,
  forgetWindowSessionBestEffort,
  getWindowSessionFilePath,
  MAX_PRODUCT_WINDOWS,
  prepareWindowSessionForCreation,
  rememberWindowSessionBestEffort,
  restorableVisibleEntity,
  WindowSessionPersistence,
} from "./window_session_persistence";

const temporaryDirectories: string[] = [];
const session = (suffix: number) =>
  `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}` as WindowSessionId;

function createPersistence(): WindowSessionPersistence {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-windows-"));
  temporaryDirectories.push(directory);
  return new WindowSessionPersistence(path.join(directory, "sessions.json"));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("WindowSessionPersistence", () => {
  it("restores multiple stable window identities and their visible entities", () => {
    const persistence = createPersistence();
    persistence.remember(session(1), { kind: "app", id: 7 });
    persistence.remember(session(2), { kind: "app", id: 9 });

    expect(persistence.read()).toEqual([
      {
        windowSessionId: session(1),
        visibleEntity: { kind: "app", id: 7 },
      },
      {
        windowSessionId: session(2),
        visibleEntity: { kind: "app", id: 9 },
      },
    ]);
  });

  it("prefers the selected chat when persisting a visible chat route", () => {
    expect(
      restorableVisibleEntity([
        { kind: "app", id: 7 },
        { kind: "chat", id: 11 },
      ]),
    ).toEqual({ kind: "chat", id: 11 });
    expect(restorableVisibleEntity([{ kind: "app", id: 7 }])).toEqual({
      kind: "app",
      id: 7,
    });
  });

  it("updates and removes one window without replacing the other sessions", () => {
    const persistence = createPersistence();
    persistence.remember(session(1), { kind: "app", id: 7 });
    persistence.remember(session(2));
    persistence.remember(session(1), { kind: "app", id: 8 });
    persistence.forget(session(2));

    expect(persistence.read()).toEqual([
      {
        windowSessionId: session(1),
        visibleEntity: { kind: "app", id: 8 },
      },
    ]);
  });

  it("recovers from a malformed session file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-windows-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "sessions.json");
    fs.writeFileSync(filePath, "{not-json", "utf8");

    expect(new WindowSessionPersistence(filePath).read()).toEqual([]);
  });

  it("rejects a session beyond the supported product-window capacity", () => {
    const persistence = createPersistence();
    for (let index = 1; index <= MAX_PRODUCT_WINDOWS; index += 1) {
      persistence.remember(session(index), { kind: "app", id: index });
    }

    expect(() =>
      persistence.remember(session(MAX_PRODUCT_WINDOWS + 1), {
        kind: "app",
        id: MAX_PRODUCT_WINDOWS + 1,
      }),
    ).toThrow("Window session capacity exceeded");
    expect(persistence.read()).toHaveLength(MAX_PRODUCT_WINDOWS);
  });

  it("continues with an unpersisted startup window when persistence fails", () => {
    const persistence = {
      read: () => [],
      remember: () => {
        throw new Error("read-only user data");
      },
    } as unknown as WindowSessionPersistence;
    const onFailure = vi.fn();

    expect(
      prepareWindowSessionForCreation({
        persistence,
        descriptor: { windowSessionId: session(1) },
        failurePolicy: "continue",
        onFailure,
      }),
    ).toEqual({ wasAlreadyPersisted: false, wasPersisted: false });
    expect(onFailure).toHaveBeenCalledWith(new Error("read-only user data"));
  });

  it("rejects an explicit new window when persistence fails", () => {
    const persistence = {
      read: () => [],
      remember: () => {
        throw new Error("read-only user data");
      },
    } as unknown as WindowSessionPersistence;

    expect(() =>
      prepareWindowSessionForCreation({
        persistence,
        descriptor: { windowSessionId: session(1) },
        failurePolicy: "throw",
      }),
    ).toThrow("read-only user data");
  });

  it("treats visible-route persistence as best-effort", () => {
    const persistence = {
      remember: () => {
        throw new Error("disk full");
      },
    } as unknown as WindowSessionPersistence;
    const onFailure = vi.fn();

    expect(
      rememberWindowSessionBestEffort({
        persistence,
        windowSessionId: session(1),
        visibleEntity: { kind: "chat", id: 11 },
        onFailure,
      }),
    ).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(new Error("disk full"));
  });

  it("treats closed-window persistence cleanup as best-effort", () => {
    const persistence = {
      forget: () => {
        throw new Error("read-only user data");
      },
    } as unknown as WindowSessionPersistence;
    const onFailure = vi.fn();

    expect(
      forgetWindowSessionBestEffort({
        persistence,
        windowSessionId: session(1),
        onFailure,
      }),
    ).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(new Error("read-only user data"));
  });

  it("clears durable and temporary window session files during reset", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-windows-"));
    temporaryDirectories.push(directory);
    const filePath = getWindowSessionFilePath(directory);
    fs.writeFileSync(filePath, "durable", "utf8");
    fs.writeFileSync(`${filePath}.tmp`, "temporary", "utf8");

    await clearWindowSessionPersistence(directory);

    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });
});
