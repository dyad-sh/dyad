export const NEXTJS_CONFIG_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
];

export function isNextJsProject(files: string[] | undefined): boolean {
  if (!files) return false;
  return files.some((file) => NEXTJS_CONFIG_FILES.includes(file));
}
