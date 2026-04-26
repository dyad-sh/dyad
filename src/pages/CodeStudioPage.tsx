/**
 * Code Studio Page — in-app code editor that beats Cursor + VS Code by:
 *  • Full Monaco editor with multi-tab editing
 *  • File tree with workspace selection
 *  • AI Composer that proposes multi-file diffs and lets you approve per-file
 *  • Tight integration with the agentic-OS tiers (policy, provenance, activities)
 *  • Lives inside JoyCreate so all workspace tools are one click away
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Save, X, FileCode2, Search, Loader2, GitBranch, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FileTree } from "@/components/code-studio/FileTree";
import { AIComposer } from "@/components/code-studio/AIComposer";
import {
  useAddCodeProject,
  useCloneRepo,
  useCodeProjects,
  useCodeWorkspace,
  useCodeSearch,
  useOpenWorkspace,
  useRemoveCodeProject,
  useSwitchCodeProject,
  useWriteFile,
} from "@/hooks/useCodeStudio";
import { codeStudioClient, type CodeStudioProject } from "@/ipc/code_studio_client";
import { cn } from "@/lib/utils";

// Lazy-load Monaco so it doesn't block initial app boot.
const MonacoEditor = lazy(() => import("@monaco-editor/react"));

interface OpenTab {
  relPath: string;
  content: string;
  language: string;
  dirty: boolean;
  /** original content as last loaded/saved — for dirty detection */
  baseline: string;
}

