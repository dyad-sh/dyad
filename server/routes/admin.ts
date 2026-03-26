/**
 * Admin API routes (admin role required).
 *
 * GET  /admin/users              — list all users with subscription info
 * GET  /admin/users/:id          — get single user
 * DELETE /admin/users/:id        — delete user and all their data
 * POST /admin/users/:id/set-plan — override a user's plan
 * GET  /admin/stats              — aggregate usage stats
 */

import { Router } from "express";
import { db } from "../../src/db";
import { users, subscriptions, apps, chats, messages } from "../../src/db/schema";
import { eq, count, desc } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";

export const adminRouter = Router();

// All admin routes require admin role
adminRouter.use(requireAdmin);

// ── GET /admin/users ──────────────────────────────────────────────────────────

adminRouter.get("/users", async (_req, res) => {
  try {
    const allUsers = await db.query.users.findMany({
      orderBy: [desc(users.createdAt)],
      with: { subscription: true },
      columns: {
        passwordHash: false,
      },
    });

    res.json({ ok: true, data: allUsers });
  } catch (err) {
    console.error("[admin/users]", err);
    res.status(500).json({ ok: false, error: "Failed to fetch users" });
  }
});

// ── GET /admin/users/:id ──────────────────────────────────────────────────────

adminRouter.get("/users/:id", async (req, res) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.params.id),
      with: { subscription: true },
      columns: { passwordHash: false },
    });

    if (!user) {
      res.status(404).json({ ok: false, error: "User not found" });
      return;
    }

    const appCount = await db
      .select({ count: count() })
      .from(apps)
      .where(eq(apps.userId, req.params.id));

    res.json({ ok: true, data: { ...user, appCount: appCount[0]?.count ?? 0 } });
  } catch (err) {
    console.error("[admin/users/:id]", err);
    res.status(500).json({ ok: false, error: "Failed to fetch user" });
  }
});

// ── DELETE /admin/users/:id ───────────────────────────────────────────────────

adminRouter.delete("/users/:id", async (req, res) => {
  try {
    await db.delete(users).where(eq(users.id, req.params.id));
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin/users/:id DELETE]", err);
    res.status(500).json({ ok: false, error: "Failed to delete user" });
  }
});

// ── POST /admin/users/:id/set-plan ────────────────────────────────────────────

adminRouter.post("/users/:id/set-plan", async (req, res) => {
  try {
    const { plan } = req.body as { plan?: "free" | "pro" };
    if (!plan || !["free", "pro"].includes(plan)) {
      res.status(400).json({ ok: false, error: "Invalid plan" });
      return;
    }

    await db
      .update(subscriptions)
      .set({ plan, updatedAt: new Date() })
      .where(eq(subscriptions.userId, req.params.id));

    res.json({ ok: true });
  } catch (err) {
    console.error("[admin/users/:id/set-plan]", err);
    res.status(500).json({ ok: false, error: "Failed to update plan" });
  }
});

// ── GET /admin/stats ──────────────────────────────────────────────────────────

adminRouter.get("/stats", async (_req, res) => {
  try {
    const [totalUsers] = await db.select({ count: count() }).from(users);
    const [totalApps] = await db.select({ count: count() }).from(apps);
    const [totalMessages] = await db.select({ count: count() }).from(messages);

    const [proUsers] = await db
      .select({ count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.plan, "pro"));

    res.json({
      ok: true,
      data: {
        totalUsers: totalUsers?.count ?? 0,
        proUsers: proUsers?.count ?? 0,
        freeUsers: (totalUsers?.count ?? 0) - (proUsers?.count ?? 0),
        totalApps: totalApps?.count ?? 0,
        totalMessages: totalMessages?.count ?? 0,
      },
    });
  } catch (err) {
    console.error("[admin/stats]", err);
    res.status(500).json({ ok: false, error: "Failed to fetch stats" });
  }
});
