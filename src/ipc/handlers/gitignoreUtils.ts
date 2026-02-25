import fs from "node:fs";
import path from "node:path";

/**
 * Ensures the given entries are listed in the project's `.gitignore`.
 * Creates `.gitignore` if it doesn't exist.
 */
async function ensureGitignored(
  appPath: string,
  entries: string[],
): Promise<void> {
  const gitignorePath = path.join(appPath, ".gitignore");
  let content = "";
  try {
    content = await fs.promises.readFile(gitignorePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // .gitignore doesn't exist yet — will be created below
  }

  const lines = content.split(/\r?\n/);
  const missing = entries.filter(
    (entry) =>
      !lines.some(
        (line) =>
          line.trim() === entry || line.trim() === entry.replace(/\/$/, ""),
      ),
  );
  if (missing.length === 0) return;

  const suffix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await fs.promises.writeFile(
    gitignorePath,
    content + suffix + missing.map((e) => e + "\n").join(""),
    "utf-8",
  );
}

/**
 * Ensures `.dyad/` is listed in the project's `.gitignore`.
 * Creates `.gitignore` if it doesn't exist.
 */
export async function ensureDyadGitignored(appPath: string): Promise<void> {
  await ensureGitignored(appPath, [".dyad/"]);
}
