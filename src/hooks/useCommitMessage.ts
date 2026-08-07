import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  commitMessageDraftAtom,
  openCommitDialogAtom,
  type CommitDialogSource,
} from "@/atoms/commitAtoms";
import { generateDefaultCommitMessage } from "@/components/chat/uncommittedFileStatus";
import type { UncommittedFile } from "@/hooks/useUncommittedFiles";

/**
 * The commit message a commit dialog shows, plus whether that dialog is the one
 * currently open. The editor's commit menu and the chat header's uncommitted
 * files banner are two entrances to the same commit of the same working tree,
 * so they resolve the message the same way and share this hook rather than a
 * copy each: what the user typed wins, then a suggestion frozen when the dialog
 * opened, then a default generated from the files on screen.
 */
export function useCommitMessage(
  source: CommitDialogSource,
  appId: number | null,
  uncommittedFiles: UncommittedFile[],
) {
  const openCommitDialog = useAtomValue(openCommitDialogAtom);
  const commitMessageDraft = useAtomValue(commitMessageDraftAtom);
  const setCommitMessage = useSetAtom(commitMessageDraftAtom);
  // Frozen at open so polling doesn't rewrite the suggestion under the user.
  // Only ever a suggestion: once the user types, the draft atom takes over.
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  // A dialog belongs to an app as well as a source, so an open dialog left over
  // from another app is not this one.
  const isDialogOpen =
    openCommitDialog?.source === source && openCommitDialog.appId === appId;
  // Read only at the moment the dialog opens, so the freeze above is against a
  // ref rather than a render-time dependency that would refresh with polling.
  const uncommittedFilesRef = useRef(uncommittedFiles);
  uncommittedFilesRef.current = uncommittedFiles;

  // Refresh the suggestion on every open and drop it on close. The reopen after
  // leaving the staged diff comes straight from the atom rather than the button
  // handler, so freezing it there would commit a file list the user never saw.
  useEffect(() => {
    setGeneratedMessage(
      isDialogOpen
        ? generateDefaultCommitMessage(uncommittedFilesRef.current)
        : null,
    );
  }, [isDialogOpen]);

  // Only reached on the first frame of an open, before the effect above lands,
  // and while the dialog is closed and nobody reads it. Both hosts stay mounted
  // and re-render on every poll of the uncommitted files, so memoize rather
  // than regenerate this on each of those - the query preserves the array's
  // identity while the file list is unchanged, so it recomputes when it should.
  const defaultMessage = useMemo(
    () => generateDefaultCommitMessage(uncommittedFiles),
    [uncommittedFiles],
  );

  const commitMessage =
    commitMessageDraft ?? generatedMessage ?? defaultMessage;

  return { isDialogOpen, commitMessage, setCommitMessage };
}
