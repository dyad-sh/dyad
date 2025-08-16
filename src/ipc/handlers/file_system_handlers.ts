import { ipcHost } from "../ipc_host";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";

async function getAppPath(appId: number): Promise<string> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!app) {
    throw new Error(`App with id ${appId} not found.`);
  }
  return app.path;
}

export function registerFileSystemHandlers() {
  ipcHost.handle(
    "fs:readFile",
    async (_, { appId, filePath }: { appId: number; filePath: string }) => {
      try {
        const appPath = await getAppPath(appId);
        const absolutePath = path.join(appPath, filePath);

        if (!absolutePath.startsWith(appPath)) {
          throw new Error("File access is restricted to the app directory.");
        }

        const content = await fs.readFile(absolutePath, "utf-8");
        return { success: true, content };
      } catch (error) {
        console.error(`Error reading file: ${filePath}`, error);
        if (error instanceof Error) {
          return { success: false, error: error.message };
        }
        return { success: false, error: "An unknown error occurred" };
      }
    },
  );

  ipcHost.handle(
    "fs:writeFile",
    async (
      _,
      {
        appId,
        filePath,
        content,
      }: { appId: number; filePath: string; content: string },
    ) => {
      try {
        const appPath = await getAppPath(appId);
        const absolutePath = path.join(appPath, filePath);

        if (!absolutePath.startsWith(appPath)) {
          throw new Error("File access is restricted to the app directory.");
        }

        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf-8");
        return { success: true };
      } catch (error) {
        console.error(`Error writing file: ${filePath}`, error);
        if (error instanceof Error) {
          return { success: false, error: error.message };
        }
        return { success: false, error: "An unknown error occurred" };
      }
    },
  );
}
