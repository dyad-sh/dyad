import { useAtom, useAtomValue } from "jotai";
import { selectedAppIdAtom, selectedVersionIdAtom } from "@/atoms/appAtoms";
import { useVersions } from "@/hooks/useVersions";
import { formatDistanceToNow } from "date-fns";
import {
  RotateCcw,
  X,
  Database,
  Loader2,
  Search,
  Star,
  Pencil,
} from "lucide-react";
import type { Version } from "@/ipc/types";
import { ipc, MAX_VERSION_NOTE_LENGTH } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCheckoutVersion } from "@/hooks/useCheckoutVersion";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useCurrentBranch } from "@/hooks/useCurrentBranch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Virtuoso } from "react-virtuoso";

import { useRunApp } from "@/hooks/useRunApp";
import { showError } from "@/lib/toast";

function HighlightMatch({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.ReactNode {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 rounded-sm">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

interface VersionPaneProps {
  isVisible: boolean;
  onClose: () => void;
  onOpen: () => void;
}

type SaveVersionNote = (
  appId: number | null,
  versionId: string,
  note: string | null,
  previousNote: string | null,
  saveSequence: number,
  syncCache: boolean,
) => void;

type PendingNoteSave = {
  timeout: ReturnType<typeof setTimeout>;
  appId: number | null;
  versionId: string;
  note: string | null;
  previousNote: string | null;
  saveSequence: number;
  saveVersionNote: SaveVersionNote;
};

function getPendingNoteSaveKey(appId: number | null, versionId: string) {
  return `${appId ?? "none"}:${versionId}`;
}

interface VersionRowProps {
  version: Version;
  versionNumber: number;
  thumbnailUrl: string | undefined;
  searchQuery: string;
  selectedVersionId: string | null;
  isCheckingOutVersion: boolean;
  isResolvingPreviewBranch: boolean;
  isRevertingVersion: boolean;
  isAnyVersionMutationPending: boolean;
  showNoteEditor: boolean;
  shouldAutoFocusNote: boolean;
  versionNumberByOid: Map<string, number>;
  onVersionClick: (version: Version) => void;
  onToggleFavorite: (version: Version) => void;
  onNoteFocus: (versionId: string) => void;
  onNoteChange: (version: Version, note: string) => void;
  onNoteBlur: (versionId: string, note: string | null) => void;
  onExpandNote: (versionId: string) => void;
  onRestoreVersion: (version: Version) => void;
}

function VersionRow({
  version,
  versionNumber,
  thumbnailUrl,
  searchQuery,
  selectedVersionId,
  isCheckingOutVersion,
  isResolvingPreviewBranch,
  isRevertingVersion,
  isAnyVersionMutationPending,
  showNoteEditor,
  shouldAutoFocusNote,
  versionNumberByOid,
  onVersionClick,
  onToggleFavorite,
  onNoteFocus,
  onNoteChange,
  onNoteBlur,
  onExpandNote,
  onRestoreVersion,
}: VersionRowProps) {
  const isRestoreDisabled =
    isRevertingVersion ||
    isCheckingOutVersion ||
    isResolvingPreviewBranch ||
    isAnyVersionMutationPending;
  const trimmedSearchQuery = searchQuery.trim();
  const displayMessage =
    version.message &&
    (version.message.startsWith("Reverted all changes back to version ")
      ? version.message.replace(
          /Reverted all changes back to version ([a-f0-9]+)/,
          (_, hash) => {
            const targetVersionNumber = versionNumberByOid.get(hash);
            return targetVersionNumber !== undefined
              ? `Reverted all changes back to version ${targetVersionNumber}`
              : version.message;
          },
        )
      : version.message);

  return (
    <div
      data-testid={`version-row-${versionNumber}`}
      className={cn(
        "px-4 py-2 hover:bg-(--background-lightest) cursor-pointer flex gap-3 border-b border-border",
        selectedVersionId === version.oid && "bg-(--background-lightest)",
        isCheckingOutVersion &&
          selectedVersionId === version.oid &&
          "opacity-50 cursor-not-allowed",
      )}
      onClick={() => {
        if (!isCheckingOutVersion) {
          onVersionClick(version);
        }
      }}
    >
      <div data-testid="version-list-item" className="flex gap-3 w-full">
        <div
          className="flex-shrink-0 w-16 h-10 rounded border border-border bg-muted overflow-hidden flex items-center justify-center"
          aria-hidden="true"
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover object-top"
            />
          ) : (
            <span className="text-[10px] font-mono text-muted-foreground">
              {version.oid.slice(0, 4)}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid={`version-favorite-button-${versionNumber}`}
                aria-label={
                  version.isFavorite
                    ? `Remove version ${versionNumber} from favorites`
                    : `Favorite version ${versionNumber}`
                }
                title={
                  version.isFavorite
                    ? "Remove version from favorites"
                    : "Favorite version"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(version);
                }}
                className={cn(
                  "rounded-sm p-0.5 transition-colors",
                  version.isFavorite
                    ? "text-[#6c55dc]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Star
                  className={cn(
                    "h-3.5 w-3.5",
                    version.isFavorite && "fill-[#6c55dc]",
                  )}
                />
              </button>
              <span className="font-medium text-xs">
                Version{" "}
                <HighlightMatch
                  text={String(versionNumber)}
                  query={trimmedSearchQuery}
                />{" "}
                (
                <HighlightMatch
                  text={version.oid.slice(0, 7)}
                  query={trimmedSearchQuery}
                />
                )
              </span>
              {/* example format: '2025-07-25T21:52:01Z' */}
              {version.dbTimestamp &&
                (() => {
                  const timestampMs = new Date(version.dbTimestamp).getTime();
                  const isExpired =
                    Date.now() - timestampMs > 24 * 60 * 60 * 1000;
                  return (
                    <Tooltip>
                      <TooltipTrigger>
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
              {isCheckingOutVersion && selectedVersionId === version.oid && (
                <Loader2 size={12} className="animate-spin text-primary" />
              )}
              <span className="text-xs opacity-90">
                {isCheckingOutVersion && selectedVersionId === version.oid
                  ? "Loading..."
                  : formatDistanceToNow(new Date(version.timestamp * 1000), {
                      addSuffix: true,
                    })}
              </span>
            </div>
          </div>
          <div className="mt-1 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {displayMessage && (
                <p className="text-sm">
                  <HighlightMatch
                    text={displayMessage}
                    query={trimmedSearchQuery}
                  />
                </p>
              )}

              {showNoteEditor ? (
                <Textarea
                  value={version.note ?? ""}
                  placeholder="Add note..."
                  aria-label={`Note for version ${versionNumber}`}
                  autoFocus={shouldAutoFocusNote}
                  maxLength={MAX_VERSION_NOTE_LENGTH}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  onFocus={() => onNoteFocus(version.oid)}
                  onChange={(e) => onNoteChange(version, e.target.value)}
                  onBlur={(e) => onNoteBlur(version.oid, e.target.value)}
                  className="mt-2 min-h-8 resize-none px-2 py-1 text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
                />
              ) : (
                <button
                  type="button"
                  aria-label={`Add note for version ${versionNumber}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpandNote(version.oid);
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                  <span>Add note</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRestoreVersion(version);
                }}
                disabled={isRestoreDisabled}
                className={cn(
                  "invisible mt-1 flex items-center gap-1 px-2 py-0.5 text-sm font-medium bg-(--primary) text-(--primary-foreground) hover:bg-background-lightest rounded-md transition-colors",
                  selectedVersionId === version.oid && "visible",
                  isRestoreDisabled && "opacity-50 cursor-not-allowed",
                )}
                aria-label="Restore to this version"
                title={
                  isRevertingVersion
                    ? "Restoring to this version..."
                    : isCheckingOutVersion || isResolvingPreviewBranch
                      ? "Preparing version preview..."
                      : "Restore to this version"
                }
              >
                {isRevertingVersion ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RotateCcw size={12} />
                )}
                <span>{isRevertingVersion ? "Restoring..." : "Restore"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VersionPane({ isVisible, onClose, onOpen }: VersionPaneProps) {
  const appId = useAtomValue(selectedAppIdAtom);
  const currentAppIdRef = useRef(appId);
  const previousAppIdRef = useRef(appId);
  currentAppIdRef.current = appId;
  const { refreshApp, app } = useLoadApp(appId);
  const { restartApp } = useRunApp();
  const {
    versions: liveVersions,
    refreshVersions,
    revertVersion,
    isRevertingVersion,
    setVersionFavorite,
    setVersionNote,
    isAnyVersionMutationPending,
  } = useVersions(appId);

  const [selectedVersionId, setSelectedVersionId] = useAtom(
    selectedVersionIdAtom,
  );
  const { checkoutVersion, isCheckingOutVersion } = useCheckoutVersion();
  const { refetchBranchInfo } = useCurrentBranch(appId);
  const wasVisibleRef = useRef(false);
  const isVisibleRef = useRef(isVisible);
  const previewRequestIdRef = useRef(0);
  const isResolvingPreviewBranchRef = useRef(false);
  const isPreviewCheckoutInProgressRef = useRef(false);
  const activePreviewCheckoutPromiseRef = useRef<Promise<void> | null>(null);
  const checkedOutVersionIdRef = useRef<string | null>(null);
  const returnBranchRef = useRef<{ appId: number; branch: string } | null>(
    null,
  );
  const getReturnBranch = useCallback(
    () =>
      returnBranchRef.current?.appId === appId
        ? returnBranchRef.current.branch
        : null,
    [appId],
  );
  const [cachedVersions, setCachedVersions] = useState<Version[]>([]);
  const [isResolvingPreviewBranch, setIsResolvingPreviewBranch] =
    useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [expandedNoteVersionIds, setExpandedNoteVersionIds] = useState<
    Set<string>
  >(() => new Set());
  const [autoFocusNoteVersionIds, setAutoFocusNoteVersionIds] = useState<
    Set<string>
  >(() => new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const noteSaveTimeoutsRef = useRef(new Map<string, PendingNoteSave>());
  const noteSaveSequencesRef = useRef(new Map<string, number>());
  const liveVersionsRef = useRef(liveVersions);
  liveVersionsRef.current = liveVersions;

  const { data: screenshotsData } = useQuery({
    queryKey: queryKeys.apps.screenshots({ appId }),
    queryFn: () => ipc.app.listAppScreenshots({ appId: appId! }),
    enabled: isVisible && !!appId,
  });
  const screenshotByHash = useMemo(
    () =>
      new Map(
        screenshotsData?.screenshots.map((s) => [s.commitHash, s.url]) ?? [],
      ),
    [screenshotsData],
  );

  const updateCachedVersion = useCallback(
    (
      versionId: string,
      updates: Partial<Pick<Version, "isFavorite" | "note">>,
    ) => {
      setCachedVersions((prevVersions) => {
        const sourceVersions =
          prevVersions.length > 0 ? prevVersions : liveVersionsRef.current;
        if (sourceVersions.length === 0) {
          return prevVersions;
        }
        return sourceVersions.map((version) =>
          version.oid === versionId ? { ...version, ...updates } : version,
        );
      });
    },
    [],
  );

  const saveVersionNote = useCallback(
    async (
      targetAppId: number | null,
      versionId: string,
      note: string | null,
      previousNote: string | null,
      saveSequence: number,
      syncCache = true,
    ) => {
      const pendingSaveKey = getPendingNoteSaveKey(targetAppId, versionId);
      const isLatestSave = () =>
        noteSaveSequencesRef.current.get(pendingSaveKey) === saveSequence;
      try {
        const result = await setVersionNote({
          appId: targetAppId,
          versionId,
          note,
        });
        if (
          syncCache &&
          isLatestSave() &&
          targetAppId === currentAppIdRef.current
        ) {
          updateCachedVersion(result.oid, { note: result.note });
        }
      } catch {
        if (
          syncCache &&
          isLatestSave() &&
          targetAppId === currentAppIdRef.current
        ) {
          updateCachedVersion(versionId, { note: previousNote });
        }
      } finally {
        if (isLatestSave()) {
          noteSaveSequencesRef.current.delete(pendingSaveKey);
        }
      }
    },
    [setVersionNote, updateCachedVersion],
  );
  const flushPendingNoteSaves = useCallback((syncCache = true) => {
    const pendingSaves = [...noteSaveTimeoutsRef.current.entries()];
    noteSaveTimeoutsRef.current.clear();
    for (const [, pendingSave] of pendingSaves) {
      clearTimeout(pendingSave.timeout);
      void pendingSave.saveVersionNote(
        pendingSave.appId,
        pendingSave.versionId,
        pendingSave.note,
        pendingSave.previousNote,
        pendingSave.saveSequence,
        syncCache && pendingSave.appId === currentAppIdRef.current,
      );
    }
  }, []);

  const versions = cachedVersions.length > 0 ? cachedVersions : liveVersions;

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  const versionNumberByOid = useMemo(() => {
    const map = new Map<string, number>();
    for (let index = 0; index < versions.length; index++) {
      map.set(versions[index].oid, versions.length - index);
    }
    return map;
  }, [versions]);

  useEffect(() => {
    async function updatePaneState() {
      // When pane becomes visible after being closed
      if (isVisible && !wasVisibleRef.current) {
        returnBranchRef.current = null;
        checkedOutVersionIdRef.current = null;
        isResolvingPreviewBranchRef.current = false;
        setIsResolvingPreviewBranch(false);
        if (appId) {
          const result = await refreshVersions();
          setCachedVersions(result.data ?? liveVersionsRef.current);
        }
      }

      // Reset when closing
      if (!isVisible && wasVisibleRef.current) {
        previewRequestIdRef.current += 1;
        const wasResolvingPreviewBranch = isResolvingPreviewBranchRef.current;
        isResolvingPreviewBranchRef.current = false;
        setIsResolvingPreviewBranch(false);
        flushPendingNoteSaves();
        setSearchQuery("");
        setShowFavoritesOnly(false);
        setExpandedNoteVersionIds(new Set());
        setAutoFocusNoteVersionIds(new Set());
        if (selectedVersionId && appId) {
          setSelectedVersionId(null);
          const returnBranch = getReturnBranch();
          if (wasResolvingPreviewBranch && !returnBranch) {
            checkedOutVersionIdRef.current = null;
            returnBranchRef.current = null;
            wasVisibleRef.current = isVisible;
            return;
          }
          if (returnBranch) {
            const activePreviewCheckout =
              activePreviewCheckoutPromiseRef.current;
            if (activePreviewCheckout) {
              await activePreviewCheckout;
            }
            let returnedToBranch = false;
            try {
              await checkoutVersion({ appId, versionId: returnBranch });
              returnedToBranch = true;
            } catch (error) {
              console.error("Could not return to branch", error);
              showError(
                "Unable to return to the branch that was active before previewing this version. Reopen Version History to try again.",
                {
                  action: {
                    label: "Reopen Version History",
                    onClick: onOpen,
                  },
                },
              );
            } finally {
              checkedOutVersionIdRef.current = null;
              returnBranchRef.current = null;
            }
            if (returnedToBranch && app?.neonProjectId) {
              await restartApp();
            }
          } else {
            showError(
              "Unable to determine the branch to return to. Dyad left the current version checked out instead of switching branches.",
              {
                action: {
                  label: "Reopen Version History",
                  onClick: onOpen,
                },
              },
            );
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
    app?.neonProjectId,
    checkoutVersion,
    flushPendingNoteSaves,
    getReturnBranch,
    onOpen,
    refreshVersions,
    restartApp,
  ]);

  useEffect(() => {
    if (previousAppIdRef.current === appId) {
      return;
    }
    previousAppIdRef.current = appId;
    returnBranchRef.current = null;
    previewRequestIdRef.current += 1;
    isResolvingPreviewBranchRef.current = false;
    checkedOutVersionIdRef.current = null;
    setIsResolvingPreviewBranch(false);
    flushPendingNoteSaves(false);
    setCachedVersions([]);
    setSearchQuery("");
    setShowFavoritesOnly(false);
    setExpandedNoteVersionIds(new Set());
    setAutoFocusNoteVersionIds(new Set());
  }, [appId, flushPendingNoteSaves]);

  useEffect(() => {
    return () => {
      previewRequestIdRef.current += 1;
      isVisibleRef.current = false;
      flushPendingNoteSaves(false);
    };
  }, [flushPendingNoteSaves]);

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
    if (appId && !isPreviewCheckoutInProgressRef.current) {
      const previewRequestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = previewRequestId;
      const isCurrentPreviewRequest = () =>
        previewRequestIdRef.current === previewRequestId &&
        isVisibleRef.current &&
        currentAppIdRef.current === appId;
      isResolvingPreviewBranchRef.current = true;
      setIsResolvingPreviewBranch(true);
      setSelectedVersionId(version.oid);
      let latestBranchResult: Awaited<ReturnType<typeof refetchBranchInfo>>;
      try {
        latestBranchResult = await refetchBranchInfo();
      } catch (error) {
        if (!isCurrentPreviewRequest()) {
          return;
        }
        console.error("Could not determine current branch", error);
        isResolvingPreviewBranchRef.current = false;
        setIsResolvingPreviewBranch(false);
        setSelectedVersionId(checkedOutVersionIdRef.current);
        showError(
          "Unable to determine the current Git branch. Version preview was cancelled to avoid switching branches.",
        );
        return;
      }
      if (!isCurrentPreviewRequest()) {
        return;
      }
      isResolvingPreviewBranchRef.current = false;
      setIsResolvingPreviewBranch(false);
      if (latestBranchResult.isError) {
        setSelectedVersionId(checkedOutVersionIdRef.current);
        showError(
          "Unable to determine the current Git branch. Version preview was cancelled to avoid switching branches.",
        );
        return;
      }
      const latestBranch = latestBranchResult.data?.branch;
      if (latestBranch && latestBranch !== "<no-branch>") {
        returnBranchRef.current = { appId, branch: latestBranch };
      }
      const returnBranch = getReturnBranch();
      if (!returnBranch) {
        setSelectedVersionId(checkedOutVersionIdRef.current);
        showError(
          "Unable to determine the current Git branch. Version preview was cancelled to avoid switching branches.",
        );
        return;
      }
      isPreviewCheckoutInProgressRef.current = true;
      const previewCheckoutPromise = checkoutVersion({
        appId,
        versionId: version.oid,
      });
      const previewCheckoutSettledPromise = previewCheckoutPromise.then(
        () => undefined,
        () => undefined,
      );
      activePreviewCheckoutPromiseRef.current = previewCheckoutSettledPromise;
      try {
        await previewCheckoutPromise;
        checkedOutVersionIdRef.current = version.oid;
      } catch (error) {
        console.error("Could not checkout version, unselecting version", error);
        if (isCurrentPreviewRequest()) {
          setSelectedVersionId(checkedOutVersionIdRef.current);
        }
        return;
      } finally {
        isPreviewCheckoutInProgressRef.current = false;
        if (
          activePreviewCheckoutPromiseRef.current ===
          previewCheckoutSettledPromise
        ) {
          activePreviewCheckoutPromiseRef.current = null;
        }
      }
      if (!isCurrentPreviewRequest()) {
        return;
      }
      await refreshApp();
      if (version.dbTimestamp && isCurrentPreviewRequest()) {
        await restartApp();
      }
    }
  };

  const favoriteFilteredVersions = showFavoritesOnly
    ? versions.filter((version) => version.isFavorite)
    : versions;

  const filteredVersions = searchQuery.trim()
    ? favoriteFilteredVersions.filter((v) => {
        const query = searchQuery.toLowerCase();
        const versionNumber = String(versionNumberByOid.get(v.oid) ?? 0);
        return (
          v.oid.toLowerCase().includes(query) ||
          (v.message && v.message.toLowerCase().includes(query)) ||
          (v.note && v.note.toLowerCase().includes(query)) ||
          versionNumber.includes(query)
        );
      })
    : favoriteFilteredVersions;

  const queueVersionNoteSave = (
    versionId: string,
    note: string | null,
    previousNote: string | null,
  ) => {
    const pendingSaveKey = getPendingNoteSaveKey(appId, versionId);
    const existingPendingSave = noteSaveTimeoutsRef.current.get(pendingSaveKey);
    const noteToRevertTo = existingPendingSave?.previousNote ?? previousNote;
    if (existingPendingSave) {
      clearTimeout(existingPendingSave.timeout);
    }
    const saveSequence =
      (noteSaveSequencesRef.current.get(pendingSaveKey) ?? 0) + 1;
    noteSaveSequencesRef.current.set(pendingSaveKey, saveSequence);
    const timeout = setTimeout(() => {
      const pendingSave = noteSaveTimeoutsRef.current.get(pendingSaveKey);
      if (!pendingSave) {
        return;
      }
      noteSaveTimeoutsRef.current.delete(pendingSaveKey);
      void pendingSave.saveVersionNote(
        pendingSave.appId,
        pendingSave.versionId,
        pendingSave.note,
        pendingSave.previousNote,
        pendingSave.saveSequence,
        pendingSave.appId === currentAppIdRef.current,
      );
    }, 600);
    noteSaveTimeoutsRef.current.set(pendingSaveKey, {
      timeout,
      appId,
      versionId,
      note,
      previousNote: noteToRevertTo,
      saveSequence,
      saveVersionNote,
    });
  };

  const flushVersionNoteSave = (versionId: string, note: string | null) => {
    const pendingSaveKey = getPendingNoteSaveKey(appId, versionId);
    const existingPendingSave = noteSaveTimeoutsRef.current.get(pendingSaveKey);
    if (existingPendingSave) {
      clearTimeout(existingPendingSave.timeout);
      noteSaveTimeoutsRef.current.delete(pendingSaveKey);
      void existingPendingSave.saveVersionNote(
        existingPendingSave.appId,
        existingPendingSave.versionId,
        note,
        existingPendingSave.previousNote,
        existingPendingSave.saveSequence,
        existingPendingSave.appId === currentAppIdRef.current,
      );
    }
  };

  const handleToggleFavorite = (version: Version) => {
    const targetAppId = appId;
    const nextIsFavorite = !version.isFavorite;
    updateCachedVersion(version.oid, {
      isFavorite: nextIsFavorite,
    });
    void (async () => {
      try {
        const result = await setVersionFavorite({
          appId: targetAppId,
          versionId: version.oid,
          isFavorite: nextIsFavorite,
        });
        if (targetAppId !== currentAppIdRef.current) {
          return;
        }
        updateCachedVersion(result.oid, {
          isFavorite: result.isFavorite,
        });
      } catch {
        if (targetAppId !== currentAppIdRef.current) {
          return;
        }
        updateCachedVersion(version.oid, {
          isFavorite: version.isFavorite,
        });
      }
    })();
  };

  const handleNoteFocus = (versionId: string) => {
    setAutoFocusNoteVersionIds((previous) => {
      if (!previous.has(versionId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(versionId);
      return next;
    });
  };

  const handleNoteChange = (version: Version, note: string) => {
    setExpandedNoteVersionIds((previous) => {
      if (previous.has(version.oid)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(version.oid);
      return next;
    });
    updateCachedVersion(version.oid, { note });
    queueVersionNoteSave(version.oid, note, version.note ?? null);
  };

  const handleExpandNote = (versionId: string) => {
    setExpandedNoteVersionIds((previous) => {
      const next = new Set(previous);
      next.add(versionId);
      return next;
    });
    setAutoFocusNoteVersionIds((previous) => {
      const next = new Set(previous);
      next.add(versionId);
      return next;
    });
  };

  const handleRestoreVersion = (version: Version) => {
    if (
      isResolvingPreviewBranchRef.current ||
      isPreviewCheckoutInProgressRef.current
    ) {
      return;
    }
    previewRequestIdRef.current += 1;
    isResolvingPreviewBranchRef.current = false;
    setIsResolvingPreviewBranch(false);
    const returnBranch = getReturnBranch();
    void (async () => {
      await revertVersion({
        versionId: version.oid,
        targetBranchName: returnBranch ?? undefined,
      });
      checkedOutVersionIdRef.current = null;
      returnBranchRef.current = null;
      setSelectedVersionId(null);
      // Close the pane after revert to force a refresh on next open
      onClose();
      if (version.dbTimestamp) {
        await restartApp();
      }
    })();
  };

  return (
    <div className="h-full border-t border-2 border-border w-full flex flex-col">
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
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search versions..."
              aria-label="Search versions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent pl-8 pr-8 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label={
              showFavoritesOnly
                ? "Show all versions"
                : "Show favorite versions only"
            }
            aria-pressed={showFavoritesOnly}
            title={
              showFavoritesOnly
                ? "Show all versions"
                : "Show favorite versions only"
            }
            onClick={() => setShowFavoritesOnly((value) => !value)}
            className={cn(
              "h-8 w-8 inline-flex items-center justify-center rounded-md border border-input transition-colors",
              showFavoritesOnly
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <Star
              className={cn("h-3.5 w-3.5", showFavoritesOnly && "fill-current")}
            />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {versions.length === 0 ? (
          <div className="p-4">No versions available</div>
        ) : filteredVersions.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {showFavoritesOnly && !searchQuery.trim()
              ? "No favorite versions"
              : "No matching versions"}
          </div>
        ) : (
          <Virtuoso
            style={{ height: "100%" }}
            data={filteredVersions}
            defaultItemHeight={96}
            increaseViewportBy={{ top: 400, bottom: 400 }}
            computeItemKey={(_, version) => version.oid}
            itemContent={(_, version) => {
              const versionNumber = versionNumberByOid.get(version.oid) ?? 0;
              return (
                <VersionRow
                  version={version}
                  versionNumber={versionNumber}
                  thumbnailUrl={screenshotByHash.get(version.oid)}
                  searchQuery={searchQuery}
                  selectedVersionId={selectedVersionId}
                  isCheckingOutVersion={isCheckingOutVersion}
                  isResolvingPreviewBranch={isResolvingPreviewBranch}
                  isRevertingVersion={isRevertingVersion}
                  isAnyVersionMutationPending={isAnyVersionMutationPending}
                  showNoteEditor={
                    expandedNoteVersionIds.has(version.oid) || !!version.note
                  }
                  shouldAutoFocusNote={autoFocusNoteVersionIds.has(version.oid)}
                  versionNumberByOid={versionNumberByOid}
                  onVersionClick={(clickedVersion) => {
                    void handleVersionClick(clickedVersion);
                  }}
                  onToggleFavorite={handleToggleFavorite}
                  onNoteFocus={handleNoteFocus}
                  onNoteChange={handleNoteChange}
                  onNoteBlur={flushVersionNoteSave}
                  onExpandNote={handleExpandNote}
                  onRestoreVersion={handleRestoreVersion}
                />
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
