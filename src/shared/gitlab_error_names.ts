// Safe to import from both processes: no Electron, no Node.
//
// Split out so the telemetry filter can match on these without importing the
// GitLab client, the same way Coolify's names are split out. A GitLab
// instance the user runs is the same class of surface as a self-hosted
// Coolify: its failures quote the address and whatever that machine said.

export const GITLAB_REQUEST_ERROR_NAME = "GitLabRequestError";
export const GITLAB_TRANSPORT_ERROR_NAME = "GitLabTransportError";
