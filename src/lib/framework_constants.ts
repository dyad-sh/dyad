export const APP_FRAMEWORK_TYPES = ["nextjs", "vite", "other"] as const;
export type AppFrameworkType = (typeof APP_FRAMEWORK_TYPES)[number];

export const NEXTJS_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
];

export function isNextJsProject({
  files,
  frameworkType,
}: {
  files?: string[];
  frameworkType?: AppFrameworkType | null;
}): boolean {
  if (frameworkType) {
    return frameworkType === "nextjs";
  }

  if (!files) return false;
  return files.some((file) => NEXTJS_CONFIG_FILES.includes(file));
}
