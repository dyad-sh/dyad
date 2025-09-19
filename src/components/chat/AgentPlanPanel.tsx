import { useMemo, type ReactElement } from "react";
import { useAgentWorkflow } from "@/hooks/useAgentWorkflow";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";

const WORKFLOW_STATUS_LABEL: Record<string, string> = {
  idle: "Waiting for brief",
  analysis: "Analyzing requirements",
  plan_ready: "Plan ready",
  executing: "Executing",
  awaiting_user: "Awaiting review",
  reviewing: "Reviewing",
  completed: "Completed",
  revising: "Revising",
  error: "Needs attention",
};

const WORKFLOW_STATUS_ICON: Record<string, ReactElement> = {
  plan_ready: <PauseCircle className="h-4 w-4 text-blue-500" />,
  executing: <PlayCircle className="h-4 w-4 text-primary" />,
  revising: <ShieldAlert className="h-4 w-4 text-amber-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
};

const TODO_STATUS_META: Record<
  string,
  { label: string; badge: "outline" | "secondary" | "default" }
> = {
  pending: { label: "Pending", badge: "secondary" },
  ready: { label: "Ready", badge: "secondary" },
  executing: { label: "In progress", badge: "outline" },
  revising: { label: "Revising", badge: "secondary" },
  completed: { label: "Completed", badge: "default" },
};

function TodoRow({
  todoId,
  title,
  status,
  isActive,
}: {
  todoId: string;
  title: string;
  status?: string | null;
  isActive: boolean;
}) {
  const normalized = status?.toLowerCase?.() ?? "pending";
  const meta = TODO_STATUS_META[normalized] ?? TODO_STATUS_META.pending;

  return (
    <li
      className={cn(
        "flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-2",
        isActive && "border-primary bg-primary/10",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-foreground flex-1 min-w-0">
        {isActive ? (
          <PlayCircle className="h-4 w-4 text-primary" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
                <span className="whitespace-normal break-words">{title}</span>
      </div>
      <Badge
        variant={isActive ? "outline" : meta.badge}
        className="text-[10px] uppercase"
      >
        {meta.label}
      </Badge>
    </li>
  );
}

export function AgentPlanPanel({ chatId }: { chatId?: number }) {
  const { workflow, isLoading, error, refresh, setAutoAdvance } =
    useAgentWorkflow(chatId);

  const statusLabel = useMemo(() => {
    if (!workflow) return "Awaiting plan";
    return WORKFLOW_STATUS_LABEL[workflow.status] ?? workflow.status;
  }, [workflow]);

  const headerIcon = useMemo(() => {
    if (!workflow) return <Circle className="h-4 w-4 text-muted-foreground" />;
    if (workflow.status === "analysis") {
      return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
    }
    return WORKFLOW_STATUS_ICON[workflow.status] ?? (
      <Circle className="h-4 w-4 text-muted-foreground" />
    );
  }, [workflow]);

  if (!workflow && !isLoading) {
    return (
      <div className="border-b border-border bg-(--background-lighter) px-4 py-3 text-sm text-muted-foreground">
        Provide a brief to generate the agent plan.
      </div>
    );
  }

  const toggleAutoAdvance = async (enabled: boolean) => {
    if (!workflow || typeof chatId !== "number") return;
    await setAutoAdvance(enabled);
  };

  return (
    <div
      data-testid="agent-plan-panel"
      className="border-b border-border bg-(--background-lighter) px-4 py-3"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {headerIcon}
            <span className="text-sm font-semibold">Agent Plan</span>
            {isLoading && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
          </div>
          <p className="text-xs text-muted-foreground">{statusLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase text-muted-foreground">
              Auto-continue
            </span>
            <Switch
              checked={workflow?.autoAdvance ?? false}
              onCheckedChange={toggleAutoAdvance}
              disabled={isLoading || !workflow}
              aria-label="Toggle auto-continue"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => refresh()}
            disabled={isLoading}
          >
            <RefreshCcw className={cn("h-3 w-3", isLoading && "animate-spin")} />
            <span className="ml-1">Sync</span>
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      <ScrollArea className="mt-3 max-h-56">
        <ul className="flex flex-col gap-2">
          {workflow?.todos?.length ? (
            workflow.todos.map((todo) => (
              <TodoRow
                key={todo.todoId}
                todoId={todo.todoId}
                title={todo.title}
                status={todo.status}
                isActive={workflow.currentTodoId === todo.todoId}
              />
            ))
          ) : (
            <li className="text-xs text-muted-foreground">
              Plan will appear after analysis completes.
            </li>
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}


