export const APP_FRAMEWORK_TYPES = [
  "nextjs",
  "vite",
  "vite-nitro",
  "other",
] as const;
export type AppFrameworkType = (typeof APP_FRAMEWORK_TYPES)[number];

export const NEXTJS_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
];

export const VITE_CONFIG_FILES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts",
];

/**
 * Whether Neon can be connected to this app. Neon supports Next.js and Vite
 * apps (Vite apps automatically get a Nitro server layer added on connect).
 */
export function isNeonSupportedFramework({
  files,
  frameworkType,
}: {
  files?: string[];
  frameworkType?: AppFrameworkType | null;
}): boolean {
  if (frameworkType) {
    return (
      frameworkType === "nextjs" ||
      frameworkType === "vite" ||
      frameworkType === "vite-nitro"
    );
  }

  if (!files) return false;
  return files.some(
    (file) =>
      NEXTJS_CONFIG_FILES.includes(file) || VITE_CONFIG_FILES.includes(file),
  );
}
