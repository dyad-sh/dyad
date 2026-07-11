import { atom } from "jotai";

export interface CodeEditorFileSelection {
  path: string;
  line?: number | null;
}

export const openCodeEditorFilesByAppIdAtom = atom<Map<number, string[]>>(
  new Map(),
);

export const selectedCodeEditorFileByAppIdAtom = atom<
  Map<number, CodeEditorFileSelection>
>(new Map());

export const isCodeExplorerOpenAtom = atom(true);

export const selectCodeEditorFileAtom = atom(
  null,
  (
    get,
    set,
    { appId, file }: { appId: number | null; file: CodeEditorFileSelection },
  ) => {
    if (appId === null) return;

    const nextSelectedFiles = new Map(get(selectedCodeEditorFileByAppIdAtom));
    nextSelectedFiles.set(appId, file);
    set(selectedCodeEditorFileByAppIdAtom, nextSelectedFiles);

    const openFiles = get(openCodeEditorFilesByAppIdAtom).get(appId) ?? [];
    if (openFiles.includes(file.path)) return;

    const nextOpenFiles = new Map(get(openCodeEditorFilesByAppIdAtom));
    nextOpenFiles.set(appId, [...openFiles, file.path]);
    set(openCodeEditorFilesByAppIdAtom, nextOpenFiles);
  },
);

export const closeCodeEditorFileAtom = atom(
  null,
  (get, set, { appId, path }: { appId: number | null; path: string }) => {
    if (appId === null) return;

    const openFiles = get(openCodeEditorFilesByAppIdAtom).get(appId) ?? [];
    const closingIndex = openFiles.indexOf(path);
    if (closingIndex === -1) return;

    const remainingFiles = openFiles.filter((openPath) => openPath !== path);
    const nextOpenFiles = new Map(get(openCodeEditorFilesByAppIdAtom));
    if (remainingFiles.length === 0) {
      nextOpenFiles.delete(appId);
    } else {
      nextOpenFiles.set(appId, remainingFiles);
    }
    set(openCodeEditorFilesByAppIdAtom, nextOpenFiles);

    const selectedFile = get(selectedCodeEditorFileByAppIdAtom).get(appId);
    if (selectedFile?.path !== path) return;

    const nextSelectedFiles = new Map(get(selectedCodeEditorFileByAppIdAtom));
    const nextPath =
      remainingFiles[Math.min(closingIndex, remainingFiles.length - 1)];
    if (nextPath) {
      nextSelectedFiles.set(appId, { path: nextPath });
    } else {
      nextSelectedFiles.delete(appId);
    }
    set(selectedCodeEditorFileByAppIdAtom, nextSelectedFiles);
  },
);

export const reconcileCodeEditorFilesAtom = atom(
  null,
  (get, set, { appId, files }: { appId: number | null; files: string[] }) => {
    if (appId === null) return;

    const availableFiles = new Set(files);
    const currentOpenFiles =
      get(openCodeEditorFilesByAppIdAtom).get(appId) ?? [];
    const remainingFiles = currentOpenFiles.filter((path) =>
      availableFiles.has(path),
    );

    if (remainingFiles.length !== currentOpenFiles.length) {
      const nextOpenFiles = new Map(get(openCodeEditorFilesByAppIdAtom));
      if (remainingFiles.length === 0) {
        nextOpenFiles.delete(appId);
      } else {
        nextOpenFiles.set(appId, remainingFiles);
      }
      set(openCodeEditorFilesByAppIdAtom, nextOpenFiles);
    }

    const selectedFile = get(selectedCodeEditorFileByAppIdAtom).get(appId);
    if (!selectedFile || availableFiles.has(selectedFile.path)) return;

    const nextSelectedFiles = new Map(get(selectedCodeEditorFileByAppIdAtom));
    if (remainingFiles[0]) {
      nextSelectedFiles.set(appId, { path: remainingFiles[0] });
    } else {
      nextSelectedFiles.delete(appId);
    }
    set(selectedCodeEditorFileByAppIdAtom, nextSelectedFiles);
  },
);

export const clearCodeEditorStateForAppAtom = atom(
  null,
  (get, set, appId: number) => {
    const nextOpenFiles = new Map(get(openCodeEditorFilesByAppIdAtom));
    nextOpenFiles.delete(appId);
    set(openCodeEditorFilesByAppIdAtom, nextOpenFiles);

    const nextSelectedFiles = new Map(get(selectedCodeEditorFileByAppIdAtom));
    nextSelectedFiles.delete(appId);
    set(selectedCodeEditorFileByAppIdAtom, nextSelectedFiles);
  },
);
