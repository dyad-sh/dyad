import { useEffect, useId, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  setUnsavedEditorFileAtom,
  unsavedEditorFilesAtom,
} from "@/atoms/viewAtoms";

const EMPTY_PATHS: ReadonlySet<string> = new Set<string>();

/**
 * Paths in `appId` whose editor buffer differs from disk. Returns a stable empty
 * set when nothing is unsaved so consumers can memoize on the reference.
 */
export function useUnsavedFiles(appId: number | null): ReadonlySet<string> {
  const unsavedEditorFiles = useAtomValue(unsavedEditorFilesAtom);
  return useMemo(() => {
    if (appId === null || unsavedEditorFiles.size === 0) return EMPTY_PATHS;
    const paths = new Set<string>();
    for (const entry of unsavedEditorFiles.values()) {
      if (entry.appId === appId) paths.add(entry.filePath);
    }
    return paths.size === 0 ? EMPTY_PATHS : paths;
  }, [appId, unsavedEditorFiles]);
}

/**
 * Publishes the calling editor's dirty state to `unsavedEditorFilesAtom`.
 *
 * The cleanup runs against the `appId`/`filePath` the effect was set up with, so
 * unmounting (file switch, app switch, cancelling a chat write card's inline
 * edit) and switching files in place both clear the previous entry rather than
 * leaving a stale marker behind.
 *
 * Collapsing a chat write card does NOT clear it: DyadCardContent keeps its
 * children mounted once expanded, so that editor's buffer is still live and
 * still dirty, and the marker still reports the truth. The card's Cancel
 * button, which stays reachable in the collapsed header, is what unmounts it.
 */
export function useTrackUnsavedFile({
  appId,
  filePath,
  isUnsaved,
}: {
  appId: number | null;
  filePath: string;
  isUnsaved: boolean;
}) {
  const editorId = useId();
  const setUnsavedEditorFile = useSetAtom(setUnsavedEditorFileAtom);

  useEffect(() => {
    setUnsavedEditorFile({ editorId, appId, filePath, unsaved: isUnsaved });
    return () => {
      setUnsavedEditorFile({ editorId, appId, filePath, unsaved: false });
    };
  }, [editorId, appId, filePath, isUnsaved, setUnsavedEditorFile]);
}
