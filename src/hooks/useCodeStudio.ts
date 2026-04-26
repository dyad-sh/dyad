/**
 * React Query hooks for Code Studio.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  codeStudioClient,
  type FsEntry,
  type OpenFileResult,
  type SearchHit,
  type WorkspaceInfo,
  type WriteFilePatch,
} from "@/ipc/code_studio_client";

const KEYS = {
  all: ["code-studio"] as const,
  workspace: () => [...KEYS.all, "workspace"] as const,
  dir: (relPath: string) => [...KEYS.all, "dir", relPath] as const,
  file: (relPath: string) => [...KEYS.all, "file", relPath] as const,
  search: (query: string) => [...KEYS.all, "search", query] as const,
};

// -- Workspace --------------------------------------------------------------

export function useCodeWorkspace() {
  return useQuery<WorkspaceInfo | null>({
    queryKey: KEYS.workspace(),
    queryFn: () => codeStudioClient.getWorkspace(),
  });
}

export function useOpenWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => codeStudioClient.openWorkspace(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useSetWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (root: string) => codeStudioClient.setWorkspace(root),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

// -- Dir / files ------------------------------------------------------------

export function useDirListing(relPath: string, enabled: boolean = true) {
  return useQuery<FsEntry[]>({
    queryKey: KEYS.dir(relPath),
    queryFn: () => codeStudioClient.listDir(relPath),
    enabled,
  });
}

export function useFileContent(relPath: string | null) {
  return useQuery<OpenFileResult>({
    queryKey: KEYS.file(relPath ?? ""),
    queryFn: () => codeStudioClient.readFile(relPath!),
    enabled: !!relPath,
  });
}

export function useWriteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ relPath, content }: { relPath: string; content: string }) =>
      codeStudioClient.writeFile(relPath, content),
    onSuccess: (_, { relPath }) => {
      qc.invalidateQueries({ queryKey: KEYS.file(relPath) });
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (relPath: string) => codeStudioClient.deleteFile(relPath),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export function useCreateFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ relPath, initialContent }: { relPath: string; initialContent?: string }) =>
      codeStudioClient.createFile(relPath, initialContent),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

// -- Patches ----------------------------------------------------------------

export function usePreviewPatch() {
  return useMutation({
    mutationFn: (patch: WriteFilePatch) => codeStudioClient.previewPatch(patch),
  });
}

export function useApplyPatches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patches: WriteFilePatch[]) => codeStudioClient.applyPatches(patches),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

// -- Search -----------------------------------------------------------------

export function useCodeSearch(query: string, opts: { caseSensitive?: boolean } = {}) {
  return useQuery<SearchHit[]>({
    queryKey: [...KEYS.search(query), opts.caseSensitive ?? false],
    queryFn: () => codeStudioClient.search(query, opts),
    enabled: query.trim().length >= 2,
  });
}
