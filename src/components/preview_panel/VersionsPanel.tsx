import { useState } from "react";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { History, GitCommit, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export const VersionsPanel = () => {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { versions, loading, revertVersion } = useVersions(selectedAppId);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  if (!selectedAppId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
        <History className="w-10 h-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No app selected</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!versions.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
        <GitCommit className="w-10 h-10 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold">No versions yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Versions are saved automatically as you build
          </p>
        </div>
      </div>
    );
  }

  const handleRevert = async (versionId: string) => {
    setRevertingId(versionId);
    try {
      await revertVersion({ versionId });
    } finally {
      setRevertingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 shrink-0">
        <h2 className="text-sm font-semibold">Version History</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {versions.length} snapshot{versions.length !== 1 ? "s" : ""} — hover to revert
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="relative">
          <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border/50" />
          <div className="space-y-1">
            {versions.map((version, index) => (
              <div
                key={version.oid}
                className={cn(
                  "relative pl-8 pr-2 py-2.5 rounded-lg group hover:bg-muted/50 transition-colors",
                  index === 0 && "bg-primary/5 hover:bg-primary/8",
                )}
              >
                <div
                  className={cn(
                    "absolute left-2 top-[13px] w-3 h-3 rounded-full border-2 bg-background z-10",
                    index === 0
                      ? "border-primary bg-primary/20"
                      : "border-muted-foreground/30",
                  )}
                />
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-snug line-clamp-2">
                      {version.message || "Snapshot"}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-muted-foreground">
                        {formatDistanceToNow(
                          new Date(version.timestamp * 1000),
                          { addSuffix: true },
                        )}
                      </span>
                      {index === 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                          Current
                        </span>
                      )}
                    </div>
                  </div>
                  {index !== 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      disabled={revertingId === version.oid}
                      onClick={() => handleRevert(version.oid)}
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      {revertingId === version.oid ? "Reverting…" : "Revert"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
