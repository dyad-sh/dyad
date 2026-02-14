export const APP_ICON_TYPES = ["emoji", "generated"] as const;
export type AppIconType = (typeof APP_ICON_TYPES)[number];

export type GeneratedAppIconData = {
  seed: string;
  version: 1;
};

export type AppIconInput = {
  appId: number;
  appName: string;
  iconType: string | null;
  iconData: string | null;
};

const AVATAR_COLORS = [
  "#2563eb",
  "#0891b2",
  "#0f766e",
  "#059669",
  "#65a30d",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#9333ea",
  "#7c3aed",
  "#4f46e5",
  "#0369a1",
  "#166534",
  "#b45309",
  "#be123c",
] as const;

export function isAppIconType(value: string | null): value is AppIconType {
  return value === "emoji" || value === "generated";
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createGeneratedIconDataFromSeed(seed: string): string {
  return JSON.stringify({
    seed,
    version: 1,
  } satisfies GeneratedAppIconData);
}

export function createGeneratedIconDataForApp(
  appId: number,
  appName: string,
  salt = "",
): string {
  const seedValue = hashString(`${appId}:${appName}:${salt}`)
    .toString(16)
    .padStart(8, "0");
  return createGeneratedIconDataFromSeed(seedValue);
}

export function parseGeneratedIconData(
  iconType: string | null,
  iconData: string | null,
): GeneratedAppIconData | null {
  if (iconType !== "generated" || !iconData) {
    return null;
  }

  try {
    const parsed = JSON.parse(iconData) as Partial<GeneratedAppIconData>;
    if (typeof parsed.seed !== "string" || parsed.seed.length === 0) {
      return null;
    }
    if (parsed.version !== 1) {
      return null;
    }
    return {
      seed: parsed.seed,
      version: 1,
    };
  } catch {
    return null;
  }
}

export function getFallbackLetter(appName: string): string {
  const trimmed = appName.trim();
  if (trimmed.length === 0) {
    return "?";
  }
  return trimmed[0].toUpperCase();
}

export function getFallbackColor(appId: number): string {
  return AVATAR_COLORS[Math.abs(appId) % AVATAR_COLORS.length];
}

export function deriveAvatarStyle(seed: string) {
  const normalizedSeed = seed.toLowerCase();
  const hash = hashString(normalizedSeed);
  const background = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const foreground = hash % 2 === 0 ? "#ffffff" : "#111827";
  const pattern = (hash >>> 4) % 8;
  const accentPattern = (hash >>> 8) % 8;
  return {
    background,
    foreground,
    pattern,
    accentPattern,
  };
}
