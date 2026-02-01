import fs from "node:fs";
import path from "node:path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { planContracts } from "../types/plan";

const logger = log.scope("plan_handlers");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

async function getPlanDir(appId: number): Promise<string> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  const appPath = getDyadAppPath(app.path);
  const planDir = path.join(appPath, ".dyad", "plans");
  await fs.promises.mkdir(planDir, { recursive: true });
  return planDir;
}

function buildFrontmatter(meta: Record<string, string>): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: "${v}"`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function parsePlanFile(raw: string): {
  meta: Record<string, string>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n+([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      meta[key] = val;
    }
  }
  return { meta, content: match[2].trim() };
}

export function registerPlanHandlers() {
  createTypedHandler(planContracts.createPlan, async (_, params) => {
    const { appId, chatId, title, summary, content } = params;
    const planDir = await getPlanDir(appId);
    const now = new Date().toISOString();
    const slug = `${slugify(title)}-${Date.now()}`;

    const frontmatter = buildFrontmatter({
      title,
      summary: summary ?? "",
      status: "draft",
      chatId: String(chatId ?? ""),
      createdAt: now,
      updatedAt: now,
    });

    const filePath = path.join(planDir, `${slug}.md`);
    await fs.promises.writeFile(filePath, frontmatter + content, "utf-8");

    logger.info("Created plan:", slug, "for app:", appId, "with title:", title);

    return slug;
  });

  createTypedHandler(planContracts.getPlan, async (_, { appId, planId }) => {
    const planDir = await getPlanDir(appId);
    const filePath = path.join(planDir, `${planId}.md`);
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const { meta, content } = parsePlanFile(raw);

    return {
      id: planId,
      appId,
      chatId: meta.chatId ? Number(meta.chatId) : null,
      title: meta.title ?? "",
      summary: meta.summary || null,
      content,
      status:
        (meta.status as "draft" | "accepted" | "rejected" | "implemented") ??
        "draft",
      createdAt: meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
    };
  });

  createTypedHandler(planContracts.getPlansForApp, async (_, appId) => {
    const planDir = await getPlanDir(appId);
    let files: string[];
    try {
      files = await fs.promises.readdir(planDir);
    } catch {
      return [];
    }

    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const plans = await Promise.all(
      mdFiles.map(async (file) => {
        const filePath = path.join(planDir, file);
        const raw = await fs.promises.readFile(filePath, "utf-8");
        const { meta, content } = parsePlanFile(raw);
        const slug = file.replace(/\.md$/, "");

        return {
          id: slug,
          appId,
          chatId: meta.chatId ? Number(meta.chatId) : null,
          title: meta.title ?? "",
          summary: meta.summary || null,
          content,
          status:
            (meta.status as
              | "draft"
              | "accepted"
              | "rejected"
              | "implemented") ?? "draft",
          createdAt: meta.createdAt ?? new Date().toISOString(),
          updatedAt: meta.updatedAt ?? new Date().toISOString(),
        };
      }),
    );

    // Sort by createdAt descending
    plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return plans;
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

      // Find the first plan that matches the chatId
      for (const file of mdFiles) {
        const filePath = path.join(planDir, file);
        const raw = await fs.promises.readFile(filePath, "utf-8");
        const { meta, content } = parsePlanFile(raw);
        const planChatId = meta.chatId ? Number(meta.chatId) : null;

        if (planChatId === chatId) {
          const slug = file.replace(/\.md$/, "");
          return {
            id: slug,
            appId,
            chatId: planChatId,
            title: meta.title ?? "",
            summary: meta.summary || null,
            content,
            status:
              (meta.status as
                | "draft"
                | "accepted"
                | "rejected"
                | "implemented") ?? "draft",
            createdAt: meta.createdAt ?? new Date().toISOString(),
            updatedAt: meta.updatedAt ?? new Date().toISOString(),
          };
        }
      }

      return null;
    },
  );

  createTypedHandler(planContracts.updatePlan, async (_, params) => {
    const { appId, id, ...updates } = params;
    const planDir = await getPlanDir(appId);
    const filePath = path.join(planDir, `${id}.md`);
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const { meta, content } = parsePlanFile(raw);

    if (updates.title !== undefined) meta.title = updates.title;
    if (updates.summary !== undefined) meta.summary = updates.summary;
    if (updates.status !== undefined) meta.status = updates.status;
    meta.updatedAt = new Date().toISOString();

    const newContent =
      updates.content !== undefined ? updates.content : content;
    const frontmatter = buildFrontmatter(meta);
    await fs.promises.writeFile(filePath, frontmatter + newContent, "utf-8");

    logger.info("Updated plan:", id);
  });

  createTypedHandler(planContracts.deletePlan, async (_, { appId, planId }) => {
    const planDir = await getPlanDir(appId);
    const filePath = path.join(planDir, `${planId}.md`);
    await fs.promises.unlink(filePath);
    logger.info("Deleted plan:", planId);
  });

  logger.debug("Registered plan IPC handlers");
}
