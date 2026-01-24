import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";
import { UserSettingsSchema } from "../../lib/schemas";

// =============================================================================
// Settings Contracts
// =============================================================================

/**
 * Settings contracts define the IPC interface for user settings.
 * These are the simplest endpoints - no complex input, just get/set operations.
 */
export const settingsContracts = {
  /**
   * Get current user settings.
   * Returns the full UserSettings object.
   */
  getUserSettings: defineContract({
    channel: "get-user-settings",
    input: z.void(),
    output: UserSettingsSchema,
  }),

  /**
   * Update user settings.
   * Accepts partial settings and returns the updated full settings.
   */
  setUserSettings: defineContract({
    channel: "set-user-settings",
    input: UserSettingsSchema.partial(),
    output: UserSettingsSchema,
  }),
} as const;

// =============================================================================
// Settings Client
// =============================================================================

/**
 * Type-safe client for settings IPC operations.
 * Auto-generated from contracts - method names match contract keys.
 *
 * @example
 * const settings = await settingsClient.getUserSettings();
 * await settingsClient.setUserSettings({ autoApproveChanges: true });
 */
export const settingsClient = createClient(settingsContracts);

// =============================================================================
// Type Exports
// =============================================================================

/** Input type for getUserSettings */
export type GetUserSettingsInput = z.infer<
  (typeof settingsContracts)["getUserSettings"]["input"]
>;

/** Output type for getUserSettings */
export type GetUserSettingsOutput = z.infer<
  (typeof settingsContracts)["getUserSettings"]["output"]
>;

/** Input type for setUserSettings */
export type SetUserSettingsInput = z.infer<
  (typeof settingsContracts)["setUserSettings"]["input"]
>;

/** Output type for setUserSettings */
export type SetUserSettingsOutput = z.infer<
  (typeof settingsContracts)["setUserSettings"]["output"]
>;
