import { db } from "../../db";
import { plans } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { planContracts } from "../types/plan";

const logger = log.scope("plan_handlers");

export function registerPlanHandlers() {
  createTypedHandler(planContracts.createPlan, async (_, params) => {
    const { appId, chatId, title, summary, content } = params;

    const [plan] = await db
      .insert(plans)
      .values({
        appId,
        chatId: chatId ?? null,
        title,
        summary: summary ?? null,
        content,
        status: "draft",
      })
      .returning();

    logger.info(
      "Created plan:",
      plan.id,
      "for app:",
      appId,
      "with title:",
      title,
    );

    return plan.id;
  });

  createTypedHandler(planContracts.getPlan, async (_, planId) => {
    const plan = await db.query.plans.findFirst({
      where: eq(plans.id, planId),
    });

    if (!plan) {
      throw new Error("Plan not found");
    }

    return {
      id: plan.id,
      appId: plan.appId,
      chatId: plan.chatId,
      title: plan.title,
      summary: plan.summary,
      content: plan.content,
      status: plan.status as "draft" | "accepted" | "rejected" | "implemented",
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  });

  createTypedHandler(planContracts.getPlansForApp, async (_, appId) => {
    const appPlans = await db.query.plans.findMany({
      where: eq(plans.appId, appId),
      orderBy: [desc(plans.createdAt)],
    });

    return appPlans.map((plan) => ({
      id: plan.id,
      appId: plan.appId,
      chatId: plan.chatId,
      title: plan.title,
      summary: plan.summary,
      content: plan.content,
      status: plan.status as "draft" | "accepted" | "rejected" | "implemented",
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    }));
  });

  createTypedHandler(planContracts.updatePlan, async (_, params) => {
    const { id, ...updates } = params;

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.summary !== undefined) updateData.summary = updates.summary;
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.status !== undefined) updateData.status = updates.status;
    updateData.updatedAt = new Date();

    await db.update(plans).set(updateData).where(eq(plans.id, id));

    logger.info("Updated plan:", id);
  });

  createTypedHandler(planContracts.deletePlan, async (_, planId) => {
    await db.delete(plans).where(eq(plans.id, planId));
    logger.info("Deleted plan:", planId);
  });

  logger.debug("Registered plan IPC handlers");
}
