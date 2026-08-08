import React, { useState } from "react";
import type { AgentTodo } from "@/ipc/types";
import {
  CheckCircle2,
  Circle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TodoListProps {
  todos: AgentTodo[];
}

function getStatusIcon(status: AgentTodo["status"], size: "sm" | "md" = "sm") {
  const sizeClass = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  switch (status) {
    case "completed":
      return (
        <CheckCircle2
          className={cn(sizeClass, "text-green-500 flex-shrink-0")}
        />
      );
    case "in_progress":
      return (
        <Loader2
          className={cn(sizeClass, "text-blue-500 animate-spin flex-shrink-0")}
        />
      );
    case "pending":
    default:
      return (
        <Circle
          className={cn(sizeClass, "text-muted-foreground flex-shrink-0")}
        />
      );
  }
}

export function TodoList({ todos }: TodoListProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!todos.length) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const inProgressTask = todos.find((t) => t.status === "in_progress");

  return (
    <div className="border-b border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {isExpanded ? (
            <>
              <ListTodo className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm">
                {completed} of {total} To-dos Completed
              </span>
            </>
          ) : inProgressTask ? (
            <>
              {getStatusIcon("in_progress", "md")}
              <span className="text-sm truncate">{inProgressTask.content}</span>
              <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                ({completed}/{total})
              </span>
            </>
          ) : (
            <>
              {completed === total ? (
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className="text-sm text-muted-foreground">
                {completed === total
                  ? "All tasks completed"
                  : "No task in progress"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                ({completed}/{total})
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && (
        <ul className="px-3 pb-2.5 space-y-1.5">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={cn(
                "flex items-center gap-2.5 text-sm py-0.5",
                todo.status === "completed" && "text-muted-foreground",
              )}
            >
              {getStatusIcon(todo.status)}
              <span
                className={cn(todo.status === "completed" && "line-through")}
              >
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
