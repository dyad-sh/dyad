import { useMemo, useState } from "react";
import { Check, RefreshCw, Wrench, Workflow, Zap } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useMcp } from "@/hooks/useMcp";
import {
  collectChatAgentMcpActions,
  type ChatAgentMcpAction,
  getChatAgentMcpActionKey,
} from "@/lib/chat_agent_mcp_actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ChatAgentToolMenuProps = {
  disabled?: boolean;
  selectedActions: ChatAgentMcpAction[];
  onToggleAction: (action: ChatAgentMcpAction) => void;
};

function ActionMenuItem({
  action,
  selected,
  onToggle,
}: {
  action: ChatAgentMcpAction;
  selected: boolean;
  onToggle: (action: ChatAgentMcpAction) => void;
}) {
  const isWorkflow = action.kind === "workflow";
  const title = isWorkflow ? action.name : action.toolName;
  const subtitle = isWorkflow
    ? `${action.serverName} · ${action.workflowId}`
    : action.serverName;
  const description = action.description;

  return (
    <DropdownMenuItem
      closeOnClick={false}
      className={cn(
        "chat-agent-tool-menu-item",
        selected && "chat-agent-tool-menu-item--selected",
      )}
      onClick={() => onToggle(action)}
      data-testid={
        isWorkflow ? "chat-agent-mcp-workflow-item" : "chat-agent-mcp-tool-item"
      }
    >
      {isWorkflow ? (
        <Workflow className="mt-0.5 size-4 text-cyan-300" />
      ) : (
        <Zap className="mt-0.5 size-4 text-cyan-300" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate font-mono text-[0.68rem] text-cyan-200/55">
          {subtitle}
          {isWorkflow && action.active != null
            ? action.active
              ? " · active"
              : " · inactive"
            : ""}
        </span>
        {description && (
          <span className="mt-0.5 line-clamp-2 block text-xs text-cyan-50/55">
            {description}
          </span>
        )}
      </span>
      <span className="chat-agent-tool-check" aria-hidden>
        {selected && <Check className="size-3.5" />}
      </span>
    </DropdownMenuItem>
  );
}

export function ChatAgentToolMenu({
  disabled,
  selectedActions,
  onToggleAction,
}: ChatAgentToolMenuProps) {
  const [open, setOpen] = useState(false);
  const { settings } = useSettings();
  const {
    servers,
    toolsByServer,
    workflowsByServer,
    refetchAll,
    isLoading,
    isCheckingConnections,
  } = useMcp();

  const { workflows, tools } = useMemo(
    () =>
      collectChatAgentMcpActions({
        servers,
        toolsByServer,
        workflowsByServer,
        selectedServerIds: settings?.chatAgentMcpServerIds,
        selectedToolKeys: settings?.chatAgentMcpToolKeys,
        selectedWorkflowKeys: settings?.chatAgentMcpWorkflowKeys,
      }),
    [
      servers,
      settings?.chatAgentMcpServerIds,
      settings?.chatAgentMcpToolKeys,
      settings?.chatAgentMcpWorkflowKeys,
      toolsByServer,
      workflowsByServer,
    ],
  );

  const hasActions = workflows.length > 0 || tools.length > 0;
  const selectedKeys = useMemo(
    () => new Set(selectedActions.map(getChatAgentMcpActionKey)),
    [selectedActions],
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "chat-agent-composer-icon-btn",
          open && "chat-agent-composer-icon-btn--active",
        )}
        aria-label="Use MCP workflow or tool"
        data-testid="chat-agent-tool-menu"
      >
        <Wrench className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="chat-agent-tool-menu w-[23rem] max-w-[calc(100vw-2rem)] p-2"
      >
        <div className="px-2 pb-2 pt-1">
          <div className="font-jarvis-ui text-[0.68rem] uppercase tracking-[0.18em] text-cyan-200/80">
            MCP tool access
          </div>
          <div className="mt-1 text-xs text-cyan-50/55">
            Selected workflows and tools from Settings.
          </div>
        </div>

        {workflows.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-cyan-200/75">
              Workflows
            </DropdownMenuLabel>
            {workflows.map((workflow) => (
              <ActionMenuItem
                key={getChatAgentMcpActionKey(workflow)}
                action={workflow}
                selected={selectedKeys.has(getChatAgentMcpActionKey(workflow))}
                onToggle={onToggleAction}
              />
            ))}
          </>
        )}

        {tools.length > 0 && (
          <>
            {workflows.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-cyan-200/75">
              MCP tools
            </DropdownMenuLabel>
            {tools.map((tool) => (
              <ActionMenuItem
                key={getChatAgentMcpActionKey(tool)}
                action={tool}
                selected={selectedKeys.has(getChatAgentMcpActionKey(tool))}
                onToggle={onToggleAction}
              />
            ))}
          </>
        )}

        {!hasActions && (
          <div className="rounded-md border border-cyan-300/15 bg-cyan-300/5 px-3 py-3 text-xs text-cyan-50/60">
            {isLoading
              ? "Loading MCP selections..."
              : "No MCP workflows or tools are enabled for Chat Agent yet."}
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          closeOnClick={false}
          className="gap-2 text-xs text-cyan-100/75"
          onClick={() => void refetchAll()}
        >
          <RefreshCw
            className={cn("size-3.5", isCheckingConnections && "animate-spin")}
          />
          Refresh MCP list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
