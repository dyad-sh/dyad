//Calculate the version number from a version object using reverse index.

export function calculateVersionNumber(
  version: { oid: string },
  versions: { oid: string }[],
): number {
  return versions.length - versions.indexOf(version);
}
