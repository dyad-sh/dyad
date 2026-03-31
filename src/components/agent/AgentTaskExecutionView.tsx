/**
 * AgentTaskExecutionView — Real-time streaming task output terminal view.
 * Shows task progress events for a specific agent, with scrolling output pane.
 */

import React, { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Trash2, Loader2 } from "lucide-react";
import { useTaskProgress, useExecuteTask } from "@/hooks/useAgentSwarm";
import type { AgentNodeId, TaskProgressEvent } from "@/ipc/agent_swarm_client";

// =============================================================================
// TYPES
// =============================================================================

interface AgentTaskExecutionViewProps {
  agentId: AgentNodeId;
  activeTasks?: { id: string; description: string; status: string }[];
  onExecuteTask?: (taskId: string) => void;
}

// =============================================================================
// HELPERS
// =============================================================================

function statusBadge(status: TaskProgressEvent["status"]) {
  const variants: Record<
    TaskProgressEvent["status"],
    { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
  > = {
    started: { variant: "secondary", label: "Running" },
    streaming: { variant: "default", label: "Streaming" },
    completed: { variant: "outline", label: "Completed" },
    failed: { variant: "destructive", label: "Failed" },
  };
  const v = variants[status];
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AgentTaskExecutionView({
  agentId,
  activeTasks = [],
  onExecuteTask,
}: AgentTaskExecutionViewProps) {
  const { progress, clear } = useTaskProgress(agentId);
  const executeTask = useExecuteTask();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new output
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progress]);

  const handleExecute = (taskId: string) => {
    if (onExecuteTask) {
      onExecuteTask(taskId);
    } else {
      executeTask.mutate({ agentId, taskId });
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Active tasks list */}
      {activeTasks.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Pending Tasks
          </h4>
          {activeTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span className="truncate flex-1">{task.description}</span>
              <Badge variant="outline" className="shrink-0">
                {task.status}
              </Badge>
              {task.status === "assigned" && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => handleExecute(task.id)}
                  disabled={executeTask.isPending}
                >
                  {executeTask.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Terminal output */}
      <div className="flex-1 min-h-0">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-medium text-muted-foreground">
            Execution Output
          </h4>
          {progress.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={clear}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </div>
        <ScrollArea className="h-64 rounded-md border bg-black/90 p-3 font-mono text-xs text-green-400">
          {progress.length === 0 ? (
            <div className="text-muted-foreground/50 italic">
              No execution output yet. Execute a task to see output here.
            </div>
          ) : (
            progress.map((event, i) => (
              <div key={i} className="mb-1">
                {event.status === "started" && (
                  <div className="text-blue-400">
                    ▶ Task {event.taskId} started
                  </div>
                )}
                {event.status === "streaming" && event.chunk && (
                  <span className="text-green-400 whitespace-pre-wrap">
                    {event.chunk}
                  </span>
                )}
                {event.status === "completed" && (
                  <div className="text-emerald-400 mt-1">
                    ✓ Task completed
                    {event.output && (
                      <pre className="mt-1 whitespace-pre-wrap text-green-300/80">
                        {event.output}
                      </pre>
                    )}
                  </div>
                )}
                {event.status === "failed" && (
                  <div className="text-red-400 mt-1">
                    ✗ Task failed: {event.error}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </ScrollArea>

        {/* Latest status indicator */}
        {progress.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground">Latest:</span>
            {statusBadge(progress[progress.length - 1].status)}
          </div>
        )}
      </div>
    </div>
  );
}
