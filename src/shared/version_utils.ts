function parseVersionParts(version: string): {
  parts: [number, number, number];
  hasPrerelease: boolean;
} | null {
  const match = version
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) {
    return null;
  }

  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    hasPrerelease: match[4] !== undefined,
  };
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const parsedVersion = parseVersionParts(version);
  const parsedMinimum = parseVersionParts(minimum);
  if (!parsedVersion || !parsedMinimum) {
    return false;
  }

  for (let index = 0; index < parsedVersion.parts.length; index += 1) {
    if (parsedVersion.parts[index] > parsedMinimum.parts[index]) {
      return true;
    }
    if (parsedVersion.parts[index] < parsedMinimum.parts[index]) {
      return false;
    }
  }

  return !parsedVersion.hasPrerelease || parsedMinimum.hasPrerelease;
}
