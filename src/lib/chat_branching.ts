import type { Message } from "@/ipc/ipc_types";

export interface ConversationStepGroup {
  stepKey: string;
  stepNumber: number;
  userVersions: Message[];
  assistantVersions: Message[];
}

export interface MessageVersionMeta {
  stepKey: string;
  totalVersions: number;
  currentIndex: number;
  conversationStep: number;
  assistantMessageId: number | null;
}

export function deriveConversationSteps(
  messages: Message[],
): ConversationStepGroup[] {
  const steps = new Map<string, ConversationStepGroup>();
  let fallbackStep = 0;
  let lastUserStep = 0;

  for (const message of messages) {
    let stepNumber: number;

    if (typeof message.conversationStep === "number") {
      stepNumber = message.conversationStep;
      if (message.role === "user") {
        fallbackStep = Math.max(fallbackStep, stepNumber);
        lastUserStep = stepNumber;
      }
    } else if (message.role === "user") {
      fallbackStep += 1;
      stepNumber = fallbackStep;
      lastUserStep = fallbackStep;
    } else {
      if (lastUserStep === 0) {
        fallbackStep += 1;
        lastUserStep = fallbackStep;
      }
      stepNumber = lastUserStep;
    }

    const stepKey =
      typeof message.conversationStep === "number"
        ? `step-${message.conversationStep}`
        : `auto-${stepNumber}`;

    let group = steps.get(stepKey);
    if (!group) {
      group = {
        stepKey,
        stepNumber,
        userVersions: [],
        assistantVersions: [],
      };
      steps.set(stepKey, group);
    }

    if (message.role === "user") {
      group.userVersions.push(message);
    } else {
      group.assistantVersions.push(message);
    }
  }

  return Array.from(steps.values()).sort((a, b) => a.stepNumber - b.stepNumber);
}
