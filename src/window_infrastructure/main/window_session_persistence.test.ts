import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowSessionId } from "../types";
import {
  MAX_PRODUCT_WINDOWS,
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
});
