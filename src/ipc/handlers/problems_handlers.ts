import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import {
  runTypeScriptCheck,
  getTypeCheckPreconditionGuidance,
  getTypeCheckPreconditionKind,
} from "../processors/tsc";
import { getDyadAppPath } from "@/paths/paths";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { miscContracts } from "../types/misc";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("problems_handlers");

export function registerProblemsHandlers() {
  createTypedHandler(miscContracts.checkProblems, async (_, params) => {
    let appPath = "";
    try {
      // Get the app to find its path
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.appId),
      });

      if (!app) {
        throw new DyadError(
          `App not found: ${params.appId}`,
          DyadErrorKind.NotFound,
        );
      }

      appPath = getDyadAppPath(app.path);

      const problemReport = await runTypeScriptCheck({ appPath });

      return problemReport;
    } catch (error) {
      const preconditionKind = getTypeCheckPreconditionKind(error);
      if (preconditionKind) {
        if (!appPath) {
          throw error;
        }

        const message = await getTypeCheckPreconditionGuidance({
          kind: preconditionKind,
          appPath,
        });
        logger.info("Type checking precondition failed:", message);
        throw new DyadError(message, DyadErrorKind.Precondition, {
          cause: error,
        });
      }

      logger.error("Error checking problems:", error);
      throw error;
    }
  });
}
