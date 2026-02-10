/**
 * Main test helper module for e2e tests.
 *
 * This file re-exports all testing utilities for backward compatibility.
 * The actual implementations have been modularized into separate files:
 *
 * - constants.ts: Timeout constants and configuration
 * - fixtures.ts: Playwright test fixtures and configuration helpers
 * - utils/: Normalization and dump prettification utilities
 * - page-objects/: Page object classes organized by component
 *   - PageObject.ts: Main page object composing all components
 *   - components/: Individual component page objects
 *   - dialogs/: Dialog-specific page objects
 */

// Re-export constants
export { Timeout, showDebugLogs } from "./constants";

// Re-export fixtures and test utilities
export {
  test,
  testWithConfig,
  testWithConfigSkipIfWindows,
  testSkipIfWindows,
  type ElectronConfig,
} from "./fixtures";

// Re-export page objects
export {
  PageObject,
  ContextFilesPickerDialog,
  ProModesDialog,
  GitHubConnector,
  ChatActions,
  PreviewPanel,
  CodeEditor,
  SecurityReview,
  ToastNotifications,
  AgentConsent,
  Navigation,
  ModelPicker,
  Settings,
  AppManagement,
  PromptLibrary,
} from "./page-objects";

// Re-export utilities (for tests that may need direct access)
export {
  normalizeItemReferences,
  normalizeToolCallIds,
  normalizeVersionedFiles,
  normalizePath,
  prettifyDump,
} from "./utils";
