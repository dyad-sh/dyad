import fs from "node:fs";
import path from "node:path";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { planContracts } from "../types/plan";
import { questionnaireResolver } from "../../pro/main/ipc/handlers/local_agent/userInputResolvers";
import { buildFrontmatter, validatePlanId, parsePlanFile } from "./planUtils";
import {
  normalizePlanStatus,
  planDirForAppPath,
  savePlanToDisk,
} from "./planPersistence";
import { ensureDyadGitignored } from "./gitignoreUtils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("plan_handlers");

async function getAppPath(appId: number): Promise<string> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  return getDyadAppPath(app.path);
}

async function getPlanDir(appId: number): Promise<string> {
  const appPath = await getAppPath(appId);
  const planDir = planDirForAppPath(appPath);
  await fs.promises.mkdir(planDir, { recursive: true });
  await ensureDyadGitignored(appPath);
  return planDir;
}

export function registerPlanHandlers() {
  createTypedHandler(planContracts.createPlan, async (_, params) => {
    const { appId, chatId, title, summary, content } = params;
    const appPath = await getAppPath(appId);
    // Accepting a plan promotes the (possibly already-persisted) draft to
    // "accepted" and returns its stable per-chat slug.
    const slug = await savePlanToDisk({
      appPath,
      chatId,
      title,
      summary,
      content,
      status: "accepted",
    });

    logger.info(
      "Accepted plan:",
      slug,
      "for app:",
      appId,
      "with title:",
      title,
    );

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
        throw new DyadError(
          `Plan not found: ${planId}`,
          DyadErrorKind.NotFound,
        );
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
      status: normalizePlanStatus(meta.status),
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

      // A chat normally has a single stable-slug plan file, but legacy
      // timestamped files may coexist. Pick the most recently updated one so
      // filename ordering can't surface a stale plan over a newer draft.
      const parsed = await Promise.all(
        matches.map(async (file) => {
          const raw = await fs.promises.readFile(
            path.join(planDir, file),
            "utf-8",
          );
          return { slug: file.replace(/\.md$/, ""), ...parsePlanFile(raw) };
        }),
      );
      parsed.sort((a, b) =>
        (a.meta.updatedAt ?? "").localeCompare(b.meta.updatedAt ?? ""),
      );
      const { slug, meta, content } = parsed[parsed.length - 1];

      return {
        id: slug,
        appId,
        chatId: meta.chatId ? Number(meta.chatId) : chatId,
        title: meta.title ?? "",
        summary: meta.summary || null,
        content,
        status: normalizePlanStatus(meta.status),
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
        throw new DyadError(
          `Plan not found: ${planId}`,
          DyadErrorKind.NotFound,
        );
      }
      throw err;
    }
    logger.info("Deleted plan:", planId);
  });

  createTypedHandler(
    planContracts.respondToQuestionnaire,
    async (_, params) => {
      questionnaireResolver.resolve(params.requestId, params.answers);
    },
  );
}
