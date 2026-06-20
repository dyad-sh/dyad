import { getDyadAppPath } from "../../paths/paths";
import { safeJoin } from "./path_utils";
import { getMimeType } from "./mime_utils";
import { DYAD_MEDIA_DIR_NAME } from "./media_path_utils";
import fs from "node:fs";
import path from "node:path";

interface ResolvedMediaFile {
  appName: string;
  fileName: string;
  filePath: string;
  mimeType: string;
}

export async function resolveMediaMentions(
  mediaRefs: string[],
  appPath: string,
  appName: string,
): Promise<ResolvedMediaFile[]> {
  const resolved: ResolvedMediaFile[] = [];
  const resolvedAppPath = getDyadAppPath(appPath);

  for (const encodedFileName of mediaRefs) {
    try {
      const fileName = decodeURIComponent(encodedFileName);
      const filePath = safeJoin(resolvedAppPath, DYAD_MEDIA_DIR_NAME, fileName);
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
