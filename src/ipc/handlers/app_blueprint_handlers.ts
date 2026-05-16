import crypto from "node:crypto";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { createTypedHandler } from "./base";
import {
  appBlueprintContracts,
  type AppBlueprintData,
  type AppBlueprintVisual,
} from "../types/app_blueprint";
import { safeSend } from "../utils/safe_sender";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { db } from "../../db";
import { apps, chats } from "../../db/schema";

const logger = log.scope("app_blueprint_handlers");

// In-memory store for app blueprint data (keyed by chatId)
const appBlueprintStore = new Map<
  number,
  AppBlueprintData & { approved: boolean }
>();

export function getAppBlueprintForChat(chatId: number) {
  return appBlueprintStore.get(chatId);
}

export function setAppBlueprintForChat(chatId: number, data: AppBlueprintData) {
  appBlueprintStore.set(chatId, { ...data, approved: false });
}

export function deleteAppBlueprintForChat(chatId: number) {
  appBlueprintStore.delete(chatId);
}

export function updateAppBlueprintVisuals(
  chatId: number,
  visuals: AppBlueprintVisual[],
) {
  const plan = appBlueprintStore.get(chatId);
  if (plan) {
    plan.visuals = visuals;
  }
}

export function registerAppBlueprintHandlers() {
  createTypedHandler(appBlueprintContracts.approve, async (event, params) => {
    const plan = appBlueprintStore.get(params.chatId);
    if (!plan) {
      logger.warn(
        `No app blueprint found for chat ${params.chatId} on approve`,
      );
      return;
    }

    plan.approved = true;
    logger.info(`App blueprint approved for chat ${params.chatId}`);

    // Flip the per-app needs_app_blueprint flag so future chats in this app
    // skip the blueprint flow.
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, params.chatId),
      columns: { appId: true },
    });
    if (chat) {
      await db
        .update(apps)
        .set({ needsAppBlueprint: false })
        .where(eq(apps.id, chat.appId));
    } else {
      logger.warn(
        `Chat ${params.chatId} not found when clearing needsAppBlueprint`,
      );
    }

    // Notify renderer that approval is confirmed
    safeSend(event.sender, "app-blueprint:approved", {
      chatId: params.chatId,
    });
  });

  createTypedHandler(appBlueprintContracts.editField, async (_, params) => {
    const plan = appBlueprintStore.get(params.chatId);
    if (!plan) {
      logger.warn(
        `No app blueprint found for chat ${params.chatId} when editing field ${params.field}`,
      );
      return;
    }

    if (plan.approved) {
      logger.warn(
        `Cannot edit approved app blueprint for chat ${params.chatId}`,
      );
      return;
    }

    switch (params.field) {
      case "appName":
        plan.appName = params.value;
        break;
      case "templateId":
        plan.templateId = params.value;
        break;
      case "themeId":
        plan.themeId = params.value;
        break;
      case "designDirection":
        plan.designDirection = params.value;
        break;
      case "primaryColor":
        plan.primaryColor = params.value;
        break;
      default:
        logger.warn(`Unknown app blueprint field: ${params.field}`);
    }
  });

  createTypedHandler(appBlueprintContracts.editVisual, async (_, params) => {
    const plan = appBlueprintStore.get(params.chatId);
    if (!plan) {
      logger.warn(
        `No app blueprint found for chat ${params.chatId} when editing visual ${params.field}`,
      );
      return;
    }

    if (plan.approved) {
      logger.warn(
        `Cannot edit approved app blueprint for chat ${params.chatId}`,
      );
      return;
    }

    const visual = plan.visuals.find((v) => v.id === params.visualId);
    if (!visual) {
      logger.warn(
        `Visual ${params.visualId} not found in app blueprint for chat ${params.chatId}`,
      );
      return;
    }

    visual[params.field] = params.value;
  });

  createTypedHandler(appBlueprintContracts.addVisual, async (_, params) => {
    const plan = appBlueprintStore.get(params.chatId);
    if (!plan) {
      throw new DyadError(
        `No app blueprint found for chat ${params.chatId} when adding visual`,
        DyadErrorKind.NotFound,
      );
    }

    if (plan.approved) {
      throw new DyadError(
        `Cannot add visual to approved app blueprint for chat ${params.chatId}`,
        DyadErrorKind.Precondition,
      );
    }

    const visualId = `visual_${crypto.randomUUID().split("-")[0]}`;
    plan.visuals.push({
      id: visualId,
      type: params.type,
      description: params.description,
      prompt: params.prompt,
    });

    return { visualId };
  });

  createTypedHandler(appBlueprintContracts.removeVisual, async (_, params) => {
    const plan = appBlueprintStore.get(params.chatId);
    if (!plan) {
      logger.warn(
        `No app blueprint found for chat ${params.chatId} when removing visual`,
      );
      return;
    }

    if (plan.approved) {
      logger.warn(
        `Cannot remove visual from approved app blueprint for chat ${params.chatId}`,
      );
      return;
    }

    plan.visuals = plan.visuals.filter((v) => v.id !== params.visualId);
  });
}
