import { isRequiredInput, type CatalogInput } from "@/ipc/types/mcp_catalog";

/** The stored values a catalog entry's setup inputs are filled into. */
export interface SetupInputValues {
  envJson: Record<string, string> | null;
  headersJson: Record<string, string> | null;
  oauthClientId: string | null;
}

// Whether a declared setup input already has a stored value. The client
// secret never reaches the renderer, so a saved client id stands in for
// the id/secret pair it was saved alongside.
export function isInputSatisfied(
  values: SetupInputValues,
  input: CatalogInput,
): boolean {
  switch (input.kind) {
    case "header":
      return !!values.headersJson?.[input.name];
    case "env":
      return !!values.envJson?.[input.name];
    case "oauthClientId":
    case "oauthClientSecret":
      return !!values.oauthClientId;
    // Supplied by the catalog, so there is nothing for the user to fill in.
    // Callers filter this kind out before building a form; this case only
    // keeps an unfiltered list from reporting setup that can't be done.
    case "vendoredOAuthClient":
      return true;
  }
}

// A connection needs setup while any required input its catalog entry
// declares is still unfilled, independent of enabled state: disabling a
// configured server must not send it back through setup. Optional inputs
// are offered on the setup form but never hold it open.
export function needsCatalogSetup(
  values: SetupInputValues,
  inputs: CatalogInput[],
): boolean {
  return inputs.some(
    (input) => isRequiredInput(input) && !isInputSatisfied(values, input),
  );
}
