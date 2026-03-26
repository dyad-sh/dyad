import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentBuilderClient } from "@/ipc/agent_builder_client";
import { autoSetupAgent } from "@/lib/agent_auto_setup";
import { toast } from "sonner";

/**
 * Parse a .agent.md template and return the blueprint.
 */
export function useParseAgentTemplate() {
  return useMutation({
    mutationFn: (args: { markdown: string; originalMessage?: string }) =>
      agentBuilderClient.parseAgentTemplate(args.markdown, args.originalMessage),
    onError: (err: Error) => toast.error(`Failed to parse template: ${err.message}`),
  });
}

/**
 * Parse a .agent.md template, then auto-setup the full agent
 * (DB record + tools + knowledge + workflow) in one shot.
 */
export function useCreateAgentFromTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { markdown: string; originalMessage?: string }) => {
      // Step 1: Parse the template into a blueprint
      const { blueprint } = await agentBuilderClient.parseAgentTemplate(
        args.markdown,
        args.originalMessage,
      );

      // Step 2: Run auto-setup with the blueprint
      const result = await autoSetupAgent(blueprint);

      if (!result.success) {
        throw new Error(result.errors.join("; "));
      }

      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success(`Agent "${result.agent?.name}" created from template!`);
    },
    onError: (err: Error) => toast.error(`Agent creation failed: ${err.message}`),
  });
}

/**
 * Export an existing agent as a .agent.md template string.
 */
export function useExportAgentTemplate() {
  return useMutation({
    mutationFn: (agentId: number) => agentBuilderClient.exportAgentTemplate(agentId),
    onSuccess: () => toast.success("Agent template exported"),
    onError: (err: Error) => toast.error(`Export failed: ${err.message}`),
  });
}
