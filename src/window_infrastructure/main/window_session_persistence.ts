import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  VisibleEntitySchema,
  WindowSessionIdSchema,
  type VisibleEntity,
  type WindowSessionId,
} from "@/window_infrastructure/types";

export const MAX_PRODUCT_WINDOWS = 8;
export const WINDOW_SESSION_FILE_NAME = "window-sessions.json";

const WindowSessionDescriptorSchema = z.object({
  windowSessionId: WindowSessionIdSchema,
  visibleEntity: VisibleEntitySchema.optional(),
});

const WindowSessionFileSchema = z.object({
  version: z.literal(1),
  windows: z.array(WindowSessionDescriptorSchema).max(MAX_PRODUCT_WINDOWS),
});

export type WindowSessionDescriptor = z.infer<
  typeof WindowSessionDescriptorSchema
>;

export type WindowSessionPersistenceFailurePolicy = "continue" | "throw";

export function restorableVisibleEntity(
  entities: readonly VisibleEntity[],
): VisibleEntity | undefined {
  return (
    entities.find((entity) => entity.kind === "chat") ??
    entities.find((entity) => entity.kind === "app")
  );
}

export function rememberWindowSessionBestEffort({
  persistence,
  windowSessionId,
  visibleEntity,
  onFailure,
}: {
  persistence: WindowSessionPersistence;
  windowSessionId: WindowSessionId;
  visibleEntity?: VisibleEntity;
  onFailure?: (error: unknown) => void;
}): boolean {
  try {
    persistence.remember(windowSessionId, visibleEntity);
    return true;
  } catch (error) {
    onFailure?.(error);
    return false;
  }
}

export function forgetWindowSessionBestEffort({
  persistence,
  windowSessionId,
  onFailure,
}: {
  persistence: WindowSessionPersistence;
  windowSessionId: WindowSessionId;
  onFailure?: (error: unknown) => void;
}): boolean {
  try {
    persistence.forget(windowSessionId);
    return true;
  } catch (error) {
    onFailure?.(error);
    return false;
  }
}

export function prepareWindowSessionForCreation({
  persistence,
  descriptor,
  failurePolicy,
  onFailure,
}: {
  persistence: WindowSessionPersistence;
  descriptor: WindowSessionDescriptor;
  failurePolicy: WindowSessionPersistenceFailurePolicy;
  onFailure?: (error: unknown) => void;
}): { wasAlreadyPersisted: boolean; wasPersisted: boolean } {
  const wasAlreadyPersisted = persistence
    .read()
    .some((session) => session.windowSessionId === descriptor.windowSessionId);
  if (wasAlreadyPersisted) {
    return { wasAlreadyPersisted: true, wasPersisted: true };
  }

  try {
    persistence.remember(descriptor.windowSessionId, descriptor.visibleEntity);
    return { wasAlreadyPersisted: false, wasPersisted: true };
  } catch (error) {
    if (failurePolicy === "throw") {
      throw error;
    }
    onFailure?.(error);
    return { wasAlreadyPersisted: false, wasPersisted: false };
  }
}

export function getWindowSessionFilePath(userDataPath: string): string {
  return path.join(userDataPath, WINDOW_SESSION_FILE_NAME);
}

export async function clearWindowSessionPersistence(
  userDataPath: string,
): Promise<void> {
  const filePath = getWindowSessionFilePath(userDataPath);
  await Promise.all([
    fs.promises.rm(filePath, { force: true }),
    fs.promises.rm(`${filePath}.tmp`, { force: true }),
  ]);
}

export class WindowSessionPersistence {
  constructor(private readonly filePath: string) {}

  read(): WindowSessionDescriptor[] {
    try {
      const parsed = WindowSessionFileSchema.safeParse(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")),
      );
      return parsed.success ? parsed.data.windows : [];
    } catch {
      return [];
    }
  }

  remember(
    windowSessionId: WindowSessionId,
    visibleEntity?: VisibleEntity,
  ): void {
    const windows = this.read();
    const existing = windows.find(
      (window) => window.windowSessionId === windowSessionId,
    );
    if (existing) {
      existing.visibleEntity = visibleEntity;
    } else if (windows.length < MAX_PRODUCT_WINDOWS) {
      windows.push({ windowSessionId, visibleEntity });
    } else {
      throw new Error("Window session capacity exceeded");
    }
    this.write(windows);
  }

  forget(windowSessionId: WindowSessionId): void {
    this.write(
      this.read().filter(
        (window) => window.windowSessionId !== windowSessionId,
      ),
    );
  }

  private write(windows: WindowSessionDescriptor[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify({ version: 1, windows }, null, 2),
      "utf8",
    );
    fs.renameSync(temporaryPath, this.filePath);
  }
}
