/**
 * Design persistence utilities.
 *
 * Design mode produces a global brief plus one scene graph per interface. These
 * live in a Jotai atom in the renderer for the session, but that state is lost
 * on reload. To make mockups survive across turns and restarts we mirror them to
 * disk under the app's `.dyad/` directory (the same convention todos use).
 *
 * Layout: `<appPath>/.dyad/designs/<chatId>.json`
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import {
  DesignBriefDataSchema,
  DesignInterfaceDataSchema,
  DesignStateSchema,
  type DesignBriefData,
  type DesignInterfaceData,
  type DesignState,
} from "@/ipc/types/design";

const logger = log.scope("design_persistence");

const EMPTY_STATE: DesignState = { brief: null, interfaces: [] };

/**
 * Return the path to the persisted design file for a given chat.
 *
 * Layout: `<appPath>/.dyad/designs/<chatId>.json`
 */
export function getDesignFilePath(appPath: string, chatId: number): string {
  return path.join(appPath, ".dyad", "designs", `${chatId}.json`);
}

/**
 * Load the persisted design state (brief + interfaces) for a chat.
 *
 * Returns an empty state if nothing has been saved yet or the file is corrupt.
 */
export async function loadDesignState(
  appPath: string,
  chatId: number,
): Promise<DesignState> {
  const filePath = getDesignFilePath(appPath, chatId);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = DesignStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
    logger.warn("Unexpected design file format, returning empty state");
    return { ...EMPTY_STATE };
  } catch (err: any) {
    // ENOENT just means no design has been saved for this chat yet.
    if (err?.code === "ENOENT") {
      return { ...EMPTY_STATE };
    }
    logger.warn("Failed to load design state, returning empty:", err);
    return { ...EMPTY_STATE };
  }
}

async function writeDesignState(
  appPath: string,
  chatId: number,
  state: DesignState,
): Promise<void> {
  const filePath = getDesignFilePath(appPath, chatId);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const data = JSON.stringify(
    { ...state, updatedAt: new Date().toISOString() },
    null,
    2,
  );
  await fs.promises.writeFile(filePath, data, "utf-8");
}

/**
 * Persist the committed design brief, preserving any interfaces already saved
 * for the chat. Failures are logged, not thrown — persistence is best-effort and
 * must never break the design tool itself.
 */
export async function saveDesignBrief(
  appPath: string,
  chatId: number,
  brief: DesignBriefData,
): Promise<void> {
  try {
    const validated = DesignBriefDataSchema.parse(brief);
    const state = await loadDesignState(appPath, chatId);
    await writeDesignState(appPath, chatId, {
      ...state,
      brief: validated,
    });
  } catch (err) {
    logger.warn("Failed to save design brief:", err);
  }
}

/**
 * Persist one generated interface, upserting it by id so a re-emitted interface
 * (same id) replaces the prior version in place while preserving order.
 */
export async function saveDesignInterface(
  appPath: string,
  chatId: number,
  iface: DesignInterfaceData,
): Promise<void> {
  try {
    const validated = DesignInterfaceDataSchema.parse(iface);
    const state = await loadDesignState(appPath, chatId);
    const existingIdx = state.interfaces.findIndex(
      (i) => i.id === validated.id,
    );
    const interfaces =
      existingIdx === -1
        ? [...state.interfaces, validated]
        : state.interfaces.map((i, idx) =>
            idx === existingIdx ? validated : i,
          );
    await writeDesignState(appPath, chatId, { ...state, interfaces });
  } catch (err) {
    logger.warn("Failed to save design interface:", err);
  }
}
