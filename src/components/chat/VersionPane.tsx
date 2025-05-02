import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom, selectedVersionIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { formatDistanceToNow } from "date-fns";
import { RotateCcw, X } from "lucide-react";
import type { Version } from "@/ipc/ipc_types";
import { IpcClient } from "@/ipc/ipc_client";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface VersionPaneProps {
  isVisible: boolean;
  onClose: () => void;
}

export function VersionPane({ isVisible, onClose }: VersionPaneProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const { versions, loading, refreshVersions, revertVersion } =
    useVersions(appId);
  const [selectedVersionId, setSelectedVersionId] = useAtom(
    selectedVersionIdAtom
  );
  useEffect(() => {
    // Refresh versions in case the user updated versions outside of the app
    // (e.g. manually using git).
    // Avoid loading state which causes brief flash of loading state.
    refreshVersions();
    if (!isVisible && selectedVersionId) {
      setSelectedVersionId(null);
      IpcClient.getInstance().checkoutVersion({
        appId: appId!,
        versionId: "main",
      });
    }
  }, [isVisible, refreshVersions]);
  if (!isVisible) {
    return null;
  }

  return (
    <div className="h-full border-t border-2 border-border w-full">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-semibold pl-2">Version History</h2>
        <button
          onClick={onClose}
          className="p-1 hover:bg-(--background-lightest) rounded-md  "
          aria-label="Close version pane"
        >
          <X size={20} />
        </button>
      </div>
      <div className="overflow-y-auto h-[calc(100%-60px)]">
        {loading ? (
          <div className="p-4 ">Loading versions...</div>
        ) : versions.length === 0 ? (
          <div className="p-4 ">No versions available</div>
        ) : (
          <div className="divide-y divide-border">
            {versions.map((version: Version, index) => (
              <div
                key={version.oid}
                className={`px-4 py-2 hover:bg-(--background-lightest) cursor-pointer ${
                  selectedVersionId === version.oid
                    ? "bg-(--background-lightest)"
                    : ""
                }`}
                onClick={() => {
                  IpcClient.getInstance().checkoutVersion({
                    appId: appId!,
                    versionId: version.oid,
                  });
                  setSelectedVersionId(version.oid);
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs">
                    Version {versions.length - index}
                  </span>
                  <span className="text-xs opacity-90">
                    {formatDistanceToNow(new Date(version.timestamp * 1000), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {version.message && (
                    <p className="mt-1 text-sm">
                      {version.message.startsWith(
                        "Reverted all changes back to version "
                      )
                        ? version.message.replace(
                            /Reverted all changes back to version ([a-f0-9]+)/,
                            (_, hash) => {
                              const targetIndex = versions.findIndex(
                                (v) => v.oid === hash
                              );
                              return targetIndex !== -1
                                ? `Reverted all changes back to version ${
                                    versions.length - targetIndex
                                  }`
                                : version.message;
                            }
                          )
                        : version.message}
                    </p>
                  )}

                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      setSelectedVersionId(null);
                      await revertVersion({
                        versionId: version.oid,
                      });
                    }}
                    className={cn(
                      "invisible mt-1 flex items-center gap-1 px-2 py-0.5 text-sm font-medium bg-(--primary) text-(--primary-foreground) hover:bg-background-lightest rounded-md transition-colors",
                      selectedVersionId === version.oid && "visible"
                    )}
                    aria-label="Undo to latest version"
                  >
                    <RotateCcw size={12} />
                    <span>Undo</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
