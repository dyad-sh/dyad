import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { Monitor, Plus, X } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";

import {
  activeWorkspaceAtom,
  desktopDockPinsAtom,
  desktopLauncherOpenAtom,
  desktopModeAtom,
  desktopOverviewOpenAtom,
  desktopPanelConfigAtom,
  desktopQuickSettingsOpenAtom,
  desktopWindowsAtom,
  desktopWorkspacesAtom,
} from "@/atoms/desktopAtoms";
import {
  desktopAppById,
  desktopAppIdForPath,
} from "@/lib/desktop/desktop_apps";
import {
  desktopArea,
  isVerticalPanel,
  type PanelConfig,
} from "@/lib/desktop/panel_config";
import {
  addWorkspace,
  adjacentWorkspaceId,
  removeWorkspace,
  resolveActiveWorkspace,
  type Workspace,
} from "@/lib/desktop/workspaces";
import {
  boundsForSnap,
  closeWindow,
  focusWindow,
  frontWindow,
  minimizeWindow,
  moveWindow,
  moveWindowToWorkspace,
  openWindow,
  setWindowBounds,
  snapWindow,
  toggleMaximize,
  windowsOnWorkspace,
  type DesktopWindowState,
  type SnapKind,
  type Viewport,
} from "@/lib/desktop/window_manager";
import { cn } from "@/lib/utils";
import { DesktopWindow } from "./DesktopWindow";
import { DesktopPanel, type TaskEntry } from "./DesktopPanel";
import { StartMenu } from "./StartMenu";
import { ParticleBackground } from "@/components/home/ParticleBackground";

/**
 * The desktop: wallpaper, panel, start menu, workspaces and windows hosting
 * the existing features. Presentation only — every window renders the same
 * component the router renders, on the same state.
 */
