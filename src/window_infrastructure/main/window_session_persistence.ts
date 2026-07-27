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
