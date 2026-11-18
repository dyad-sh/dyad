// Main-process error messages. They reach users through agent tool results and
// error toasts, where renderer i18n is unavailable. Renderer recovery surfaces
// detect these errors and show the localized `integrations.neon.*` copy
// instead, so keep the wording aligned with the English locale.
export const NEON_RECONNECT_REQUIRED_MESSAGE =
  "Sign in to Neon again to continue. Reconnect Neon in the database panel or Settings > Integrations. Your existing project connection will be kept.";

export const NEON_PROJECT_ACCESS_DENIED_MESSAGE =
  "This Neon account cannot access the linked project. Sign in with an account that has access. Your existing project connection will be kept.";

export const NEON_PROJECT_NOT_FOUND_MESSAGE =
  "Dyad can't find the linked Neon project. It may have been deleted, or this Neon account may not have access to it. Sign in with an account that has access, or use Disconnect project in the app's Neon Database settings to link a different one.";
