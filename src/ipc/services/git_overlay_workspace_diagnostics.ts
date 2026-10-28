import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import log from "electron-log/main";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("git_overlay_workspace");

interface WorkspaceFailureContext {
  stage: string;
  operation?: string;
  purpose?: string;
  sourceRoot: string;
  workspaceRoot?: string;
  scratchRoot?: string;
  sourcePath?: string;
  destinationPath?: string;
}

/** Failure-only diagnostics, captured before the partial workspace is removed. */
export async function logGitOverlayWorkspaceFailure(
  error: unknown,
  context: WorkspaceFailureContext,
): Promise<void> {
  if (
    error instanceof DyadError &&
    error.kind === DyadErrorKind.UserCancelled
  ) {
    return;
  }
  // Neither a failed probe nor logging itself may replace the original error
  // or stop cleanup. Keep all filesystem inspection off the success path.
  try {
    const timestamp = new Date().toISOString();
    const roots = [
      [context.sourceRoot, "<repo>"],
      [context.workspaceRoot, "<workspace>"],
      [context.scratchRoot, "<scratch>"],
      [os.homedir(), "<home>"],
    ].filter((entry): entry is [string, string] => !!entry[0]);
    roots.sort((left, right) => right[0].length - left[0].length);
    const redact = (text: string) => {
      for (const [root, label] of roots) text = text.replaceAll(root, label);
      return text;
    };
    const displayPath = (value: string) => {
      for (const [root, label] of roots) {
        const relative = path.relative(root, value);
        if (
          !path.isAbsolute(relative) &&
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`)
        ) {
          return relative
            ? `${label}/${relative.split(path.sep).join("/")}`
            : label;
        }
      }
      return `<external>/${path.basename(value)}`;
    };
    const errorCode = (value: unknown): string | undefined =>
      typeof (value as NodeJS.ErrnoException | null)?.code === "string"
        ? (value as NodeJS.ErrnoException).code
        : undefined;
    const inspect = async (entryPath: string) => {
      try {
        const stat = await fs.lstat(entryPath);
        const type = stat.isSymbolicLink()
          ? "symlink"
          : stat.isDirectory()
            ? "directory"
            : stat.isFile()
              ? "file"
              : "other";
        const link = stat.isSymbolicLink()
          ? await fs.readlink(entryPath).then(
              (target) => ({
                linkTarget: displayPath(
                  path.resolve(path.dirname(entryPath), target),
                ),
              }),
              (probeError: unknown) => ({
                readlinkError: errorCode(probeError) ?? "unknown",
              }),
            )
          : {};
        return { path: displayPath(entryPath), type, ...link };
      } catch (probeError) {
        return {
          path: displayPath(entryPath),
          type: errorCode(probeError) === "ENOENT" ? "missing" : "unavailable",
          errorCode: errorCode(probeError) ?? "unknown",
        };
      }
    };
    const errno = error as NodeJS.ErrnoException | null;
    const paths = {
      source: context.sourcePath,
      destination: context.destinationPath,
      errorPath: typeof errno?.path === "string" ? errno.path : undefined,
      errorDestination:
        typeof (error as { dest?: unknown } | null)?.dest === "string"
          ? (error as { dest: string }).dest
          : undefined,
    };
    const entries = await Promise.all(
      Object.entries(paths).map(async ([name, value]) => [
        name,
        value
          ? {
              entry: await inspect(value),
              parent: await inspect(path.dirname(value)),
            }
          : undefined,
      ]),
    );
    // Serialize explicitly: Error's fields are non-enumerable, and a single
    // JSON line stays intact in the debug bundle's bounded application-log tail.
    logger.error(
      `Workspace preparation failed: ${JSON.stringify({
        timestamp,
        stage: context.stage,
        operation: context.operation ?? errno?.syscall,
        purpose: context.purpose,
        workspace:
          context.workspaceRoot && path.basename(context.workspaceRoot),
        error: {
          name: errno?.name,
          message: redact(
            error instanceof Error ? error.message : String(error),
          ),
          code: errorCode(error),
          syscall: errno?.syscall,
          stack:
            typeof errno?.stack === "string" ? redact(errno.stack) : undefined,
        },
        paths: Object.fromEntries(entries),
      })}`,
    );
  } catch {
    // Best effort, including when the log transport itself is unavailable.
  }
}
