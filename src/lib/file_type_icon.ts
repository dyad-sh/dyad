import {
  Archive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Presentation,
  type LucideIcon,
} from "lucide-react";

/**
 * What a file looks like in a chat: an icon, an accent colour and a short
 * label, chosen from its extension or MIME type.
 *
 * A generic page icon on every attachment makes a PDF, a spreadsheet and a
 * screenshot indistinguishable at a glance. Extension wins over MIME type
 * because browsers report `application/octet-stream` for plenty of files the
 * name identifies perfectly well.
 */

export type FileKind =
  | "image"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "code"
  | "data"
  | "archive"
  | "audio"
  | "video"
  | "text";

export type FileTypeDescriptor = {
  kind: FileKind;
  icon: LucideIcon;
  label: string;
  /** Tailwind classes for the icon and its tinted backdrop. */
  className: string;
};

const DESCRIPTORS: Record<FileKind, Omit<FileTypeDescriptor, "kind">> = {
  image: {
    icon: FileImage,
    label: "Image",
    className: "text-violet-300 bg-violet-500/15",
  },
  pdf: {
    icon: FileType,
    label: "PDF",
    className: "text-rose-300 bg-rose-500/15",
  },
  document: {
    icon: FileText,
    label: "Document",
    className: "text-sky-300 bg-sky-500/15",
  },
  spreadsheet: {
    icon: FileSpreadsheet,
    label: "Spreadsheet",
    className: "text-emerald-300 bg-emerald-500/15",
  },
  presentation: {
    icon: Presentation,
    label: "Slides",
    className: "text-orange-300 bg-orange-500/15",
  },
  code: {
    icon: FileCode,
    label: "Code",
    className: "text-cyan-300 bg-cyan-500/15",
  },
  data: {
    icon: FileJson,
    label: "Data",
    className: "text-amber-300 bg-amber-500/15",
  },
  archive: {
    icon: Archive,
    label: "Archive",
    className: "text-yellow-300 bg-yellow-500/15",
  },
  audio: {
    icon: FileAudio,
    label: "Audio",
    className: "text-pink-300 bg-pink-500/15",
  },
  video: {
    icon: FileVideo,
    label: "Video",
    className: "text-fuchsia-300 bg-fuchsia-500/15",
  },
  text: {
    icon: FileText,
    label: "Text",
    className: "text-slate-300 bg-slate-500/15",
  },
};

const EXTENSION_KINDS: Record<string, FileKind> = {};
function register(kind: FileKind, extensions: string[]) {
  for (const extension of extensions) EXTENSION_KINDS[extension] = kind;
}

register("image", [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
  "heic",
  "heif",
  "tiff",
  "tif",
  "ico",
]);
register("pdf", ["pdf"]);
register("document", ["doc", "docx", "odt", "rtf", "pages", "epub"]);
register("spreadsheet", ["xls", "xlsx", "ods", "csv", "tsv", "numbers"]);
register("presentation", ["ppt", "pptx", "odp", "key"]);
register("code", [
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "html",
  "css",
  "scss",
  "vue",
  "svelte",
]);
register("data", ["json", "yaml", "yml", "toml", "xml", "ndjson", "parquet"]);
register("archive", ["zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz"]);
register("audio", ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "aiff"]);
register("video", ["mp4", "mov", "webm", "mkv", "avi", "m4v", "wmv"]);
register("text", ["txt", "md", "mdx", "log", "env", "ini", "cfg", "conf"]);

const MIME_PREFIX_KINDS: [string, FileKind][] = [
  ["image/", "image"],
  ["audio/", "audio"],
  ["video/", "video"],
  ["text/", "text"],
];

const MIME_KINDS: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/json": "data",
  "application/xml": "data",
  "application/zip": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "document",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "spreadsheet",
  "application/vnd.ms-powerpoint": "presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "presentation",
  "text/csv": "spreadsheet",
  "text/markdown": "text",
  "text/html": "code",
  "text/css": "code",
  "text/javascript": "code",
  "application/javascript": "code",
};

export function fileExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

export function fileKindFor(fileName: string, mimeType = ""): FileKind {
  const extension = fileExtension(fileName);
  const byExtension = EXTENSION_KINDS[extension];
  if (byExtension) return byExtension;

  const mime = mimeType.toLowerCase().split(";")[0].trim();
  const byMime = MIME_KINDS[mime];
  if (byMime) return byMime;

  for (const [prefix, kind] of MIME_PREFIX_KINDS) {
    if (mime.startsWith(prefix)) return kind;
  }

  return "text";
}

export function describeFileType(
  fileName: string,
  mimeType = "",
): FileTypeDescriptor {
  const kind = fileKindFor(fileName, mimeType);
  return { kind, ...DESCRIPTORS[kind] };
}

/** Extension shown on the icon badge, e.g. "PDF". Empty when there is none. */
export function fileBadgeLabel(fileName: string): string {
  const extension = fileExtension(fileName);
  // Long extensions crowd the badge and read worse than the icon alone.
  return extension.length > 0 && extension.length <= 4
    ? extension.toUpperCase()
    : "";
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
