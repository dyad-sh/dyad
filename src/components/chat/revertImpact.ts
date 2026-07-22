import type { Version } from "@/ipc/types";

export function getExtraRevertedCommits({
  versions,
  targetOid,
  ownCommitHashes,
}: {
  versions: Version[];
  targetOid: string;
  ownCommitHashes: string[];
}): Version[] | null {
  const targetIndex = versions.findIndex(
    (version) => version.oid === targetOid,
  );
  if (targetIndex === -1) return null;

  const ownCommits = new Set(ownCommitHashes);
  return versions
    .slice(0, targetIndex)
    .filter((version) => !ownCommits.has(version.oid));
}
