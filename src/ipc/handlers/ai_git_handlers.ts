import { ipcMain, IpcMainInvokeEvent } from "electron";
import { getModelClient } from "../utils/get_model_client";
import { readSettings } from "../../main/settings";
import { generateText } from "ai";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log";

const logger = log.scope("ai_git_handlers");

interface ResolveConflictParams {
  appId: number;
  filePath: string;
}

async function handleResolveConflict(
  event: IpcMainInvokeEvent,
  { appId, filePath }: ResolveConflictParams,
): Promise<{ success: boolean; resolution?: string; error?: string }> {
  try {
    const settings = readSettings();
    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app) throw new Error("App not found");
    const appPath = getDyadAppPath(app.path);
    const fullPath = path.join(appPath, filePath);

    // Read the file content which should contain conflict markers
    const fileContent = await fs.readFile(fullPath, "utf-8");

    // Check if file actually has conflict markers
    if (!fileContent.includes("<<<<<<<") || !fileContent.includes("=======")) {
      return {
        success: false,
        error: "File does not appear to contain standard git conflict markers.",
      };
    }

    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    const prompt = `
You are an expert software engineer helping to resolve a git merge conflict.
The following file contains git conflict markers (<<<<<<<, =======, >>>>>>>).
Please analyze the conflicting changes and provide a resolved version of the code.
Do not include any markdown formatting or explanations in your final output, just the raw code.
If you need to explain your choice, do so in comments within the code.
Ensure the code is syntactically correct and logically sound, combining the best of both changes if possible, or choosing the most appropriate one.

File Content:
${fileContent}
    `;

    const { text } = await generateText({
      model: modelClient.model,
      prompt: prompt,
    });

    // Clean up markdown code blocks if the AI added them despite instructions
    let cleanCode = text;
    if (cleanCode.startsWith("```")) {
      cleanCode = cleanCode.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "");
    }

    return { success: true, resolution: cleanCode };
  } catch (err: any) {
    logger.error("Error resolving conflict:", err);
    return {
      success: false,
      error: err.message || "Failed to resolve conflict with AI.",
    };
  }
}

export function registerAiGitHandlers() {
  ipcMain.handle("ai:resolve-conflict", handleResolveConflict);
}
