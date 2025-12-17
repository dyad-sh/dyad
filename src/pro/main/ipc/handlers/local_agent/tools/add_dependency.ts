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

  buildXml: (argsText: string, _isComplete: boolean): string | undefined => {
    // For arrays, we need to detect when we have packages
    // The format is: {"packages": ["pkg1", "pkg2"]}
    const packagesMatch = argsText.match(/"packages"\s*:\s*\[([^\]]*)\]/);
    if (!packagesMatch) return undefined;

    // Extract packages from the match
    const packagesStr = packagesMatch[1];
    const packages = packagesStr
      .split(",")
      .map((p) => p.trim().replace(/^"|"$/g, ""))
      .filter((p) => p);

    if (packages.length === 0) return undefined;

    return `<dyad-add-dependency packages="${escapeXmlAttr(packages.join(" "))}"></dyad-add-dependency>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const allowed = await ctx.requireConsent({
      toolName: "add_dependency",
      toolDescription: "Install npm packages",
      inputPreview: `Install ${args.packages.join(", ")}`,
    });
    if (!allowed) {
      throw new Error("User denied permission for add_dependency");
    }

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
