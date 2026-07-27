import { z } from "zod";

export const AddPromptDataSchema = z.object({
  title: z.string(),
  description: z.string(),
  content: z.string(),
});

export type AddPromptPayload = z.infer<typeof AddPromptDataSchema>;

export type AddPromptDeepLinkData = {
  type: "add-prompt";
  payload: AddPromptPayload;
};

export type DeepLinkData = AddPromptDeepLinkData | { type: string };
