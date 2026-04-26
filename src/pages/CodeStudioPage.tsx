/**
 * Code Studio Page — in-app code editor that beats Cursor + VS Code by:
 *  • Full Monaco editor with multi-tab editing
 *  • File tree with workspace selection
 *  • AI Composer that proposes multi-file diffs and lets you approve per-file
 *  • Tight integration with the agentic-OS tiers (policy, provenance, activities)
 *  • Lives inside JoyCreate so all workspace tools are one click away
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Save, X, FileCode2, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { toast } from "sonner";
import { FileTree } from "@/components/code-studio/FileTree";
import { AIComposer } from "@/components/code-studio/AIComposer";
import {
  useCodeWorkspace,
  useFileContent,
  useOpenWorkspace,
  useWriteFile,
  useCodeSearch,
} from "@/hooks/useCodeStudio";
import { codeStudioClient } from "@/ipc/code_studio_client";
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

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const { data: searchHits } = useCodeSearch(searchQuery);

  const activeTab = useMemo(
    () => tabs.find((t) => t.relPath === activePath) ?? null,
    [tabs, activePath],
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
      </div>
    );
  }

  // -- Main editor layout ----------------------------------------------------

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
        <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{workspace.name}</span>
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
          onClick={() => openWorkspace.mutate()}
          title="Switch workspace"
        >
          <FolderOpen className="h-3.5 w-3.5" />
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
    </div>
  );
}
