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
