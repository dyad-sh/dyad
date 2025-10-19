import { db } from "../../db";
import { devicePresets } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";

const logger = log.scope("device_presets_handler");
const handle = createLoggedHandler(logger);

export interface DevicePreset {
  id: number;
  name: string;
  width: number;
  height: number;
  isDefault: boolean;
  isCustom: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDevicePresetParams {
  name: string;
  width: number;
  height: number;
  isCustom?: boolean;
}

export interface UpdateDevicePresetParams {
  id: number;
  name?: string;
  width?: number;
  height?: number;
}

export function registerDevicePresetsHandlers() {
  // Get all device presets
  handle("get-device-presets", async (): Promise<DevicePreset[]> => {
    const presets = await db.query.devicePresets.findMany({
      orderBy: [desc(devicePresets.isDefault), desc(devicePresets.name)],
    });

    return presets;
  });

  // Add a new device preset
  handle(
    "add-device-preset",
    async (_, params: CreateDevicePresetParams): Promise<DevicePreset> => {
      const { name, width, height, isCustom = true } = params;

      // Validate input
      if (!name || !width || !height) {
        throw new Error("Name, width, and height are required");
      }

      if (width <= 0 || height <= 0) {
        throw new Error("Width and height must be positive numbers");
      }

      // Check if device with same name already exists
      const existing = await db.query.devicePresets.findFirst({
        where: eq(devicePresets.name, name),
      });

      if (existing) {
        throw new Error(`Device preset with name "${name}" already exists`);
      }

      const [preset] = await db
        .insert(devicePresets)
        .values({
          name,
          width,
          height,
          isCustom,
          isDefault: false,
        })
        .returning();

      logger.info(`Added device preset: ${name} (${width}x${height})`);
      return preset;
    },
  );

  // Update a device preset
  handle(
    "update-device-preset",
    async (_, params: UpdateDevicePresetParams): Promise<DevicePreset> => {
      const { id, name, width, height } = params;

      // Check if preset exists
      const existing = await db.query.devicePresets.findFirst({
        where: eq(devicePresets.id, id),
      });

      if (!existing) {
        throw new Error(`Device preset with id ${id} not found`);
      }

      // Don't allow updating default presets
      if (existing.isDefault) {
        throw new Error("Cannot update default device presets");
      }

      // Validate dimensions if provided
      if (width !== undefined && width <= 0) {
        throw new Error("Width must be a positive number");
      }

      if (height !== undefined && height <= 0) {
        throw new Error("Height must be a positive number");
      }

      // Check if new name conflicts with existing preset
      if (name && name !== existing.name) {
        const nameConflict = await db.query.devicePresets.findFirst({
          where: eq(devicePresets.name, name),
        });

        if (nameConflict) {
          throw new Error(`Device preset with name "${name}" already exists`);
        }
      }

      // Build update object
      const updates: Partial<typeof devicePresets.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (name !== undefined) updates.name = name;
      if (width !== undefined) updates.width = width;
      if (height !== undefined) updates.height = height;

      const [updated] = await db
        .update(devicePresets)
        .set(updates)
        .where(eq(devicePresets.id, id))
        .returning();

      logger.info(`Updated device preset: ${updated.name} (${id})`);
      return updated;
    },
  );

  // Delete a device preset
  handle("delete-device-preset", async (_, id: number): Promise<void> => {
    // Check if preset exists
    const existing = await db.query.devicePresets.findFirst({
      where: eq(devicePresets.id, id),
    });

    if (!existing) {
      throw new Error(`Device preset with id ${id} not found`);
    }

    // Don't allow deleting default presets
    if (existing.isDefault) {
      throw new Error("Cannot delete default device presets");
    }

    await db.delete(devicePresets).where(eq(devicePresets.id, id));

    logger.info(`Deleted device preset: ${existing.name} (${id})`);
  });
}