export default function CodeStudioPage() {
  const { data: workspace, isLoading: wsLoading } = useCodeWorkspace();
  const openWorkspace = useOpenWorkspace();
  const writeFile = useWriteFile();
  const { data: projects = [] } = useCodeProjects();
  const addProject = useAddCodeProject();
  const removeProject = useRemoveCodeProject();
  const switchProject = useSwitchCodeProject();
  const cloneRepo = useCloneRepo();

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);

  const { data: searchHits } = useCodeSearch(searchQuery);

  const activeTab = useMemo(
    () => tabs.find((t) => t.relPath === activePath) ?? null,
    [tabs, activePath],
  );

  // Switch to another registered project — clears open tabs (they are
  // workspace-relative and would resolve against the wrong root).
  const handleSwitchProject = useCallback(
    async (project: CodeStudioProject) => {
      try {
        await switchProject.mutateAsync(project.id);
        setTabs([]);
        setActivePath(null);
        setSearchQuery("");
        toast.success(`Switched to ${project.name}`);
      } catch (err) {
        toast.error(`Could not switch project: ${(err as Error).message}`);
      }
    },
    [switchProject],
  );

  const handleRemoveProject = useCallback(
    async (project: CodeStudioProject) => {
      try {
        await removeProject.mutateAsync(project.id);
        toast.success(`Removed ${project.name} from list`);
      } catch (err) {
        toast.error(`Could not remove project: ${(err as Error).message}`);
      }
    },
    [removeProject],
  );

  const handleClone = useCallback(
    async (url: string) => {
      try {
        const project = await cloneRepo.mutateAsync({ url });
        setTabs([]);
        setActivePath(null);
        setCloneDialogOpen(false);
        toast.success(`Cloned ${project.name}`);
      } catch (err) {
        toast.error(`Clone failed: ${(err as Error).message}`);
      }
    },
    [cloneRepo],
  );

  // Open a file: if already in tabs, just focus it; otherwise load and add a new tab.
  const openFile = useCallback(
    async (relPath: string) => {
      if (tabs.some((t) => t.relPath === relPath)) {
        setActivePath(relPath);
        return;
      }
      try {
        const file = await codeStudioClient.readFile(relPath);
        setTabs((prev) => [
          ...prev,
          {
            relPath: file.relPath,
            content: file.content,
            language: file.language,
            dirty: false,
            baseline: file.content,
          },
        ]);
        setActivePath(file.relPath);
      } catch (err) {
        toast.error(`Failed to open ${relPath}: ${(err as Error).message}`);
      }
    },
    [tabs],
  );

  const closeTab = useCallback(
    (relPath: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.relPath === relPath);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.relPath !== relPath);
        if (activePath === relPath) {
          setActivePath(next[Math.max(0, idx - 1)]?.relPath ?? null);
        }
        return next;
      });
    },
    [activePath],
  );

  const updateContent = useCallback(
    (relPath: string, value: string | undefined) => {
      const newValue = value ?? "";
      setTabs((prev) =>
        prev.map((t) =>
          t.relPath === relPath
            ? { ...t, content: newValue, dirty: newValue !== t.baseline }
            : t,
        ),
      );
    },
    [],
  );

  const save = useCallback(async () => {
    if (!activeTab || !activeTab.dirty) return;
    try {
      await writeFile.mutateAsync({ relPath: activeTab.relPath, content: activeTab.content });
      setTabs((prev) =>
        prev.map((t) =>
          t.relPath === activeTab.relPath ? { ...t, dirty: false, baseline: t.content } : t,
        ),
      );
      toast.success(`Saved ${activeTab.relPath}`);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  }, [activeTab, writeFile]);

  // Ctrl/Cmd+S → save active file
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") {
        e.preventDefault();
        setShowSearch(true);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  // After agent applies patches, reload the affected open tabs
  const handlePatchesApplied = useCallback(async (paths: string[]) => {
    for (const p of paths) {
      try {
        const file = await codeStudioClient.readFile(p);
        setTabs((prev) => {
          const existing = prev.find((t) => t.relPath === file.relPath);
          if (!existing) {
            return [
              ...prev,
              {
                relPath: file.relPath,
                content: file.content,
                language: file.language,
                dirty: false,
                baseline: file.content,
              },
            ];
          }
          return prev.map((t) =>
            t.relPath === file.relPath
              ? { ...t, content: file.content, baseline: file.content, dirty: false }
              : t,
          );
        });
      } catch {
        // path may have been deleted
      }
    }
  }, []);

  // -- Workspace not yet selected --------------------------------------------

  if (wsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
        <FileCode2 className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">Code Studio</h2>
        <p className="text-muted-foreground max-w-md">
          A full-featured code editor with an AI Composer that proposes multi-file diffs you can
          approve before they're applied. Powered by Monaco — same editor as VS Code and Cursor —
          plus JoyCreate's agentic OS for policy, provenance, and activity tracking.
        </p>
        <div className="flex gap-2 flex-wrap justify-center">
          <Button
            size="lg"
            onClick={() => openWorkspace.mutate()}
            disabled={openWorkspace.isPending}
          >
            {openWorkspace.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <FolderOpen className="h-4 w-4 mr-2" />
            )}
            Open Folder
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => setCloneDialogOpen(true)}
            disabled={cloneRepo.isPending}
          >
            {cloneRepo.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <GitBranch className="h-4 w-4 mr-2" />
            )}
            Clone Repository
          </Button>
        </div>

        {projects.length > 0 && (
          <div className="mt-6 w-full max-w-md text-left">
            <div className="text-xs uppercase text-muted-foreground mb-2 px-1">
              Recent projects
            </div>
            <div className="border rounded-md divide-y divide-border/50 bg-card/40">
              {projects.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSwitchProject(p)}
                  className="w-full text-left px-3 py-2 hover:bg-accent/40 flex items-center gap-2"
                >
                  {p.kind === "cloned" ? (
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{p.root}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <CloneRepoDialog
          open={cloneDialogOpen}
          onOpenChange={setCloneDialogOpen}
          isCloning={cloneRepo.isPending}
          onClone={handleClone}
        />
      </div>
    );
  }

  // -- Main editor layout ----------------------------------------------------

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 px-2 max-w-[40%]"
              title="Switch project"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium truncate">{workspace.name}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projects.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No saved projects yet.
              </div>
            )}
            {projects.map((p) => {
              const isActive =
                workspace?.root && p.root && workspace.root === p.root;
              return (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!isActive) void handleSwitchProject(p);
                  }}
                  className="flex items-start gap-2 py-1.5"
                >
                  {p.kind === "cloned" ? (
                    <GitBranch className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        "text-sm truncate",
                        isActive && "font-semibold text-primary",
                      )}
                    >
                      {p.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {p.root}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove from list"
                    className="opacity-50 hover:opacity-100 hover:text-destructive p-0.5 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      void handleRemoveProject(p);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => addProject.mutate()}>
              <FolderOpen className="h-3.5 w-3.5 mr-2" />
              Add existing folder…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openWorkspace.mutate()}>
              <FolderOpen className="h-3.5 w-3.5 mr-2" />
              Open folder & switch…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCloneDialogOpen(true)}>
              <GitBranch className="h-3.5 w-3.5 mr-2" />
              Clone repository…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-xs text-muted-foreground/60 truncate hidden md:inline">
          {workspace.root}
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowSearch((v) => !v)}
          title="Search (Ctrl+Shift+F)"
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={save}
          disabled={!activeTab?.dirty}
          title="Save (Ctrl+S)"
        >
          <Save className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* File Tree + (optional) Search */}
        <ResizablePanel defaultSize={18} minSize={12} maxSize={35}>
          <div className="h-full flex flex-col bg-muted/10">
            {showSearch && (
              <div className="p-2 border-b border-border/40 space-y-1.5">
                <Input
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 text-xs"
                  autoFocus
                />
                {searchQuery.length >= 2 && searchHits && (
                  <ScrollArea className="max-h-64">
                    <div className="text-[11px] font-mono space-y-0.5">
                      {searchHits.slice(0, 100).map((hit, i) => (
                        <button
                          key={i}
                          onClick={() => openFile(hit.relPath)}
                          className="w-full text-left px-1.5 py-1 rounded hover:bg-accent/50"
                        >
                          <div className="text-primary truncate">{hit.relPath}:{hit.line}</div>
                          <div className="text-muted-foreground truncate">{hit.preview}</div>
                        </button>
                      ))}
                      {searchHits.length === 0 && (
                        <div className="text-muted-foreground text-center py-2">
                          No results
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
            <ScrollArea className="flex-1">
              <FileTree selected={activePath} onSelect={openFile} />
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Editor + Tab Bar */}
        <ResizablePanel defaultSize={52} minSize={30}>
          <div className="h-full flex flex-col">
            {/* Tab Bar */}
            <div className="flex items-center bg-muted/20 border-b border-border/40 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.relPath}
                  onClick={() => setActivePath(tab.relPath)}
                  className={cn(
                    "flex items-center gap-1 px-3 py-1.5 text-xs border-r border-border/30 group",
                    activePath === tab.relPath
                      ? "bg-background"
                      : "bg-transparent hover:bg-background/50 text-muted-foreground",
                  )}
                >
                  <FileCode2 className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[180px]">
                    {tab.relPath.split("/").pop()}
                  </span>
                  {tab.dirty && <span className="text-amber-500">●</span>}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Close tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.relPath);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        closeTab(tab.relPath);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:bg-accent rounded p-0.5 cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>

            {/* Editor */}
            <div className="flex-1 relative">
              {activeTab ? (
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  }
                >
                  <MonacoEditor
                    height="100%"
                    path={activeTab.relPath}
                    language={activeTab.language}
                    value={activeTab.content}
                    theme="vs-dark"
                    onChange={(value) => updateContent(activeTab.relPath, value)}
                    options={{
                      automaticLayout: true,
                      fontSize: 13,
                      minimap: { enabled: true },
                      scrollBeyondLastLine: false,
                      smoothScrolling: true,
                      cursorBlinking: "smooth",
                      wordWrap: "on",
                      tabSize: 2,
                      formatOnPaste: true,
                    }}
                  />
                </Suspense>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a file from the tree to start editing.
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* AI Composer */}
        <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
          <AIComposer
            openFile={activeTab?.relPath ?? null}
            openFileContent={activeTab?.content ?? null}
            onApplied={handlePatchesApplied}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <CloneRepoDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        isCloning={cloneRepo.isPending}
        onClone={handleClone}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clone repository dialog
// ---------------------------------------------------------------------------

function CloneRepoDialog({
  open,
  onOpenChange,
  isCloning,
  onClone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isCloning: boolean;
  onClone: (url: string) => void;
}) {
  const [url, setUrl] = useState("");

  // Reset the input whenever the dialog is reopened
  useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  const trimmed = url.trim();
  const isValidUrl =
    /^https?:\/\/[^\s]+$/i.test(trimmed) || /^git@[^\s:]+:[^\s]+/i.test(trimmed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clone repository</DialogTitle>
          <DialogDescription>
            Clone a Git repository into a folder you choose. The cloned project
            is automatically added to your project switcher.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="clone-url" className="text-xs">
            Repository URL
          </Label>
          <Input
            id="clone-url"
            placeholder="https://github.com/user/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isCloning}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValidUrl && !isCloning) {
                e.preventDefault();
                onClone(trimmed);
              }
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            HTTPS recommended. You'll be prompted for a folder to clone into.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isCloning}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onClone(trimmed)}
            disabled={!isValidUrl || isCloning}
          >
            {isCloning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <GitBranch className="h-4 w-4 mr-2" />
            )}
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
