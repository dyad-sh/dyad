import {
  Braces,
  Database,
  FileCode2,
  FileCog,
  FileImage,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
const CODE_EXTENSIONS = new Set([
  "astro",
  "css",
  "html",
  "js",
  "jsx",
  "mjs",
  "py",
  "scss",
  "ts",
  "tsx",
  "vue",
]);
const CONFIG_FILE_NAMES = new Set([
  ".env",
  ".gitignore",
  "dockerfile",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "vite.config.ts",
]);

export function FileTypeIcon({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const fileName = path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  const iconClassName = cn("size-4 shrink-0", className);

  if (CONFIG_FILE_NAMES.has(fileName)) {
    return <FileCog className={cn(iconClassName, "text-amber-500")} />;
  }
  if (extension === "json") {
    return <Braces className={cn(iconClassName, "text-yellow-500")} />;
  }
  if (extension === "sql") {
    return <Database className={cn(iconClassName, "text-sky-500")} />;
  }
  if (IMAGE_EXTENSIONS.has(extension ?? "")) {
    return <FileImage className={cn(iconClassName, "text-pink-500")} />;
  }
  if (CODE_EXTENSIONS.has(extension ?? "")) {
    return <FileCode2 className={cn(iconClassName, "text-blue-500")} />;
  }
  return <FileText className={cn(iconClassName, "text-muted-foreground")} />;
}
