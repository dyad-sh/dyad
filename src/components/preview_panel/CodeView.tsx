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
import { FileEditor } from "./FileEditor";
import { FileTree } from "./FileTree";
import { useLoadApp } from "@/hooks/useLoadApp";
import { isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { selectedVersionIdAtom } from "@/atoms/appAtoms";
import { VersionDiffView } from "./VersionDiffView";
import {
  closeCodeEditorFileAtom,
  isCodeExplorerOpenAtom,
  openCodeEditorFilesByAppIdAtom,
  reconcileCodeEditorFilesAtom,
  selectCodeEditorFileAtom,
  selectedCodeEditorFileByAppIdAtom,
} from "@/atoms/codeEditorAtoms";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { CodeEditorTabs } from "./CodeEditorTabs";
import { CodeQuickOpen } from "./CodeQuickOpen";

interface App {
  id?: number;
  files?: string[];
}

export interface CodeViewProps {
  loading: boolean;
  app: App | null;
}

const SAVE_ACTIVE_FILE_EVENT = "dyad-save-active-code-editor-file";

export const CodeView = ({ loading, app }: CodeViewProps) => {
  const { t } = useTranslation("home");
  const appId = app?.id ?? null;
  const files = app?.files ?? [];
  const selectedVersionId = useAtomValue(selectedVersionIdAtom);
  const openFilesByAppId = useAtomValue(openCodeEditorFilesByAppIdAtom);
  const selectedFilesByAppId = useAtomValue(selectedCodeEditorFileByAppIdAtom);
  const selectFile = useSetAtom(selectCodeEditorFileAtom);
  const closeFile = useSetAtom(closeCodeEditorFileAtom);
  const reconcileFiles = useSetAtom(reconcileCodeEditorFilesAtom);
  const [isExplorerOpen, setIsExplorerOpen] = useAtom(isCodeExplorerOpenAtom);
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );
  const { refreshApp } = useLoadApp(appId);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isQuickOpen) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen, isQuickOpen]);

  const handleSelectFile = useCallback(
    (path: string, line?: number | null) => {
      selectFile({ appId, file: { path, line } });
    },
    [appId, selectFile],
  );

  const handleCloseFile = useCallback(
    (path: string) => {
      if (selectedFile?.path === path) {
        window.dispatchEvent(new Event(SAVE_ACTIVE_FILE_EVENT));
      }
      closeFile({ appId, path });
    },
    [appId, closeFile, selectedFile?.path],
  );

  useEffect(() => {
    if (isVersionDiffMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      if (!hasCommandModifier || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        setIsQuickOpen(true);
        return;
      }
      if (!workspaceRef.current?.contains(event.target as Node)) return;
      if (key === "e" && event.shiftKey) {
        event.preventDefault();
        setIsExplorerOpen((value) => !value);
        return;
      }
      if (key === "s" && !event.shiftKey && selectedFile) {
        event.preventDefault();
        window.dispatchEvent(new Event(SAVE_ACTIVE_FILE_EVENT));
        return;
      }
      if (event.key === "Tab" && openFiles.length > 1 && selectedFile) {
        event.preventDefault();
        const currentIndex = openFiles.indexOf(selectedFile.path);
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex =
          (currentIndex + direction + openFiles.length) % openFiles.length;
        handleSelectFile(openFiles[nextIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleSelectFile,
    isVersionDiffMode,
    openFiles,
    selectedFile,
    setIsExplorerOpen,
  ]);

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

  if (!isVersionDiffMode && files.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500">
        {t("preview.noFilesFound")}
      </div>
    );
  }

  return (
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
    </div>
  );
};
