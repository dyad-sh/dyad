import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getUserDataPath } from "@/paths/paths";
import {
  CLOSED_STATE,
  type BranchSwitchFallback,
  type PreviewSession,
  type PreviewState,
  type RestoreRecovery,
} from "@/version_preview/state";

const persistedSessionSchema = z
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
  .strict();

const persistedFallbackSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("closed") }).strict(),
  z
    .object({
      type: z.literal("viewing-diff"),
      session: persistedSessionSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("browsing"), session: persistedSessionSchema })
    .strict(),
  z
    .object({ type: z.literal("previewing"), session: persistedSessionSchema })
    .strict(),
  z
    .object({
      type: z.literal("recovery-required"),
      session: persistedSessionSchema,
      error: z.object({ message: z.string() }).strict(),
    })
    .strict(),
]);

const restoreRecoverySchema = z.discriminatedUnion("nextStep", [
  z
    .object({
      preRestoreHead: z.string().min(1),
      targetHead: z.string().min(1).nullable(),
      nextStep: z.enum(["preparing", "hard-reset", "soft-reset", "commit"]),
    })
    .strict(),
  z
    .object({
      preRestoreHead: z.string().min(1),
      targetHead: z.string().min(1),
      nextStep: z.literal("completed"),
      completedHead: z.string().min(1),
    })
    .strict(),
]);

const persistedStateSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("checking-out"),
      session: persistedSessionSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("previewing"), session: persistedSessionSchema })
    .strict(),
  z
    .object({
      type: z.literal("restoring"),
      session: persistedSessionSchema,
      fallback: z.enum(["closed", "browsing", "previewing"]),
      restoreRecovery: restoreRecoverySchema.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("returning"), session: persistedSessionSchema })
    .strict(),
  z
    .object({
      type: z.literal("switching-branch"),
      appId: z.number().int().positive(),
      branch: z.string().min(1),
      fallback: persistedFallbackSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("recovery-required"),
      session: persistedSessionSchema,
      error: z.object({ message: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("restore-recovery-required"),
      session: persistedSessionSchema,
      error: z.object({ message: z.string() }).strict(),
    })
    .strict(),
]);

const persistedSchema = z
  .object({
    version: z.union([z.literal(2), z.literal(3)]),
    state: persistedStateSchema,
  })
  .strict();

type PersistedSession = z.infer<typeof persistedSessionSchema>;
type PersistedFallback = z.infer<typeof persistedFallbackSchema>;
type PersistedState = z.infer<typeof persistedStateSchema>;

function persistenceDirectory(): string {
  return path.join(getUserDataPath(), "state-machines");
}

function persistencePath(appId: number): string {
  return path.join(persistenceDirectory(), `version-preview-${appId}.json`);
}

function persistedSession(session: PreviewSession): PersistedSession {
  return {
    appId: session.appId,
    originBranch: session.originBranch,
    targetVersionId: session.targetVersionId,
    checkedOutVersionId: session.checkedOutVersionId,
    exitIntent: session.exitIntent,
  };
}

function hydratedSession(session: PersistedSession): PreviewSession {
  return {
    ...session,
    selectedDiffFile: null,
    isDiffVisible: false,
  };
}

function persistedFallback(fallback: BranchSwitchFallback): PersistedFallback {
  if (fallback.type === "closed") return fallback;
  return {
    ...fallback,
    session: persistedSession(fallback.session),
  };
}

function hydratedFallback(fallback: PersistedFallback): BranchSwitchFallback {
  if (fallback.type === "closed") return fallback;
  return {
    ...fallback,
    session: hydratedSession(fallback.session),
  };
}

function toPersistedState(state: PreviewState): PersistedState | null {
  switch (state.type) {
    case "closed":
    case "viewing-diff":
    case "browsing":
    case "resolving-origin":
      return null;
    case "switching-branch":
      return {
        ...state,
        fallback: persistedFallback(state.fallback),
      };
    default:
      return {
        ...state,
        session: persistedSession(state.session),
      };
  }
}

function hydrateState(state: PersistedState): PreviewState {
  if (state.type === "switching-branch") {
    return {
      ...state,
      fallback: hydratedFallback(state.fallback),
    };
  }
  return {
    ...state,
    session: hydratedSession(state.session),
  };
}

function assertStateBelongsToApp(appId: number, state: PreviewState): void {
  const stateAppId =
    state.type === "switching-branch"
      ? state.appId
      : state.type === "closed"
        ? appId
        : state.session.appId;
  if (stateAppId !== appId) {
    throw new Error("Version preview checkpoint belongs to another app");
  }
}

class VersionPreviewPersistence {
  private readonly pending = new Map<number, PreviewState>();
  private readonly errors = new Map<number, unknown>();
  private flushScheduled = false;

  load(appId: number): PreviewState {
    let source: string;
    try {
      source = fs.readFileSync(persistencePath(appId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return CLOSED_STATE;
      }
      throw error;
    }
    const state = hydrateState(persistedSchema.parse(JSON.parse(source)).state);
    assertStateBelongsToApp(appId, state);
    return state;
  }

  schedule(appId: number, state: PreviewState): void {
    this.pending.set(appId, state);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      for (const pendingAppId of this.pending.keys()) {
        try {
          this.flush(pendingAppId);
        } catch (error) {
          this.errors.set(pendingAppId, error);
        }
      }
    });
  }

  checkpoint(appId: number, state: PreviewState): void {
    this.pending.delete(appId);
    try {
      this.write(appId, state);
      this.errors.delete(appId);
    } catch (error) {
      this.errors.set(appId, error);
      throw error;
    }
  }

  checkpointRestore(
    appId: number,
    state: PreviewState,
    restoreRecovery: RestoreRecovery,
  ): void {
    if (state.type !== "restoring") {
      throw new Error("Restore recovery checkpoint requires restoring state");
    }
    this.checkpoint(appId, { ...state, restoreRecovery });
  }

  flush(appId: number): void {
    const state = this.pending.get(appId);
    if (!state) return;
    this.pending.delete(appId);
    try {
      this.write(appId, state);
      this.errors.delete(appId);
    } catch (error) {
      this.errors.set(appId, error);
      throw error;
    }
  }

  remove(appId: number): void {
    this.pending.delete(appId);
    this.errors.delete(appId);
    try {
      fs.unlinkSync(persistencePath(appId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  removeAll(): void {
    this.pending.clear();
    this.errors.clear();
    let entries: string[];
    try {
      entries = fs.readdirSync(persistenceDirectory());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (/^version-preview-\d+\.json(?:\.tmp)?$/.test(entry)) {
        fs.unlinkSync(path.join(persistenceDirectory(), entry));
      }
    }
  }

  private write(appId: number, state: PreviewState): void {
    const persistedState = toPersistedState(state);
    if (!persistedState) {
      this.remove(appId);
      return;
    }
    assertStateBelongsToApp(appId, state);
    const directory = persistenceDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const target = persistencePath(appId);
    const temp = `${target}.tmp`;
    fs.writeFileSync(
      temp,
      JSON.stringify({ version: 3, state: persistedState }),
      "utf8",
    );
    fs.renameSync(temp, target);
  }
}

export const versionPreviewPersistence = new VersionPreviewPersistence();
