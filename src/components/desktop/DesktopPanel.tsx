import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  Bot,
  LayoutGrid,
  Loader2,
  Mic,
  Settings2,
  Wifi,
  WifiOff,
} from "lucide-react";

import { desktopPanelConfigAtom } from "@/atoms/desktopAtoms";
import type { DesktopApp } from "@/lib/desktop/desktop_apps";
import { isVerticalPanel } from "@/lib/desktop/panel_config";
import type { Workspace } from "@/lib/desktop/workspaces";
import { cn } from "@/lib/utils";

export type TaskEntry = {
  app: DesktopApp;
  windowCount: number;
  running: boolean;
  active: boolean;
  minimized: boolean;
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return {
    time: now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
    date: now.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
  };
}

/**
 * Real connectivity, not a decorative icon. `navigator.onLine` is the only
 * network fact the renderer actually has, so it is the only one shown.
 */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/**
 * The desktop panel: start button, workspace switcher, task manager, tray,
 * clock and quick settings — configurable in edge, size and hide behaviour.
 */
export function DesktopPanel({
  tasks,
  workspaces,
  activeWorkspaceId,
  onStart,
  onOverview,
  onSelectWorkspace,
  onActivateTask,
  onTaskContextMenu,
  onQuickSettings,
  aiBusyLabel,
  micActive,
}: {
  tasks: TaskEntry[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onStart: () => void;
  onOverview: () => void;
  onSelectWorkspace: (id: string) => void;
  onActivateTask: (appId: string) => void;
  onTaskContextMenu: (appId: string, event: React.MouseEvent) => void;
  onQuickSettings: () => void;
  /** A truthful description of live AI work, or null when idle. */
  aiBusyLabel: string | null;
  micActive: boolean;
}) {
  const [config] = useAtom(desktopPanelConfigAtom);
  const clock = useClock();
  const online = useOnline();
  const vertical = isVerticalPanel(config.edge);

  return (
    <nav
      className={cn(
        "desktop-panel-bar",
        `is-${config.edge}`,
        `is-${config.size}`,
        config.hide === "auto-hide" && "is-auto-hide",
        vertical && "is-vertical",
      )}
      aria-label="Desktop panel"
      data-testid="desktop-panel"
    >
      <button
        type="button"
        className="desktop-panel-start"
        onClick={onStart}
        aria-label="Open start menu"
        data-testid="panel-start"
      >
        <Bot className="size-4" />
      </button>

      <button
        type="button"
        className="desktop-panel-btn"
        onClick={onOverview}
        aria-label="Window overview"
        title="Overview"
        data-testid="panel-overview"
      >
        <LayoutGrid className="size-4" />
      </button>

      <div
        className="desktop-panel-workspaces"
        role="tablist"
        aria-label="Workspaces"
      >
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            role="tab"
            aria-selected={workspace.id === activeWorkspaceId}
            className={cn(
              "desktop-panel-workspace",
              workspace.id === activeWorkspaceId && "is-active",
            )}
            onClick={() => onSelectWorkspace(workspace.id)}
            title={workspace.name}
            data-testid={`panel-workspace-${workspace.id}`}
          >
            {workspace.name.slice(0, 1).toUpperCase()}
          </button>
        ))}
      </div>

      <span className="desktop-panel-divider" />

      {/* Task manager */}
      <div className="desktop-panel-tasks">
        {tasks.map((task) => (
          <button
            key={task.app.id}
            type="button"
            className={cn(
              "desktop-panel-task",
              task.running && "is-running",
              task.active && "is-active",
              task.minimized && "is-minimized",
            )}
            onClick={() => onActivateTask(task.app.id)}
            onContextMenu={(event) => onTaskContextMenu(task.app.id, event)}
            aria-label={
              task.running
                ? `${task.app.title} — ${task.windowCount} window${task.windowCount === 1 ? "" : "s"}`
                : task.app.title
            }
            title={task.app.title}
            data-testid={`panel-task-${task.app.id}`}
          >
            <task.app.icon className="size-5" />
            {task.windowCount > 1 && (
              <span className="desktop-panel-task-count">
                {task.windowCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <span className="desktop-panel-spacer" />

      {/* Tray: only indicators backed by real state */}
      <div className="desktop-panel-tray">
        {aiBusyLabel && (
          <span
            className="desktop-panel-ai"
            title={aiBusyLabel}
            data-testid="panel-ai-activity"
          >
            <Loader2 className="size-3.5 animate-spin" />
            <span className="desktop-panel-ai-label">{aiBusyLabel}</span>
          </span>
        )}

        <span
          className="desktop-panel-indicator"
          title={online ? "Online" : "Offline"}
          data-testid="panel-network"
        >
          {online ? (
            <Wifi className="size-3.5" />
          ) : (
            <WifiOff className="size-3.5 text-amber-400" />
          )}
          <span className="sr-only">{online ? "Online" : "Offline"}</span>
        </span>

        {micActive && (
          <span className="desktop-panel-indicator" title="Microphone in use">
            <Mic className="size-3.5" />
            <span className="sr-only">Microphone in use</span>
          </span>
        )}

        <button
          type="button"
          className="desktop-panel-clock-btn"
          onClick={onQuickSettings}
          aria-label="Quick settings"
          data-testid="panel-quick-settings"
        >
          <span className="desktop-panel-time">{clock.time}</span>
          <span className="desktop-panel-day">{clock.date}</span>
        </button>

        <button
          type="button"
          className="desktop-panel-btn"
          onClick={onQuickSettings}
          aria-label="Open quick settings"
        >
          <Settings2 className="size-4" />
        </button>
      </div>
    </nav>
  );
}