export function DesktopShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [windows, setWindows] = useAtom(desktopWindowsAtom);
  const [pins] = useAtom(desktopDockPinsAtom);
  const [startOpen, setStartOpen] = useAtom(desktopLauncherOpenAtom);
  const [overviewOpen, setOverviewOpen] = useAtom(desktopOverviewOpenAtom);
  const [quickOpen, setQuickOpen] = useAtom(desktopQuickSettingsOpenAtom);
  const [workspaces, setWorkspaces] = useAtom(desktopWorkspacesAtom);
  const [activeWorkspaceRaw, setActiveWorkspace] = useAtom(activeWorkspaceAtom);
  const [panelConfig, setPanelConfig] = useAtom(desktopPanelConfigAtom);
  const setDesktopMode = useSetAtom(desktopModeAtom);

  const [snapPreview, setSnapPreview] = useState<SnapKind | null>(null);
  const [recentAppIds, setRecentAppIds] = useState<string[]>([]);
  const areaRef = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState<Viewport>({ width: 1280, height: 720 });
  const lastHandledPathRef = useRef<string | null>(null);

  // A persisted workspace id can outlive the workspace it names.
  const activeWorkspace = resolveActiveWorkspace(
    workspaces,
    activeWorkspaceRaw,
  );

  // The area minus whatever the panel reserves, so no window is laid out
  // underneath the panel and left unreachable.
  const viewport = useMemo(
    () => desktopArea(screen, panelConfig),
    [screen, panelConfig],
  );

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const update = () =>
      setScreen({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Workspaces are an ordered strip, so switching has a direction: the cube
  // turns the way you moved. Keyed by index rather than id so reordering
  // cannot send the animation the wrong way.
  const [turn, setTurn] = useState<{
    dir: "left" | "right";
    key: number;
  } | null>(null);
  const previousIndexRef = useRef(-1);
  useEffect(() => {
    const index = workspaces.findIndex((w) => w.id === activeWorkspace);
    if (index < 0) return;
    const previous = previousIndexRef.current;
    previousIndexRef.current = index;
    // First render is not a transition.
    if (previous < 0 || previous === index) return;
    setTurn({ dir: index > previous ? "left" : "right", key: Date.now() });
  }, [activeWorkspace, workspaces]);

  const visibleWindows = useMemo(
    () => windowsOnWorkspace(windows, activeWorkspace),
    [windows, activeWorkspace],
  );
  const front = frontWindow(windows, activeWorkspace);

  const openApp = useCallback(
    (appId: string) => {
      setWindows((current) =>
        openWindow(current, appId, viewport, undefined, activeWorkspace),
      );
      setRecentAppIds((current) =>
        [appId, ...current.filter((id) => id !== appId)].slice(0, 8),
      );
      setStartOpen(false);
      setOverviewOpen(false);
    },
    [activeWorkspace, setOverviewOpen, setStartOpen, setWindows, viewport],
  );

  // Route links inside the shared feature components still update TanStack
  // Router. In Desktop Mode, mirror that navigation by opening or focusing the
  // matching window so the destination never disappears into the hidden
  // standard layout.
  useEffect(() => {
    if (lastHandledPathRef.current === pathname) return;
    lastHandledPathRef.current = pathname;
    const appId = desktopAppIdForPath(pathname);
    if (appId) openApp(appId);
  }, [openApp, pathname]);

  /** Panel click: open, focus, restore, or minimise the frontmost. */
  const activateTask = useCallback(
    (appId: string) => {
      const target = visibleWindows.find((w) => w.appId === appId);
      if (!target) {
        openApp(appId);
        return;
      }
      if (!target.minimized && front?.id === target.id) {
        setWindows((current) => minimizeWindow(current, target.id));
      } else {
        setWindows((current) => focusWindow(current, target.id));
      }
    },
    [front?.id, openApp, setWindows, visibleWindows],
  );

  const tasks = useMemo((): TaskEntry[] => {
    const ids = [...pins];
    for (const w of visibleWindows) {
      if (!ids.includes(w.appId)) ids.push(w.appId);
    }
    return ids.flatMap((id) => {
      const app = desktopAppById(id);
      if (!app) return [];
      const open = visibleWindows.filter((w) => w.appId === id);
      return [
        {
          app,
          windowCount: open.length,
          running: open.length > 0,
          active: front?.appId === id,
          minimized: open.length > 0 && open.every((w) => w.minimized),
        },
      ];
    });
  }, [front?.appId, pins, visibleWindows]);

  // Ctrl+Alt+Arrow steps workspaces; Escape closes whichever overlay is up.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const stepping =
        event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;
      if (
        stepping &&
        (event.key === "ArrowRight" || event.key === "ArrowLeft")
      ) {
        event.preventDefault();
        setActiveWorkspace(
          adjacentWorkspaceId(
            workspaces,
            activeWorkspace,
            event.key === "ArrowRight" ? 1 : -1,
          ),
        );
        return;
      }
      if (event.key === "Escape") {
        if (overviewOpen) {
          event.preventDefault();
          setOverviewOpen(false);
        } else if (quickOpen) {
          event.preventDefault();
          setQuickOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeWorkspace,
    overviewOpen,
    quickOpen,
    setActiveWorkspace,
    setOverviewOpen,
    setQuickOpen,
    workspaces,
  ]);

  const handleAddWorkspace = () =>
    setWorkspaces((current) => addWorkspace(current));

  const handleRemoveWorkspace = (id: string) => {
    const result = removeWorkspace(workspaces, id, activeWorkspace);
    if (result.workspaces === workspaces) return;
    // Windows follow to a neighbour rather than becoming unreachable.
    if (result.reassignTo) {
      setWindows((current) =>
        current.map((w) =>
          w.workspaceId === id ? { ...w, workspaceId: result.reassignTo } : w,
        ),
      );
    }
    setWorkspaces(result.workspaces);
    setActiveWorkspace(result.activeId);
  };

  return (
    <div
      className={cn(
        "desktop-shell",
        `panel-${panelConfig.edge}`,
        isVerticalPanel(panelConfig.edge) && "panel-vertical",
      )}
      data-testid="desktop-shell"
    >
      <div ref={areaRef} className="desktop-area">
        <div className="desktop-wallpaper" aria-hidden>
          <ParticleBackground className="absolute inset-0" />
          <span className="desktop-wallpaper-ring" />
          <span className="desktop-wallpaper-grid" />
        </div>

        {snapPreview && (
          <div
            className="desktop-snap-preview"
            style={boundsForSnap(snapPreview, viewport)}
            aria-hidden
          />
        )}

        <div
          // Re-keyed on each switch so the animation restarts rather than
          // being skipped when the same direction repeats.
          key={turn?.key ?? "initial"}
          className={cn("desktop-cube-layer", turn && `is-turning-${turn.dir}`)}
          onAnimationEnd={() => setTurn(null)}
        >
          {visibleWindows.map((win) => {
            const app = desktopAppById(win.appId);
            if (!app) return null;
            return (
              <DesktopWindow
                key={win.id}
                window={win}
                title={app.title}
                component={app.component}
                isFront={front?.id === win.id}
                viewport={viewport}
                onFocus={() => setWindows((c) => focusWindow(c, win.id))}
                onClose={() => setWindows((c) => closeWindow(c, win.id))}
                onMinimize={() => setWindows((c) => minimizeWindow(c, win.id))}
                onToggleMaximize={() =>
                  setWindows((c) => toggleMaximize(c, win.id, viewport))
                }
                onMove={(x, y) =>
                  setWindows((c) => moveWindow(c, win.id, x, y, viewport))
                }
                onResizeBounds={(bounds) =>
                  setWindows((c) =>
                    setWindowBounds(c, win.id, bounds, viewport),
                  )
                }
                onSnap={(kind) =>
                  setWindows((c) => snapWindow(c, win.id, kind, viewport))
                }
                onSnapPreview={setSnapPreview}
              />
            );
          })}
        </div>

        <StartMenu
          open={startOpen}
          onClose={() => setStartOpen(false)}
          onOpenApp={openApp}
          onOpenConversation={() => openApp("chat")}
          recentAppIds={recentAppIds}
        />

        {overviewOpen && (
          <DesktopOverview
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            windows={windows}
            onClose={() => setOverviewOpen(false)}
            onSelectWorkspace={setActiveWorkspace}
            onFocusWindow={(id, workspaceId) => {
              if (workspaceId) setActiveWorkspace(workspaceId);
              setWindows((c) => focusWindow(c, id));
              setOverviewOpen(false);
            }}
            onCloseWindow={(id) => setWindows((c) => closeWindow(c, id))}
            onMoveWindow={(id, workspaceId) =>
              setWindows((c) => moveWindowToWorkspace(c, id, workspaceId))
            }
            onAddWorkspace={handleAddWorkspace}
            onRemoveWorkspace={handleRemoveWorkspace}
          />
        )}

        {quickOpen && (
          <QuickSettings
            panelConfig={panelConfig}
            onPanelConfig={setPanelConfig}
            onClose={() => setQuickOpen(false)}
            onExitDesktop={() => setDesktopMode(false)}
          />
        )}
      </div>

      <DesktopPanel
        tasks={tasks}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspace}
        onStart={() => setStartOpen((open) => !open)}
        onOverview={() => setOverviewOpen((open) => !open)}
        onSelectWorkspace={setActiveWorkspace}
        onActivateTask={activateTask}
        onTaskContextMenu={(appId, event) => {
          event.preventDefault();
          activateTask(appId);
        }}
        onQuickSettings={() => setQuickOpen((open) => !open)}
        aiBusyLabel={null}
        micActive={false}
      />
    </div>
  );
}

