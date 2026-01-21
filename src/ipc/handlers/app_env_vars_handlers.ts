/**
 * DO NOT USE LOGGER HERE.
 * Environment variables are sensitive and should not be logged.
 */
import * as fs from "fs";
import * as path from "path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import {
  ENV_FILE_NAME,
  parseEnvFile,
  serializeEnvFile,
} from "../utils/app_env_var_utils";
import { createTypedHandler } from "./base";
import { miscContracts } from "../types/misc";

export function registerAppEnvVarsHandlers() {
  // Handler to get app environment variables
  createTypedHandler(miscContracts.getAppEnvVars, async (_, { appId }) => {
    try {
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const appPath = getDyadAppPath(app.path);
      const envFilePath = path.join(appPath, ENV_FILE_NAME);

      // If .env.local doesn't exist, return empty array
      try {
        await fs.promises.access(envFilePath);
      } catch {
        return [];
      }

      const content = await fs.promises.readFile(envFilePath, "utf8");
      const envVars = parseEnvFile(content);

      return envVars;
    } catch (error) {
      console.error("Error getting app environment variables:", error);
      throw new Error(
        `Failed to get environment variables: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  });

  // Handler to set app environment variables
  createTypedHandler(
    miscContracts.setAppEnvVars,
    async (_, { appId, envVars }) => {
      try {
        const app = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
        });

        if (!app) {
          throw new Error("App not found");
        }

        const appPath = getDyadAppPath(app.path);
        const envFilePath = path.join(appPath, ENV_FILE_NAME);

        // Serialize environment variables to .env.local format
        const content = serializeEnvFile(envVars);

        // Write to .env.local file
        await fs.promises.writeFile(envFilePath, content, "utf8");
      } catch (error) {
        console.error("Error setting app environment variables:", error);
        throw new Error(
          `Failed to set environment variables: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    },
  );
}
