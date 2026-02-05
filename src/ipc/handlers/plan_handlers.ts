import fs from "node:fs";
import path from "node:path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { planContracts } from "../types/plan";
import {
  slugify,
  buildFrontmatter,
  validatePlanId,
  parsePlanFile,
  ensureDyadGitignored,
} from "./planUtils";

const logger = log.scope("plan_handlers");

async function getPlanDir(appId: number): Promise<string> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);
  const planDir = path.join(appPath, ".dyad", "plans");
  await fs.promises.mkdir(planDir, { recursive: true });
  await ensureDyadGitignored(appPath);
  return planDir;
}

export function registerPlanHandlers() {
  createTypedHandler(planContracts.createPlan, async (_, params) => {
    const { appId, chatId, title, summary, content } = params;
    const planDir = await getPlanDir(appId);
    const now = new Date().toISOString();
    const slug = `chat-${chatId}-${slugify(title)}-${Date.now()}`;
    validatePlanId(slug);

    const meta: Record<string, string> = {
      title,
      summary: summary ?? "",
      chatId: String(chatId),
      createdAt: now,
      updatedAt: now,
    };
    const frontmatter = buildFrontmatter(meta);

    const filePath = path.join(planDir, `${slug}.md`);
    await fs.promises.writeFile(filePath, frontmatter + content, "utf-8");

    logger.info("Created plan:", slug, "for app:", appId, "with title:", title);

    return slug;
  });

  createTypedHandler(planContracts.getPlan, async (_, { appId, planId }) => {
    validatePlanId(planId);
    const planDir = await getPlanDir(appId);
    const filePath = path.join(planDir, `${planId}.md`);
    let raw: string;
    try {
      raw = await fs.promises.readFile(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Plan not found: ${planId}`);
      }
      throw err;
    }
    const { meta, content } = parsePlanFile(raw);

    return {
      id: planId,
      appId,
      chatId: meta.chatId ? Number(meta.chatId) : null,
      title: meta.title ?? "",
      summary: meta.summary || null,
      content,
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
    };
  });

  createTypedHandler(
    planContracts.getPlanForChat,
    async (_, { appId, chatId }) => {
      const planDir = await getPlanDir(appId);
      let files: string[];
      try {
        files = await fs.promises.readdir(planDir);
      } catch {
        return null;
      }

      const mdFiles = files.filter((f) => f.endsWith(".md"));

      const prefix = `chat-${chatId}-`;
      const matches = mdFiles.filter((f) => f.startsWith(prefix));
      if (matches.length === 0) return null;
      // Sort to get the latest plan (filenames contain timestamps)
      matches.sort();
      const match = matches[matches.length - 1];

      const filePath = path.join(planDir, match);
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const { meta, content } = parsePlanFile(raw);
      const slug = match.replace(/\.md$/, "");
      return {
        id: slug,
        appId,
        chatId: meta.chatId ? Number(meta.chatId) : chatId,
        title: meta.title ?? "",
        summary: meta.summary || null,
        content,
        createdAt: meta.createdAt ?? new Date().toISOString(),
        updatedAt: meta.updatedAt ?? new Date().toISOString(),
      };
    },
  );

  createTypedHandler(planContracts.updatePlan, async (_, params) => {
    const { appId, id, ...updates } = params;
    validatePlanId(id);
    const planDir = await getPlanDir(appId);
    const filePath = path.join(planDir, `${id}.md`);
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const { meta, content } = parsePlanFile(raw);

    if (updates.title !== undefined) meta.title = updates.title;
    if (updates.summary !== undefined) meta.summary = updates.summary;
    meta.updatedAt = new Date().toISOString();

    const newContent =
      updates.content !== undefined ? updates.content : content;
    const frontmatter = buildFrontmatter(meta);
    await fs.promises.writeFile(filePath, frontmatter + newContent, "utf-8");

    logger.info("Updated plan:", id);
  });

  createTypedHandler(planContracts.deletePlan, async (_, { appId, planId }) => {
    validatePlanId(planId);
    const planDir = await getPlanDir(appId);
    const filePath = path.join(planDir, `${planId}.md`);
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Plan not found: ${planId}`);
      }
      throw err;
    }
    logger.info("Deleted plan:", planId);
  });
}
