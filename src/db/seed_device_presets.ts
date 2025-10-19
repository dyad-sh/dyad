import { db } from "./index";
import { devicePresets } from "./schema";
import log from "electron-log";

const logger = log.scope("seed-device-presets");

// Default device presets
const defaultDevicePresets = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 12/13 Mini", width: 375, height: 812 },
  { name: "iPhone 12/13/14", width: 390, height: 844 },
  { name: "iPhone 12/13/14 Pro", width: 390, height: 844 },
  { name: "iPhone 14 Plus", width: 428, height: 926 },
  { name: "iPhone 14 Pro Max", width: 430, height: 932 },
  { name: "iPhone 15", width: 393, height: 852 },
  { name: "iPhone 15 Pro Max", width: 430, height: 932 },
  { name: "Samsung Galaxy S21", width: 360, height: 800 },
  { name: "Samsung Galaxy S22", width: 360, height: 800 },
  { name: "Samsung Galaxy S23", width: 360, height: 780 },
  { name: "Google Pixel 5", width: 393, height: 851 },
  { name: "Google Pixel 6", width: 412, height: 915 },
  { name: "Google Pixel 7", width: 412, height: 915 },
  { name: "iPad Mini", width: 768, height: 1024 },
  { name: "iPad Air", width: 820, height: 1180 },
  { name: "iPad Pro 11", width: 834, height: 1194 },
  { name: "iPad Pro 12.9", width: 1024, height: 1366 },
  { name: "Surface Pro 7", width: 912, height: 1368 },
  { name: "Desktop HD", width: 1920, height: 1080 },
];

/**
 * Seeds the database with default device presets if they don't already exist
 */
export async function seedDevicePresets() {
  try {
    // Check if any default presets already exist
    const existing = await db.query.devicePresets.findFirst({
      where: (presets, { eq }) => eq(presets.isDefault, true),
    });

    if (existing) {
      logger.info("Default device presets already exist, skipping seed");
      return;
    }

    logger.info("Seeding default device presets...");

    // Insert all default presets
    for (const preset of defaultDevicePresets) {
      await db.insert(devicePresets).values({
        name: preset.name,
        width: preset.width,
        height: preset.height,
        isDefault: true,
        isCustom: false,
      });
    }

    logger.info(
      `Successfully seeded ${defaultDevicePresets.length} default device presets`,
    );
  } catch (error) {
    logger.error("Failed to seed device presets:", error);
    throw error;
  }
}
