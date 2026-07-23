import { z } from "zod";
import { eq } from "drizzle-orm";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { db } from "../../../../../../db";
import { messages } from "../../../../../../db/schema";
import {
  executeAddDependency,
  ExecuteAddDependencyError,
} from "@/ipc/processors/executeAddDependency";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const addDependencySchema = z.object({
  packages: z
    .array(z.string())
    .min(1)
    .describe(
      "npm package names or registry version specs. Use a bare name (for example, pkg) to install it or refresh an existing dependency within its current package.json constraint. Use pkg@latest only to intentionally upgrade to the latest release, including a new major. Exact versions, caret/tilde ranges, partial/x ranges, prereleases, and dist-tags are supported.",
    ),
});

export const addDependencyTool: ToolDefinition<
  z.infer<typeof addDependencySchema>
> = {
  name: "add_dependency",
  description:
    "Install or refresh npm packages. A bare package preserves an existing version constraint; use package@latest to explicitly upgrade it.",
  inputSchema: addDependencySchema,
  defaultConsent: "ask",
  modifiesState: true,

  getConsentPreview: (args) => `Install ${args.packages.join(", ")}`,

  shouldTrackMutation: (_args, result) =>
    result.startsWith("Successfully installed or updated"),

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
      throw new DyadError(
        "Message not found for adding dependencies",
        DyadErrorKind.NotFound,
      );
    }

    try {
      const result = await executeAddDependency({
        packages: args.packages,
        message,
        appPath: ctx.appPath,
      });
      for (const warningMessage of result.warningMessages) {
        ctx.onWarningMessage?.(warningMessage);
      }
    } catch (error) {
      if (error instanceof ExecuteAddDependencyError) {
        for (const warningMessage of error.warningMessages) {
          ctx.onWarningMessage?.(warningMessage);
        }
      }
      throw error;
    }

    return `Successfully installed or updated ${args.packages.join(", ")}`;
  },
};
