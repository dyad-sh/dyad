import fs from "node:fs";
import path from "node:path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { designContracts, StoredDesignSpecSchema } from "../types/design";
import type { StoredDesignSpec } from "../types/design";
import { ensureDyadGitignored } from "./gitignoreUtils";
import { withLock } from "../utils/lock_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("design_handlers");

async function getDesignDir(appId: number): Promise<string> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  const appPath = getDyadAppPath(app.path);
  const designDir = path.join(appPath, ".dyad", "design");
  await fs.promises.mkdir(designDir, { recursive: true });
  await ensureDyadGitignored(appPath);
  return designDir;
}

// One design spec per chat, keyed by chatId. chatId is a validated number so
// there is no path-traversal risk in the filename.
function getDesignFilePath(designDir: string, chatId: number): string {
  return path.join(designDir, `chat-${chatId}.json`);
}

async function readDesignSpec(
  filePath: string,
): Promise<StoredDesignSpec | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
  const parsed = StoredDesignSpecSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    logger.warn("Ignoring invalid design spec file:", filePath, parsed.error);
    return null;
  }
  return parsed.data;
}

export function registerDesignHandlers() {
  createTypedHandler(
    designContracts.saveDesignSpec,
    async (_, { appId, chatId, spec }) => {
      const designDir = await getDesignDir(appId);
      const filePath = getDesignFilePath(designDir, chatId);

      // Serialize writes per chat so concurrent tool calls (e.g. rapid
      // write_design_spec updates while images generate) don't clobber.
      return withLock(`design:${appId}:${chatId}`, async () => {
        const existing = await readDesignSpec(filePath);
        const now = new Date().toISOString();
        const stored: StoredDesignSpec = {
          ...spec,
          appId,
          chatId,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await fs.promises.writeFile(
          filePath,
          JSON.stringify(stored, null, 2),
          "utf-8",
        );
        logger.info(
          "Saved design spec for app:",
          appId,
          "chat:",
          chatId,
          "interfaces:",
          spec.interfaces.length,
        );
        return stored;
      });
    },
  );

  createTypedHandler(
    designContracts.getDesignForChat,
    async (_, { appId, chatId }) => {
      const designDir = await getDesignDir(appId);
      const filePath = getDesignFilePath(designDir, chatId);
      return readDesignSpec(filePath);
    },
  );

  createTypedHandler(
    designContracts.deleteDesignSpec,
    async (_, { appId, chatId }) => {
      const designDir = await getDesignDir(appId);
      const filePath = getDesignFilePath(designDir, chatId);
      try {
        await fs.promises.unlink(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
      logger.info("Deleted design spec for app:", appId, "chat:", chatId);
    },
  );
}
