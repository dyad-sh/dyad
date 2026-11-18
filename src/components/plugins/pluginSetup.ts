import type { McpConnectionConfig } from "@/ipc/types";
import {
  isRequiredInput,
  userSuppliedInputs,
  type CatalogInput,
  type McpCatalogEntry,
} from "@/ipc/types/mcp_catalog";

// Whether a declared setup input already has a stored value. The client
// secret never reaches the renderer, so a saved client id stands in for
// the id/secret pair it was saved alongside.
function isInputSatisfied(
  server: McpConnectionConfig,
  input: CatalogInput,
): boolean {
  switch (input.kind) {
    case "header":
      return !!server.headersJson?.[input.name];
    case "env":
      return !!server.envJson?.[input.name];
    case "oauthClientId":
    case "oauthClientSecret":
      return !!server.oauthClientId;
    // Supplied by the catalog, so there is nothing for the user to fill in.
    // Callers filter this kind out before building a form; this case only
    // keeps an unfiltered list from reporting setup that can't be done.
    case "vendoredOAuthClient":
      return true;
  }
}

// A catalog server needs setup while any required input it declares is
// still unfilled, independent of enabled state: disabling a configured
// server must not send it back through setup. Optional inputs are offered
// on the setup form but never hold it open.
export function serverNeedsSetup(
  server: McpConnectionConfig,
  inputs: CatalogInput[],
): boolean {
  return inputs.some(
    (input) => isRequiredInput(input) && !isInputSatisfied(server, input),
  );
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
