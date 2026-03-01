import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import { safeJoin } from "./path_utils";
import { getMimeType } from "./mime_utils";
import fs from "node:fs";
import path from "node:path";

export interface ResolvedMediaFile {
  appName: string;
  fileName: string;
  filePath: string;
  mimeType: string;
}

export async function resolveMediaMentions(
  mediaRefs: string[],
): Promise<ResolvedMediaFile[]> {
  const resolved: ResolvedMediaFile[] = [];

  for (const ref of mediaRefs) {
    const slashIndex = ref.indexOf("/");
    if (slashIndex === -1) continue;

    const appName = ref.substring(0, slashIndex);
    const fileName = ref.substring(slashIndex + 1);

    const app = await db.query.apps.findFirst({
      where: eq(apps.name, appName),
    });
    if (!app) continue;

    const appPath = getDyadAppPath(app.path);

    try {
      const filePath = safeJoin(appPath, ".dyad", "media", fileName);
      if (!fs.existsSync(filePath)) continue;

      const ext = path.extname(fileName).toLowerCase();
      resolved.push({
        appName,
        fileName,
        filePath,
        mimeType: getMimeType(ext),
      });
    } catch {
      // safeJoin throws on path traversal attempts - skip silently
      continue;
    }
  }

  return resolved;
}
