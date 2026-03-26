/**
 * GDPR compliance routes.
 *
 * GET  /gdpr/export  — download a JSON archive of all the user's data
 * DELETE /gdpr/me    — permanently delete the user's account and all data
 */

import { Router } from "express";
import { db } from "../../src/db";
import {
  users,
  apps,
  chats,
  messages,
  subscriptions,
  mcpServers,
  prompts,
  customThemes,
} from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { getCurrentUser } from "../../src/ipc/context/user-context";
import { getProteaAIAppsBaseDirectory } from "../../src/paths/paths";
import fs from "node:fs";
import path from "node:path";

export const gdprRouter = Router();

// ── GET /gdpr/export ──────────────────────────────────────────────────────────

gdprRouter.get("/export", requireAuth, async (_req, res) => {
  try {
    const { userId, email } = getCurrentUser()!;

    const [
      userRow,
      userApps,
      userChats,
      userMessages,
      userSubscription,
      userMcpServers,
      userPrompts,
      userThemes,
    ] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { passwordHash: false },
      }),
      db.query.apps.findMany({ where: eq(apps.userId, userId) }),
      db.query.chats.findMany({
        // chats belong to apps; include all chats for user's apps
        with: { app: { columns: { userId: true } } },
      }),
      db.select().from(messages),
      db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) }),
      db.query.mcpServers.findMany({ where: eq(mcpServers.userId, userId) }),
      db.query.prompts.findMany(),
      db.query.customThemes.findMany({ where: eq(customThemes.userId, userId) }),
    ]);

    // Filter chats/messages to only this user's data
    const appIds = new Set(userApps.map((a) => a.id));
    const ownedChats = userChats.filter(
      (c) => c.app && (c.app as { userId: string | null }).userId === userId,
    );
    const chatIds = new Set(ownedChats.map((c) => c.id));
    const ownedMessages = userMessages.filter((m) => chatIds.has(m.chatId));

    const exportData = {
      exportedAt: new Date().toISOString(),
      user: userRow,
      subscription: userSubscription,
      apps: userApps,
      chats: ownedChats,
      messages: ownedMessages,
      mcpServers: userMcpServers,
      themes: userThemes,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="proteaai-export-${email.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}.json"`,
    );
    res.json(exportData);
  } catch (err) {
    console.error("[gdpr/export]", err);
    res.status(500).json({ ok: false, error: "Export failed" });
  }
});

// ── DELETE /gdpr/me ───────────────────────────────────────────────────────────

gdprRouter.delete("/me", requireAuth, async (_req, res) => {
  try {
    const { userId } = getCurrentUser()!;

    // Delete filesystem data for this user's apps
    const userApps = await db.query.apps.findMany({
      where: eq(apps.userId, userId),
    });

    for (const app of userApps) {
      try {
        const userAppsDir = path.join(
          getProteaAIAppsBaseDirectory(),
          userId,
          app.path,
        );
        if (fs.existsSync(userAppsDir)) {
          fs.rmSync(userAppsDir, { recursive: true, force: true });
        }
      } catch (fsErr) {
        console.error(`[gdpr/me] Failed to delete app files for ${app.id}:`, fsErr);
        // Continue deletion even if filesystem cleanup partially fails
      }
    }

    // Delete from DB (cascade handles chats, messages, subscriptions, etc.)
    await db.delete(users).where(eq(users.id, userId));

    res.json({ ok: true, message: "Account and all data deleted" });
  } catch (err) {
    console.error("[gdpr/me]", err);
    res.status(500).json({ ok: false, error: "Account deletion failed" });
  }
});
