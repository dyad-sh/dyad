// Lowercases, replaces any run of non-alphanumerics with a single hyphen,
// strips leading/trailing hyphens, and truncates to 60 chars. Returns
// "untitled" if the input slugifies to empty.
export function slugify(text: string): string {
  const result = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
  return result || "untitled";
}

// App-path-style slug. Splits camelCase / acronym boundaries before `slugify`
// lowercases, so `DraftName` becomes `draft-name` instead of `draftname` and
// `TaskMaster Pro` becomes `task-master-pro`. Used for app folder paths and for
// GitHub repo / Vercel project name defaults so they stay consistent with the
// folder path and are valid everywhere (Vercel requires lowercase project
// names; this also avoids case-only collisions on case-insensitive filesystems).
export function slugifyAppPath(name: string): string {
  const split = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2");
  return slugify(split);
}
