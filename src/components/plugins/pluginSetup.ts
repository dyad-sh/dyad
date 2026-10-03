import type { McpServer } from "@/ipc/types";
import { isRequiredInput, type CatalogInput } from "@/ipc/types/mcp_catalog";

// Whether a declared setup input already has a stored value. The client
// secret never reaches the renderer, so a saved client id stands in for
// the id/secret pair it was saved alongside.
function isInputSatisfied(server: McpServer, input: CatalogInput): boolean {
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
  server: McpServer,
  inputs: CatalogInput[],
): boolean {
  return inputs.some(
    (input) => isRequiredInput(input) && !isInputSatisfied(server, input),
  );
}

// Optional inputs that still have no saved value, offered on the detail
// page after setup so they can be filled in later.
export function unfilledOptionalInputs<T extends CatalogInput>(
  server: McpServer,
  inputs: T[],
): T[] {
  return inputs.filter(
    (input) => !isRequiredInput(input) && !isInputSatisfied(server, input),
  );
}
