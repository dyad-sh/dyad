import type { KnowledgeBaseImportProgress } from "@/ipc/types/vector";

export function knowledgeBaseProgressPercent(input: {
  progress: KnowledgeBaseImportProgress | null;
  isAdding: boolean;
  documentCount: number;
  pendingCount: number;
}): number {
  const { progress, isAdding, documentCount, pendingCount } = input;
  if (!progress) {
    const total = documentCount + pendingCount;
    return total === 0 ? 100 : Math.round((documentCount / total) * 100);
  }

  const ratio =
    progress.phase === "uploading" &&
    progress.totalBytes !== undefined &&
    progress.completedBytes !== undefined &&
    progress.totalBytes > 0
      ? Math.min(1, progress.completedBytes / progress.totalBytes)
      : progress.totalCount === 0
        ? 1
        : Math.min(1, progress.completedCount / progress.totalCount);

  if (!isAdding) return Math.round(ratio * 100);
  if (progress.phase === "uploading") return Math.round(ratio * 25);
  return 25 + Math.round(ratio * 75);
}
