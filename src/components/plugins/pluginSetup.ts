import type { McpServer } from "@/ipc/types";
import type { CatalogInput } from "@/ipc/types/mcp_catalog";

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
  }
}

// A catalog server needs setup while any input it declares is still
// unfilled, independent of enabled state: disabling a configured server
// must not send it back through setup.
export function serverNeedsSetup(
  server: McpServer,
  inputs: CatalogInput[],
): boolean {
  return inputs.some((input) => !isInputSatisfied(server, input));
}
