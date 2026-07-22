import { z } from "zod";
import { createSendClient, defineSendContract } from "../contracts/core";

export const FirstPromptCreationOperationSchema = z.object({
  operationId: z.string().min(1),
});

export const firstPromptSendContracts = {
  commitCreation: defineSendContract({
    channel: "first-prompt:commit-creation",
    input: FirstPromptCreationOperationSchema,
  }),
  cancelCreation: defineSendContract({
    channel: "first-prompt:cancel-creation",
    input: FirstPromptCreationOperationSchema,
  }),
} as const;

export const firstPromptClient = createSendClient(firstPromptSendContracts);
