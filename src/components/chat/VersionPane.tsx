import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom, selectedVersionIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { formatDistanceToNow } from "date-fns";
import { RotateCcw, X, Database, Loader2 } from "lucide-react";
import type { Version } from "@/ipc/ipc_types";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useCheckoutVersion } from "@/hooks/useCheckoutVersion";
import { useLoadApp } from "@/hooks/useLoadApp";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useRunApp } from "@/hooks/useRunApp";

interface VersionPaneProps {
  isVisible: boolean;
  onClose: () => void;
}

export function VersionPane({ isVisible, onClose }: VersionPaneProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const { refreshApp, app } = useLoadApp(appId);
  const { restartApp } = useRunApp();
  const {
    versions: liveVersions,
    refreshVersions,
    revertVersion,
    isRevertingVersion,
  } = useVersions(appId);

  const [selectedVersionId, setSelectedVersionId] = useAtom(
    selectedVersionIdAtom,
  );
  const { checkoutVersion, isCheckingOutVersion } = useCheckoutVersion();
  const wasVisibleRef = useRef(false);
  const [cachedVersions, setCachedVersions] = useState<Version[]>([]);

  useEffect(() => {
    async function updatePaneState() {
      // When pane becomes visible after being closed
      if (isVisible && !wasVisibleRef.current) {
        if (appId) {
          await refreshVersions();
          setCachedVersions(liveVersions);
        }
      }

      // Reset when closing
      if (!isVisible && selectedVersionId) {
        setSelectedVersionId(null);
        if (appId) {
          await checkoutVersion({ appId, versionId: "main" });
          if (app?.neonProjectId) {
            await restartApp();
          }
        }
      }

      wasVisibleRef.current = isVisible;
    }
    updatePaneState();
  }, [
    isVisible,
    selectedVersionId,
    setSelectedVersionId,
    appId,
    checkoutVersion,
    refreshVersions,
    liveVersions,
  ]);

  // Initial load of cached versions when live versions become available
  useEffect(() => {
    if (isVisible && liveVersions.length > 0 && cachedVersions.length === 0) {
      setCachedVersions(liveVersions);
    }
  }, [isVisible, liveVersions, cachedVersions.length]);

  if (!isVisible) {
    return null;
  }

  const handleVersionClick = async (version: Version) => {
    if (appId) {
      setSelectedVersionId(version.oid);
      try {
        await checkoutVersion({ appId, versionId: version.oid });
      } catch (error) {
        console.error("Could not checkout version, unselecting version", error);
        setSelectedVersionId(null);
      }
      await refreshApp();
      if (version.dbTimestamp) {
        await restartApp();
      }
    }
  };

  const versions = cachedVersions.length > 0 ? cachedVersions : liveVersions;

  return (
    <div className="h-full border-t border-2 border-border w-full">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <h2 className="text-base font-medium pl-2">Version History</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-1 hover:bg-(--background-lightest) rounded-md  "
            aria-label="Close version pane"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto h-[calc(100%-60px)]">
        {versions.length === 0 ? (
          <div className="p-4 ">No versions available</div>
        ) : (
          <div className="divide-y divide-border">
            {versions.map((version: Version, index: number) => (
              <div
                key={version.oid}
                className={cn(
                  "px-4 py-2 hover:bg-(--background-lightest) cursor-pointer",
                  selectedVersionId === version.oid &&
                    "bg-(--background-lightest)",
                  isCheckingOutVersion &&
                    selectedVersionId === version.oid &&
                    "opacity-50 cursor-not-allowed",
                )}
                onClick={() => {
                  if (!isCheckingOutVersion) {
                    handleVersionClick(version);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs">
                      Version {versions.length - index} (
                      {version.oid.slice(0, 7)})
                    </span>
                    {/* example format: '2025-07-25T21:52:01Z' */}
                    {version.dbTimestamp &&
                      (() => {
                        const timestampMs = new Date(
                          version.dbTimestamp,
                        ).getTime();
                        const isExpired =
                          Date.now() - timestampMs > 24 * 60 * 60 * 1000;
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-md",
                                  isExpired
                                    ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                                )}
                              >
                                <Database size={10} />
                                <span>DB</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isExpired
                                ? "DB snapshot may have expired (older than 24 hours)"
                                : `Database snapshot available at timestamp ${version.dbTimestamp}`}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                  </div>
                  <div className="flex items-center gap-2">
                    {isCheckingOutVersion &&
                      selectedVersionId === version.oid && (
                        <Loader2
                          size={12}
                          className="animate-spin text-primary"
                        />
                      )}
                    <span className="text-xs opacity-90">
                      {isCheckingOutVersion && selectedVersionId === version.oid
                        ? "Loading..."
                        : formatDistanceToNow(
                            new Date(version.timestamp * 1000),
                            {
                              addSuffix: true,
                            },
                          )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {version.message && (
                    <p className="mt-1 text-sm">
                      {version.message.startsWith(
                        "Reverted all changes back to version ",
                      )
                        ? version.message.replace(
                            /Reverted all changes back to version ([a-f0-9]+)/,
                            (_, hash) => {
                              const targetIndex = versions.findIndex(
                                (v) => v.oid === hash,
                              );
                              return targetIndex !== -1
                                ? `Reverted all changes back to version ${
                                    versions.length - targetIndex
                                  }`
                                : version.message;
                            },
                          )
                        : version.message}
                    </p>
                  )}

                  <div className="flex items-center gap-1">
                    {/* Restore button */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();

                            await revertVersion({
                              versionId: version.oid,
                            });
                            setSelectedVersionId(null);
                            // Close the pane after revert to force a refresh on next open
                            onClose();
                            if (version.dbTimestamp) {
                              await restartApp();
                            }
                          }}
                          disabled={isRevertingVersion}
                          className={cn(
                            "invisible mt-1 flex items-center gap-1 px-2 py-0.5 text-sm font-medium bg-(--primary) text-(--primary-foreground) hover:bg-background-lightest rounded-md transition-colors",
                            selectedVersionId === version.oid && "visible",
                            isRevertingVersion &&
                              "opacity-50 cursor-not-allowed",
                          )}
                          aria-label="Restore to this version"
                        >
                          {isRevertingVersion ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          <span>
                            {isRevertingVersion ? "Restoring..." : "Restore"}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isRevertingVersion
                          ? "Restoring to this version..."
                          : "Restore to this version"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
