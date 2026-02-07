import fs from "node:fs";
import path from "node:path";

/**
 * Ensures `.dyad/` is listed in the project's `.gitignore`.
 * Creates `.gitignore` if it doesn't exist.
 */
export async function ensureDyadGitignored(appPath: string): Promise<void> {
  const gitignorePath = path.join(appPath, ".gitignore");
  let content = "";
  try {
    content = await fs.promises.readFile(gitignorePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // .gitignore doesn't exist yet — will be created below
  }

  // Check if .dyad or .dyad/ is already ignored
  const lines = content.split(/\r?\n/);
  const alreadyIgnored = lines.some(
    (line) => line.trim() === ".dyad" || line.trim() === ".dyad/",
  );
  if (alreadyIgnored) return;

  // Append .dyad/ to the end, ensuring a leading newline if file has content
  const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await fs.promises.writeFile(
    gitignorePath,
    content + suffix + ".dyad/\n",
    "utf-8",
  );
}

export function slugify(text: string): string {
  const result = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
  return result || "untitled";
}

export function buildFrontmatter(meta: Record<string, string>): string {
  const lines = Object.entries(meta).map(
    ([k, v]) =>
      `${k}: "${v.replace(/\\/g, "\\\\").replace(/\n/g, " ").replace(/"/g, '\\"')}"`,
  );
  return `---\n${lines.join("\n")}\n---\n\n`;
}

export function validatePlanId(planId: string): void {
  if (!/^[a-z0-9-]+$/.test(planId)) {
    throw new Error("Invalid plan ID");
  }
}

export function parsePlanFile(raw: string): {
  meta: Record<string, string>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n*([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      meta[key] = val;
    }
  }
  return { meta, content: match[2].trim() };
}
