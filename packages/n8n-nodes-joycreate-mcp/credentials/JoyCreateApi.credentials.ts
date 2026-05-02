import {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

/**
 * Credentials for talking to a local (or remote) JoyCreate API server.
 *
 * The JoyCreate desktop app runs an HTTP server on http://127.0.0.1:18793
 * by default and writes a bearer token to `~/.openclaw/joycreate-api-token`.
 * Paste that token here.
 */
export class JoyCreateApi implements ICredentialType {
  name = "joyCreateApi";
  displayName = "JoyCreate API";
  documentationUrl = "https://github.com/DisciplesofLove/JoyCreate";
  properties: INodeProperties[] = [
    {
      displayName: "Server URL",
      name: "serverUrl",
      type: "string",
      default: "http://127.0.0.1:18793",
      placeholder: "http://127.0.0.1:18793",
      description:
        "Base URL of the JoyCreate HTTP API. Default is the local desktop app.",
    },
    {
      displayName: "API Token",
      name: "apiToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        "Bearer token. The JoyCreate desktop app writes one to `~/.openclaw/joycreate-api-token` on startup.",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiToken}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.serverUrl}}",
      url: "/api/mcp/list-servers",
      method: "POST",
      body: {},
    },
  };
}
