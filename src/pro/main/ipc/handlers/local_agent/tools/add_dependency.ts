import { z } from "zod";
import { eq } from "drizzle-orm";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { db } from "../../../../../../db";
import { messages } from "../../../../../../db/schema";
import { executeAddDependency } from "@/ipc/processors/executeAddDependency";

const addDependencySchema = z.object({
  packages: z.array(z.string()).describe("Array of package names to install"),
});

export const addDependencyTool: ToolDefinition<
  z.infer<typeof addDependencySchema>
> = {
  name: "add_dependency",
  description: "Install npm packages",
  inputSchema: addDependencySchema,
  defaultConsent: "ask",

  getConsentPreview: (args) => `Install ${args.packages.join(", ")}`,

  buildXml: (args, _isComplete) => {
    if (!args.packages || args.packages.length === 0) return undefined;
    return `<dyad-add-dependency packages="${escapeXmlAttr(args.packages.join(" "))}"></dyad-add-dependency>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const message = ctx.messageId
      ? await db.query.messages.findFirst({
          where: eq(messages.id, ctx.messageId),
        })
      : undefined;

    if (!message) {
      throw new Error("Message not found for adding dependencies");
    }

    await executeAddDependency({
      packages: args.packages,
      message,
      appPath: ctx.appPath,
    });

    return `Successfully installed ${args.packages.join(", ")}`;
  },
};
