/**
 * AI Composer Panel — surpasses Cursor by integrating with the agentic-OS
 * (Wallet/Policy + Provenance + OS Activities) and JoyCreate's Coding Agent.
 *
 * Flow:
 *  1. User describes intent (current open file is sent as primary context).
 *  2. The Coding Agent runs the task end-to-end (plans, executes, verifies).
 *  3. Each FileChange is shown with its diff and a "Reload in editor" action.
 *  4. The OS Activity feed + Provenance log capture every change automatically
 *     (Tier 1/4 wiring inside the agent).
 */

import { useEffect, useState } from "react";
import { Sparkles, Send, Loader2, FilePlus, FileEdit, FileX, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { codingAgentClient } from "@/ipc/coding_agent_client";
import type { AgentSessionId, FileChange } from "@/lib/coding_agent";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AIComposerProps {
  openFile: string | null;
  openFileContent: string | null;
  /** Called after the agent finishes so the editor can reload changed files. */
  onApplied: (paths: string[]) => void;
}

interface RunRecord {
  id: string;
  intent: string;
  summary: string;
  success: boolean;
  changes: FileChange[];
  durationMs: number;
}

export function AIComposer({ openFile, openFileContent, onApplied }: AIComposerProps) {
  const [intent, setIntent] = useState("");
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<AgentSessionId | null>(null);
  const [history, setHistory] = useState<RunRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await codingAgentClient.createSession({ autoApprove: true, safeMode: true });
        if (!cancelled) setSessionId(s.id);
      } catch (err) {
        console.warn("Could not start coding agent session", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run() {
    if (!intent.trim() || !sessionId) return;
    setRunning(true);
    const startedAt = Date.now();
    const description = intent.trim();
    setIntent("");
    try {
      const context =
        openFile && openFileContent
          ? {
              files: [
                {
                  path: openFile,
                  content: openFileContent,
                  language: openFile.split(".").pop() ?? "text",
                  relevance: 1,
                },
              ],
              userInstructions: description,
            }
          : undefined;

      const task = await codingAgentClient.runTask(sessionId, "code", description, context);
      const result = task.result;
      const changes = result?.changes ?? [];

      const record: RunRecord = {
        id: task.id,
        intent: description,
        summary: result?.summary ?? "Task completed",
        success: result?.success ?? false,
        changes,
        durationMs: Date.now() - startedAt,
      };
      setHistory((prev) => [record, ...prev].slice(0, 20));

      const touchedPaths = changes.filter((c) => c.type !== "deleted").map((c) => c.path);
      if (touchedPaths.length > 0) {
        onApplied(touchedPaths);
      }

      if (result?.success) {
        toast.success(`Agent: ${result.summary}`);
      } else {
        toast.warning(`Agent ran but did not succeed: ${result?.summary ?? "unknown"}`);
      }
    } catch (err) {
      toast.error(`Agent error: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/30">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">AI Composer</span>
        {sessionId && (
          <Badge variant="secondary" className="text-[10px] ml-auto font-mono">
            {sessionId.slice(0, 8)}
          </Badge>
        )}
      </div>

      <div className="p-3 space-y-2 border-b border-border/40">
        <Textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void run();
            }
          }}
          placeholder={
            openFile
              ? `Edit ${openFile.split("/").pop()}…\n(Ctrl+Enter to run)`
              : "Describe what you want the agent to build or change…\n(Ctrl+Enter to run)"
          }
          rows={3}
          className="text-sm font-mono resize-none"
          disabled={running || !sessionId}
        />
        <Button
          onClick={run}
          disabled={running || !sessionId || !intent.trim()}
          size="sm"
          className="w-full"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
          ) : (
            <Send className="h-3.5 w-3.5 mr-2" />
          )}
          Run Agent
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-3">
          {history.length === 0 && !running && (
            <div className="text-xs text-muted-foreground p-4 text-center">
              No runs yet. Describe what you want and press <kbd>Ctrl+Enter</kbd>.
            </div>
          )}
          {history.map((rec) => (
            <RunCard key={rec.id} record={rec} onReload={onApplied} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function RunCard({
  record,
  onReload,
}: {
  record: RunRecord;
  onReload: (paths: string[]) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-2 text-xs",
        record.success
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="flex items-start gap-2 mb-1">
        <Badge variant={record.success ? "default" : "secondary"} className="text-[10px]">
          {record.success ? "ok" : "partial"}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{record.intent}</div>
          <div className="text-muted-foreground text-[11px] truncate">{record.summary}</div>
        </div>
        <span className="text-[10px] text-muted-foreground/70 shrink-0">
          {(record.durationMs / 1000).toFixed(1)}s
        </span>
      </div>
      {record.changes.length > 0 && (
        <div className="space-y-1 mt-2 border-t border-border/30 pt-2">
          {record.changes.map((c, i) => (
            <ChangeRow key={`${c.path}-${i}`} change={c} onReload={onReload} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeRow({
  change,
  onReload,
}: {
  change: FileChange;
  onReload: (paths: string[]) => void;
}) {
  const Icon =
    change.type === "created" ? FilePlus : change.type === "deleted" ? FileX : FileEdit;
  const color =
    change.type === "created"
      ? "text-emerald-600 dark:text-emerald-400"
      : change.type === "deleted"
        ? "text-rose-600 dark:text-rose-400"
        : "text-blue-600 dark:text-blue-400";
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("h-3 w-3 shrink-0", color)} />
      <span className="font-mono text-[11px] truncate flex-1">{change.path}</span>
      {(change.linesAdded ?? 0) > 0 && (
        <span className="text-emerald-500 text-[10px] font-mono">+{change.linesAdded}</span>
      )}
      {(change.linesRemoved ?? 0) > 0 && (
        <span className="text-rose-500 text-[10px] font-mono">-{change.linesRemoved}</span>
      )}
      {change.type !== "deleted" && (
        <button
          type="button"
          onClick={() => onReload([change.path])}
          className="p-0.5 rounded hover:bg-accent"
          title="Reload in editor"
        >
          <RefreshCw className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
