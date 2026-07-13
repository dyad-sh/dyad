<<<<<<< Updated upstream
||||||| Stash base
import { useCallback, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Files,
  Maximize2,
  MessageSquare,
  Minimize2,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { useTranslation } from "react-i18next";
=======
import { useCallback, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Files,
  Maximize2,
  MessageSquare,
  Minimize2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useTranslation } from "react-i18next";
>>>>>>> Stashed changes
import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { useEffect, useState } from "react";
import { useLoadApp } from "@/hooks/useLoadApp";
import { RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useAtomValue } from "jotai";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { selectedVersionIdAtom } from "@/atoms/appAtoms";
import { useTranslation } from "react-i18next";
import { VersionDiffView } from "./VersionDiffView";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

interface App {
  id?: number;
  files?: string[];
}

export interface CodeViewProps {
  loading: boolean;
  app: App | null;
}

// Code view component that displays app files or status messages
export const CodeView = ({ loading, app }: CodeViewProps) => {
  const { t } = useTranslation("home");
  const selectedFile = useAtomValue(selectedFileAtom);
  const selectedVersionId = useAtomValue(selectedVersionIdAtom);
  const { refreshApp } = useLoadApp(app?.id ?? null);
  const [isFullscreen, setIsFullscreen] = useState(false);
<<<<<<< Updated upstream
||||||| Stash base
  const [isQuickOpen, setIsQuickOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const explorerPanelRef = useRef<ImperativePanelHandle>(null);

  const selectedFile =
    appId === null ? null : (selectedFilesByAppId.get(appId) ?? null);
  const openFiles = appId === null ? [] : (openFilesByAppId.get(appId) ?? []);
  const isVersionDiffMode = selectedVersionId != null && appId != null;

  useEffect(() => {
    reconcileFiles({ appId, files });
  }, [appId, files, reconcileFiles]);

  useEffect(() => {
    setIsQuickOpen(false);
  }, [appId]);

  useEffect(() => {
    if (isVersionDiffMode || !explorerPanelRef.current) return;
    if (isExplorerOpen) {
      explorerPanelRef.current.expand();
    } else {
      explorerPanelRef.current.collapse();
    }
  }, [isExplorerOpen, isVersionDiffMode]);

  useEffect(() => {
=======
  const [isQuickOpen, setIsQuickOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const selectedFile =
    appId === null ? null : (selectedFilesByAppId.get(appId) ?? null);
  const openFiles = appId === null ? [] : (openFilesByAppId.get(appId) ?? []);
  const isVersionDiffMode = selectedVersionId != null && appId != null;

  useEffect(() => {
    reconcileFiles({ appId, files });
  }, [appId, files, reconcileFiles]);

  useEffect(() => {
    setIsQuickOpen(false);
  }, [appId]);
>>>>>>> Stashed changes

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  if (loading) {
    return <div className="text-center py-4">{t("preview.loadingFiles")}</div>;
  }

  if (!app) {
    return (
      <div className="text-center py-4 text-gray-500">
        {t("preview.noAppSelected")}
      </div>
    );
  }

  const isVersionDiffMode = selectedVersionId != null && app.id != null;

  // The version diff view is driven by the selected commit, not the current
  // working-tree files, so it must render even when the checkout has no files
  // (e.g. a deletion-only version or an otherwise empty working tree).
  if (isVersionDiffMode || (app.files && app.files.length > 0)) {
    return (
      <div
        className={`flex flex-col bg-background ${isFullscreen ? "fixed inset-0 z-50 h-screen w-screen shadow-2xl" : "h-full"}`}
      >
        {/* Toolbar */}
        <div className="flex items-center p-2 border-b space-x-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => refreshApp()}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={loading || !app.id}
                />
              }
            >
              <RefreshCw size={16} />
            </TooltipTrigger>
            <TooltipContent>{t("preview.refreshFiles")}</TooltipContent>
          </Tooltip>
          <div className="text-sm text-gray-500">
            {isVersionDiffMode
              ? t("preview.viewingVersionChanges")
              : `${app.files?.length ?? 0} ${t("preview.files")}`}
          </div>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  onClick={() => setIsFullscreen((value) => !value)}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                />
              }
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </TooltipTrigger>
            <TooltipContent>
              {isFullscreen
                ? t("preview.exitFullScreen")
                : t("preview.enterFullScreen")}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        {isVersionDiffMode ? (
          <VersionDiffView appId={app.id!} versionId={selectedVersionId} />
        ) : (
          <PanelGroup
            direction="horizontal"
            autoSaveId="code-view-file-tree"
            className="flex-1 overflow-hidden"
          >
            <Panel defaultSize={33} minSize={15}>
              <div className="h-full overflow-hidden flex flex-col min-h-0">
                <FileTree appId={app.id ?? null} files={app.files ?? []} />
              </div>
            </Panel>
            <PanelResizeHandle
              aria-label="Resize file tree"
              className="w-1 bg-border hover:bg-gray-400 transition-colors cursor-col-resize"
            />
            <Panel defaultSize={67} minSize={30}>
              {selectedFile ? (
                <FileEditor
                  key={`${app.id ?? "unknown"}:${selectedFile.path}`}
                  appId={app.id ?? null}
                  filePath={selectedFile.path}
                  initialLine={selectedFile.line ?? null}
                />
              ) : (
                <div className="text-center py-4 text-gray-500">
                  {t("preview.selectFileToView")}
                </div>
              )}
            </Panel>
          </PanelGroup>
        )}
      </div>
    );
  }

  return (
<<<<<<< Updated upstream
    <div className="text-center py-4 text-gray-500">
      {t("preview.noFilesFound")}
||||||| Stash base
    <div
      ref={workspaceRef}
      className={`flex flex-col bg-background ${isFullscreen ? "fixed inset-0 z-50 h-screen w-screen shadow-2xl" : "h-full"}`}
      data-testid="code-workspace"
    >
      <div className="flex min-h-10 items-center gap-1 border-b px-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => refreshApp()}
                aria-label={t("preview.refreshFiles")}
                className="rounded p-1.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || !appId}
                data-testid="code-refresh-files-button"
              />
            }
          >
            <RefreshCw size={16} />
          </TooltipTrigger>
          <TooltipContent>{t("preview.refreshFiles")}</TooltipContent>
        </Tooltip>
        <div className="mr-1 text-xs text-muted-foreground">
          {isVersionDiffMode
            ? t("preview.viewingVersionChanges")
            : `${files.length} ${t("preview.files")}`}
        </div>

        {!isVersionDiffMode && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setIsQuickOpen(true)}
                    aria-label={t("preview.quickOpen")}
                    className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    data-testid="code-quick-open-button"
                  />
                }
              >
                <Search size={15} />
                <span className="hidden sm:inline">
                  {t("preview.quickOpen")}
                </span>
                <kbd className="hidden rounded border bg-background px-1 text-[10px] 2xl:inline">
                  {navigator.platform.includes("Mac") ? "⌘P" : "Ctrl+P"}
                </kbd>
              </TooltipTrigger>
              <TooltipContent>{t("preview.quickOpen")}</TooltipContent>
            </Tooltip>
            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setIsExplorerOpen((value) => !value)}
                    aria-label={
                      isExplorerOpen
                        ? t("preview.hideExplorer")
                        : t("preview.showExplorer")
                    }
                    aria-pressed={isExplorerOpen}
                    className={`rounded p-1.5 hover:bg-muted ${isExplorerOpen ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                    data-testid="code-toggle-explorer-button"
                  />
                }
              >
                <Files size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {isExplorerOpen
                  ? t("preview.hideExplorer")
                  : t("preview.showExplorer")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setIsChatPanelHidden(!isChatPanelHidden)}
                    aria-label={
                      isChatPanelHidden
                        ? t("preview.showChat")
                        : t("preview.focusCode")
                    }
                    aria-pressed={isChatPanelHidden}
                    className={`rounded p-1.5 hover:bg-muted ${isChatPanelHidden ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                    data-testid="code-toggle-chat-button"
                  />
                }
              >
                <MessageSquare size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {isChatPanelHidden
                  ? t("preview.showChat")
                  : t("preview.focusCode")}
              </TooltipContent>
            </Tooltip>
          </>
        )}
        {isVersionDiffMode && <div className="flex-1" />}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => setIsFullscreen((value) => !value)}
                aria-label={
                  isFullscreen
                    ? t("preview.exitFullScreen")
                    : t("preview.enterFullScreen")
                }
                aria-pressed={isFullscreen}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                data-testid="code-toggle-fullscreen-button"
              />
            }
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </TooltipTrigger>
          <TooltipContent>
            {isFullscreen
              ? t("preview.exitFullScreen")
              : t("preview.enterFullScreen")}
          </TooltipContent>
        </Tooltip>
      </div>

      {isVersionDiffMode ? (
        <VersionDiffView appId={appId} versionId={selectedVersionId} />
      ) : (
        <PanelGroup
          direction="horizontal"
          autoSaveId="code-view-file-tree-v3"
          className="flex-1 overflow-hidden"
        >
          <Panel
            ref={explorerPanelRef}
            defaultSize={25}
            minSize={18}
            maxSize={45}
            collapsible
            collapsedSize={0}
            onCollapse={() => setIsExplorerOpen(false)}
            onExpand={() => setIsExplorerOpen(true)}
          >
            <div className="h-full min-h-0 overflow-hidden border-r">
              <FileTree appId={appId} files={files} />
            </div>
          </Panel>
          <PanelResizeHandle
            aria-label={t("preview.resizeFileTree")}
            title={t("preview.resizeFileTree")}
            className={`${isExplorerOpen ? "w-1" : "w-0"} cursor-col-resize bg-border transition-[width,background-color] hover:bg-primary/40`}
          />
          <Panel defaultSize={75} minSize={40}>
            <div className="flex h-full min-w-0 flex-col">
              <CodeEditorTabs
                activePath={selectedFile?.path ?? null}
                paths={openFiles}
                onSelect={(path) => handleSelectFile(path)}
                onClose={handleCloseFile}
              />
              <div className="min-h-0 flex-1">
                {selectedFile ? (
                  <FileEditor
                    key={`${appId ?? "unknown"}:${selectedFile.path}`}
                    appId={appId}
                    filePath={selectedFile.path}
                    initialLine={selectedFile.line ?? null}
                    saveRequestEvent={SAVE_ACTIVE_FILE_EVENT}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                    <Files className="size-8 opacity-50" />
                    <span className="text-sm">
                      {t("preview.selectFileToView")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsQuickOpen(true)}
                    >
                      <Search className="size-4" />
                      {t("preview.quickOpen")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      )}

      {!isVersionDiffMode && (
        <CodeQuickOpen
          files={files}
          open={isQuickOpen}
          onOpenChange={setIsQuickOpen}
          onSelect={(path) => handleSelectFile(path)}
        />
      )}
=======
    <div
      ref={workspaceRef}
      className={`flex flex-col bg-background ${isFullscreen ? "fixed inset-0 z-50 h-screen w-screen shadow-2xl" : "h-full"}`}
      data-testid="code-workspace"
    >
      <div className="flex min-h-10 items-center gap-1 border-b px-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => refreshApp()}
                aria-label={t("preview.refreshFiles")}
                className="rounded p-1.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || !appId}
                data-testid="code-refresh-files-button"
              />
            }
          >
            <RefreshCw size={16} />
          </TooltipTrigger>
          <TooltipContent>{t("preview.refreshFiles")}</TooltipContent>
        </Tooltip>
        <div className="mr-1 text-xs text-muted-foreground">
          {isVersionDiffMode
            ? t("preview.viewingVersionChanges")
            : `${files.length} ${t("preview.files")}`}
        </div>

        {!isVersionDiffMode && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setIsQuickOpen(true)}
                    aria-label={t("preview.quickOpen")}
                    className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    data-testid="code-quick-open-button"
                  />
                }
              >
                <Search size={15} />
                <span className="hidden sm:inline">
                  {t("preview.quickOpen")}
                </span>
                <kbd className="hidden rounded border bg-background px-1 text-[10px] 2xl:inline">
                  {navigator.platform.includes("Mac") ? "⌘P" : "Ctrl+P"}
                </kbd>
              </TooltipTrigger>
              <TooltipContent>{t("preview.quickOpen")}</TooltipContent>
            </Tooltip>
            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setIsExplorerOpen((value) => !value)}
                    aria-label={
                      isExplorerOpen
                        ? t("preview.hideExplorer")
                        : t("preview.showExplorer")
                    }
                    aria-pressed={isExplorerOpen}
                    className={`rounded p-1.5 hover:bg-muted ${isExplorerOpen ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                    data-testid="code-toggle-explorer-button"
                  />
                }
              >
                <Files size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {isExplorerOpen
                  ? t("preview.hideExplorer")
                  : t("preview.showExplorer")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => setIsChatPanelHidden(!isChatPanelHidden)}
                    aria-label={
                      isChatPanelHidden
                        ? t("preview.showChat")
                        : t("preview.focusCode")
                    }
                    aria-pressed={isChatPanelHidden}
                    className={`rounded p-1.5 hover:bg-muted ${isChatPanelHidden ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                    data-testid="code-toggle-chat-button"
                  />
                }
              >
                <MessageSquare size={16} />
              </TooltipTrigger>
              <TooltipContent>
                {isChatPanelHidden
                  ? t("preview.showChat")
                  : t("preview.focusCode")}
              </TooltipContent>
            </Tooltip>
          </>
        )}
        {isVersionDiffMode && <div className="flex-1" />}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => setIsFullscreen((value) => !value)}
                aria-label={
                  isFullscreen
                    ? t("preview.exitFullScreen")
                    : t("preview.enterFullScreen")
                }
                aria-pressed={isFullscreen}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                data-testid="code-toggle-fullscreen-button"
              />
            }
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </TooltipTrigger>
          <TooltipContent>
            {isFullscreen
              ? t("preview.exitFullScreen")
              : t("preview.enterFullScreen")}
          </TooltipContent>
        </Tooltip>
      </div>

      {isVersionDiffMode ? (
        <VersionDiffView appId={appId} versionId={selectedVersionId} />
      ) : (
        <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
          {isExplorerOpen && (
            <>
              <Panel defaultSize={25} minSize={18} maxSize={45}>
                <div className="h-full min-h-0 overflow-hidden border-r">
                  <FileTree appId={appId} files={files} />
                </div>
              </Panel>
              <PanelResizeHandle
                aria-label={t("preview.resizeFileTree")}
                title={t("preview.resizeFileTree")}
                className="w-1 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
              />
            </>
          )}
          <Panel defaultSize={isExplorerOpen ? 75 : 100} minSize={40}>
            <div className="flex h-full min-w-0 flex-col">
              <CodeEditorTabs
                activePath={selectedFile?.path ?? null}
                paths={openFiles}
                onSelect={(path) => handleSelectFile(path)}
                onClose={handleCloseFile}
              />
              <div className="min-h-0 flex-1">
                {selectedFile ? (
                  <FileEditor
                    key={`${appId ?? "unknown"}:${selectedFile.path}`}
                    appId={appId}
                    filePath={selectedFile.path}
                    initialLine={selectedFile.line ?? null}
                    saveRequestEvent={SAVE_ACTIVE_FILE_EVENT}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                    <Files className="size-8 opacity-50" />
                    <span className="text-sm">
                      {t("preview.selectFileToView")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsQuickOpen(true)}
                    >
                      <Search className="size-4" />
                      {t("preview.quickOpen")}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      )}

      {!isVersionDiffMode && (
        <CodeQuickOpen
          files={files}
          open={isQuickOpen}
          onOpenChange={setIsQuickOpen}
          onSelect={(path) => handleSelectFile(path)}
        />
      )}
>>>>>>> Stashed changes
    </div>
  );
};
