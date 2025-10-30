import { z } from "zod";

export const AddMcpServerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["stdio"]),
    command: z.string(),
  }),
  z.object({
    type: z.enum(["http"]),
    url: z.string(),
  }),
]);

export type AddMcpServerConfig = z.infer<typeof AddMcpServerConfigSchema>;
export type AddMcpServerPayload = {
  name: string;
  config: AddMcpServerConfig;
};
export type AddMcpServerDeepLinkData = {
  type: "add-mcp-server";
  payload: AddMcpServerPayload;
};

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

export type DeepLinkData =
  | AddMcpServerDeepLinkData
  | AddPromptDeepLinkData
  | {
      type: string;
    };
