import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getUserDataPath } from "@/paths/paths";
import {
  CLOSED_STATE,
  type PreviewSession,
  type PreviewState,
} from "@/version_preview/state";

const persistedSchema = z
  .object({
    version: z.literal(1),
    stateType: z.enum([
      "checking-out",
      "previewing",
      "restoring",
      "returning",
      "recovery-required",
    ]),
    session: z
      .object({
        appId: z.number().int().positive(),
        originBranch: z.string().nullable(),
        targetVersionId: z.string().nullable(),
        checkedOutVersionId: z.string().nullable(),
        exitIntent: z.discriminatedUnion("type", [
          z.object({ type: z.literal("none") }).strict(),
          z.object({ type: z.literal("close") }).strict(),
          z
            .object({
              type: z.literal("switch-app"),
              nextAppId: z.number().int().positive().nullable(),
            })
            .strict(),
        ]),
      })
      .strict(),
    error: z.object({ message: z.string() }).strict().optional(),
  })
  .strict();

function persistencePath(appId: number): string {
  return path.join(
    getUserDataPath(),
    "state-machines",
    `version-preview-${appId}.json`,
  );
}

function persistedSession(session: PreviewSession) {
  return {
    appId: session.appId,
    originBranch: session.originBranch,
    targetVersionId: session.targetVersionId,
    checkedOutVersionId: session.checkedOutVersionId,
    exitIntent: session.exitIntent,
  };
}

export const versionPreviewPersistence = {
  load(appId: number): PreviewState {
    try {
      const parsed = persistedSchema.parse(
        JSON.parse(fs.readFileSync(persistencePath(appId), "utf8")),
      );
      const session: PreviewSession = {
        ...parsed.session,
        selectedDiffFile: null,
        isDiffVisible: false,
      };
      if (parsed.stateType === "recovery-required") {
        return {
          type: "recovery-required",
          session,
          error: parsed.error ?? {
            message: "Version preview recovery is required.",
          },
        };
      }
      if (parsed.stateType === "restoring") {
        return { type: "restoring", session, fallback: "previewing" };
      }
      return { type: parsed.stateType, session };
    } catch {
      return CLOSED_STATE;
    }
  },

  save(appId: number, state: PreviewState): void {
    if (
      state.type === "closed" ||
      state.type === "viewing-diff" ||
      state.type === "browsing" ||
      state.type === "resolving-origin" ||
      state.type === "switching-branch"
    ) {
      this.remove(appId);
      return;
    }
    const directory = path.dirname(persistencePath(appId));
    fs.mkdirSync(directory, { recursive: true });
    const temp = `${persistencePath(appId)}.tmp`;
    fs.writeFileSync(
      temp,
      JSON.stringify({
        version: 1,
        stateType: state.type,
        session: persistedSession(state.session),
        ...(state.type === "recovery-required" ? { error: state.error } : {}),
      }),
      "utf8",
    );
    fs.renameSync(temp, persistencePath(appId));
  },

  remove(appId: number): void {
    try {
      fs.unlinkSync(persistencePath(appId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  },
};
