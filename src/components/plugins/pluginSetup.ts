import type { McpConnectionConfig, McpServer } from "@/ipc/types";
import {
  isRequiredInput,
  userSuppliedInputs,
  type CatalogInput,
  type McpCatalogEntry,
} from "@/ipc/types/mcp_catalog";
import { isInputSatisfied, needsCatalogSetup } from "@/shared/mcp_setup_inputs";

// A catalog server needs setup while any required input it declares is
// still unfilled; see needsCatalogSetup.
export function serverNeedsSetup(
  server: McpConnectionConfig,
  inputs: CatalogInput[],
): boolean {
  return needsCatalogSetup(server, inputs);
}

// Optional inputs that still have no saved value, offered on the detail
// page after setup so they can be filled in later.
export function unfilledOptionalInputs<T extends CatalogInput>(
  server: McpConnectionConfig,
  inputs: T[],
): T[] {
  return inputs.filter(
    (input) => !isRequiredInput(input) && !isInputSatisfied(server, input),
  );
}

// The plugin switch can't be turned on while the default configuration's
// setup is incomplete and turning the plugin on would give that default to
// some app. A default that serves no app can stay unfinished while
// app-specific configurations are used. Turning a plugin off is never
// locked.
export function pluginSwitchLocked(
  server: McpServer,
  defaultSetupIncomplete: boolean,
): boolean {
  const defaultServesApps =
    server.defaultScope === "all" ||
    (server.defaultScope === "selected" && server.defaultAppIds.length > 0);
  return !server.enabled && defaultSetupIncomplete && defaultServesApps;
}

// Where a connection stands on its catalog setup. Shared by the plugin's
// default configuration and its app-specific ones, which use the same
// catalog entry.
export function connectionSetupState(
  connection: McpConnectionConfig,
  catalogEntry: McpCatalogEntry | undefined,
  catalogIsLoading: boolean,
) {
  const setupInputs = userSuppliedInputs(catalogEntry?.inputs);
  // Show the guided setup until every declared field has a saved value.
  const needsSetup = serverNeedsSetup(connection, setupInputs);
  // A disabled catalog server might still need setup while its catalog is
  // loading, so keep its controls locked until the fetch settles. Once it
  // settles (even on error) the toggle works again, so a slow or failing
  // catalog can't strand an already-configured server.
  const setupPending =
    !!connection.catalogSlug && catalogIsLoading && !connection.enabled;
  return {
    setupInputs,
    needsSetup,
    setupPending,
    setupIncomplete: needsSetup || setupPending,
  };
}
