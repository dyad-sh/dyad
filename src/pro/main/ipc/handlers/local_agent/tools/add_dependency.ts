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
  execute: async (args, ctx: AgentContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "add_dependency",
      toolDescription: "Install npm packages",
      inputPreview: `Install ${args.packages.join(", ")}`,
    });
    if (!allowed) {
      throw new Error("User denied permission for add_dependency");
    }

    ctx.onXmlChunk(
      `<dyad-add-dependency packages="${escapeXmlAttr(args.packages.join(" "))}"></dyad-add-dependency>`,
    );

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
