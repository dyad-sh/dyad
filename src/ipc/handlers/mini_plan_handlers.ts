import crypto from "node:crypto";
import log from "electron-log";
import { createTypedHandler } from "./base";
import {
  miniPlanContracts,
  type MiniPlanData,
  type MiniPlanVisual,
} from "../types/mini_plan";
import { safeSend } from "../utils/safe_sender";
import { resolveMiniPlanApproval } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";

const logger = log.scope("mini_plan_handlers");

// In-memory store for mini plan data (keyed by chatId)
const miniPlanStore = new Map<number, MiniPlanData & { approved: boolean }>();

export function getMiniPlanForChat(chatId: number) {
  return miniPlanStore.get(chatId);
}

export function setMiniPlanForChat(chatId: number, data: MiniPlanData) {
  miniPlanStore.set(chatId, { ...data, approved: false });
}

export function updateMiniPlanVisuals(
  chatId: number,
  visuals: MiniPlanVisual[],
) {
  const plan = miniPlanStore.get(chatId);
  if (plan) {
    plan.visuals = visuals;
  }
}

export function registerMiniPlanHandlers() {
  createTypedHandler(miniPlanContracts.approve, async (event, params) => {
    const plan = miniPlanStore.get(params.chatId);
    if (plan) {
      plan.approved = true;
      logger.info(`Mini plan approved for chat ${params.chatId}`);

      // Notify renderer that approval is confirmed
      safeSend(event.sender, "mini-plan:approved", {
        chatId: params.chatId,
      });

      // Resolve the pending promise so the agent can continue
      resolveMiniPlanApproval(params.chatId, true);
    }
  });

  createTypedHandler(miniPlanContracts.editField, async (_, params) => {
    const plan = miniPlanStore.get(params.chatId);
    if (!plan) {
      logger.warn(
        `No mini plan found for chat ${params.chatId} when editing field ${params.field}`,
      );
      return;
    }

    if (plan.approved) {
      logger.warn(`Cannot edit approved mini plan for chat ${params.chatId}`);
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
      case "mainColor":
        plan.mainColor = params.value;
        break;
      default:
        logger.warn(`Unknown mini plan field: ${params.field}`);
    }
  });

  createTypedHandler(miniPlanContracts.editVisual, async (_, params) => {
    const plan = miniPlanStore.get(params.chatId);
    if (!plan) {
      logger.warn(
        `No mini plan found for chat ${params.chatId} when editing visual ${params.field}`,
      );
      return;
    }

    if (plan.approved) {
      logger.warn(`Cannot edit approved mini plan for chat ${params.chatId}`);
      return;
    }

    const visual = plan.visuals.find((v) => v.id === params.visualId);
    if (!visual) {
      logger.warn(
        `Visual ${params.visualId} not found in mini plan for chat ${params.chatId}`,
      );
      return;
    }

    visual[params.field] = params.value;
  });

  createTypedHandler(miniPlanContracts.addVisual, async (_, params) => {
    const plan = miniPlanStore.get(params.chatId);
    if (!plan) {
      logger.warn(
        `No mini plan found for chat ${params.chatId} when adding visual`,
      );
      return { visualId: "" };
    }

    if (plan.approved) {
      logger.warn(
        `Cannot add visual to approved mini plan for chat ${params.chatId}`,
      );
      return { visualId: "" };
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

  createTypedHandler(miniPlanContracts.removeVisual, async (_, params) => {
    const plan = miniPlanStore.get(params.chatId);
    if (!plan) {
      logger.warn(
        `No mini plan found for chat ${params.chatId} when removing visual`,
      );
      return;
    }

    if (plan.approved) {
      logger.warn(
        `Cannot remove visual from approved mini plan for chat ${params.chatId}`,
      );
      return;
    }

    plan.visuals = plan.visuals.filter((v) => v.id !== params.visualId);
  });
}