/** Every window across every workspace, with reassignment and closing. */
function DesktopOverview({
  workspaces,
  activeWorkspace,
  windows,
  onClose,
  onSelectWorkspace,
  onFocusWindow,
  onCloseWindow,
  onMoveWindow,
  onAddWorkspace,
  onRemoveWorkspace,
}: {
  workspaces: Workspace[];
  activeWorkspace: string;
  windows: DesktopWindowState[];
  onClose: () => void;
  onSelectWorkspace: (id: string) => void;
  onFocusWindow: (id: string, workspaceId: string | null) => void;
  onCloseWindow: (id: string) => void;
  onMoveWindow: (id: string, workspaceId: string | null) => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (id: string) => void;
}) {
  return (
    <div
      className="desktop-overview"
      role="dialog"
      aria-label="Window overview"
      onClick={onClose}
      data-testid="desktop-overview"
    >
      <div
        className="desktop-overview-inner"
        onClick={(event) => event.stopPropagation()}
      >
        {workspaces.map((workspace) => {
          const onIt = windows.filter(
            (w) => w.workspaceId === workspace.id || w.workspaceId === null,
          );
          return (
            <section key={workspace.id} className="desktop-overview-space">
              <header className="desktop-overview-space-head">
                <button
                  type="button"
                  className={cn(
                    "desktop-overview-space-name",
                    workspace.id === activeWorkspace && "is-active",
                  )}
                  onClick={() => {
                    onSelectWorkspace(workspace.id);
                    onClose();
                  }}
                  data-testid={`overview-workspace-${workspace.id}`}
                >
                  {workspace.name}
                </button>
                <span className="desktop-overview-count">{onIt.length}</span>
                {workspaces.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove ${workspace.name}`}
                    className="desktop-overview-remove"
                    onClick={() => onRemoveWorkspace(workspace.id)}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </header>
              <div className="desktop-overview-windows">
                {onIt.map((win) => {
                  const app = desktopAppById(win.appId);
                  if (!app) return null;
                  return (
                    <div key={win.id} className="desktop-overview-card">
                      <button
                        type="button"
                        className="desktop-overview-card-open"
                        onClick={() => onFocusWindow(win.id, win.workspaceId)}
                        data-testid={`overview-window-${win.id}`}
                      >
                        <app.icon className="size-4" />
                        <span className="truncate">{app.title}</span>
                      </button>
                      <div className="desktop-overview-card-actions">
                        <select
                          aria-label={`Move ${app.title} to workspace`}
                          value={win.workspaceId ?? "all"}
                          onChange={(event) =>
                            onMoveWindow(
                              win.id,
                              event.target.value === "all"
                                ? null
                                : event.target.value,
                            )
                          }
                        >
                          <option value="all">All workspaces</option>
                          {workspaces.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label={`Close ${app.title}`}
                          onClick={() => onCloseWindow(win.id)}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {onIt.length === 0 && (
                  <p className="desktop-overview-empty">No windows</p>
                )}
              </div>
            </section>
          );
        })}

        <button
          type="button"
          className="desktop-overview-add"
          onClick={onAddWorkspace}
          data-testid="overview-add-workspace"
        >
          <Plus className="size-4" />
          New workspace
        </button>
      </div>
    </div>
  );
}

/** Compact panel of controls that genuinely exist. */
function QuickSettings({
  panelConfig,
  onPanelConfig,
  onClose,
  onExitDesktop,
}: {
  panelConfig: PanelConfig;
  onPanelConfig: (next: PanelConfig) => void;
  onClose: () => void;
  onExitDesktop: () => void;
}) {
  return (
    <div
      className="desktop-quick-backdrop"
      onClick={onClose}
      data-testid="desktop-quick-settings"
    >
      <div
        className="desktop-quick"
        role="dialog"
        aria-label="Quick settings"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="desktop-quick-heading">Panel</h3>

        <div className="desktop-quick-row">
          <span>Position</span>
          <div className="desktop-quick-choices">
            {(["bottom", "top", "left", "right"] as const).map((edge) => (
              <button
                key={edge}
                type="button"
                className={cn(panelConfig.edge === edge && "is-active")}
                onClick={() => onPanelConfig({ ...panelConfig, edge })}
              >
                {edge}
              </button>
            ))}
          </div>
        </div>

        <div className="desktop-quick-row">
          <span>Size</span>
          <div className="desktop-quick-choices">
            {(["compact", "comfortable"] as const).map((size) => (
              <button
                key={size}
                type="button"
                className={cn(panelConfig.size === size && "is-active")}
                onClick={() => onPanelConfig({ ...panelConfig, size })}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="desktop-quick-row">
          <span>Auto-hide</span>
          <div className="desktop-quick-choices">
            {(["always-visible", "auto-hide"] as const).map((hide) => (
              <button
                key={hide}
                type="button"
                className={cn(panelConfig.hide === hide && "is-active")}
                onClick={() => onPanelConfig({ ...panelConfig, hide })}
              >
                {hide === "auto-hide" ? "on" : "off"}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="desktop-quick-exit"
          onClick={onExitDesktop}
        >
          <Monitor className="size-3.5" />
          Exit Desktop Mode
        </button>
      </div>
    </div>
  );
}
