import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { AlertTriangle, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface ConflictResolverProps {
  appId: number;
  conflicts: string[];
  onResolve: () => void;
  onCancel: () => void;
}

export function GithubConflictResolver({
  appId,
  conflicts,
  onResolve,
  onCancel,
}: ConflictResolverProps) {
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);
  const [fileContent, setFileContent] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isAiResolving, setIsAiResolving] = useState(false);

  const currentFile = conflicts[currentConflictIndex];

  useEffect(() => {
    loadFileContent();
  }, [currentFile, appId]);

  const loadFileContent = async () => {
    if (!currentFile) return;
    try {
      const content = await IpcClient.getInstance().readAppFile(
        appId,
        currentFile,
      );
      setFileContent(content);
    } catch (error: any) {
      toast.error(`Failed to load file ${currentFile}: ${error.message}`);
    }
  };

  const handleAiResolve = async () => {
    setIsAiResolving(true);
    try {
      const result = await IpcClient.getInstance().resolveGithubConflict(
        appId,
        currentFile,
      );
      if (result.success && result.resolution) {
        setFileContent(result.resolution);
        toast.success("AI suggested a resolution");
      } else {
        toast.error(result.error || "Failed to resolve with AI");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to resolve with AI");
    } finally {
      setIsAiResolving(false);
    }
  };

  const handleSaveResolution = async () => {
    setIsResolving(true);
    try {
      // Save the resolved content
      await IpcClient.getInstance().editAppFile(
        appId,
        currentFile,
        fileContent,
      );

      // Stage the file (git add) - we need an IPC for this or just assume the user will commit later?
      // Ideally we should mark it as resolved.
      // For now, just saving the file removes the conflict markers, which is the first step.
      // The user will still need to commit.

      toast.success(`Resolved ${currentFile}`);

      if (currentConflictIndex < conflicts.length - 1) {
        setCurrentConflictIndex(currentConflictIndex + 1);
      } else {
        onResolve();
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to save resolution");
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Resolve Conflicts ({currentConflictIndex + 1}/{conflicts.length})
          </DialogTitle>
          <DialogDescription>
            Resolving conflict in:{" "}
            <span className="font-mono font-bold">{currentFile}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 border rounded-md overflow-hidden flex flex-col">
          <div className="bg-gray-100 dark:bg-gray-800 p-2 flex justify-between items-center border-b">
            <span className="text-xs text-gray-500">
              Edit manually or use AI to resolve. Look for
              &lt;&lt;&lt;&lt;&lt;&lt;&lt;, =======,
              &gt;&gt;&gt;&gt;&gt;&gt;&gt; markers.
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAiResolve}
              disabled={isAiResolving}
              className="gap-2"
            >
              <Wand2 className="h-3 w-3" />
              {isAiResolving ? "AI Resolving..." : "Auto-Resolve with AI"}
            </Button>
          </div>
          <Textarea
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            className="flex-1 font-mono text-sm p-4 resize-none border-0 focus-visible:ring-0 rounded-none"
            spellCheck={false}
          />
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSaveResolution} disabled={isResolving}>
            {currentConflictIndex < conflicts.length - 1
              ? "Next Conflict"
              : "Finish Resolution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
