const https = require("node:https");
const fs = require("node:fs");

const originalGet = https.get.bind(https);
const originalRequest = https.request.bind(https);

function getHostname(input, options) {
  if (input instanceof URL) return input.hostname;
  if (typeof input === "string") return new URL(input).hostname;
  return input?.hostname ?? input?.host ?? options?.hostname ?? options?.host;
}

function authenticatedArgs(args) {
  const [input, options, callback] = args;
  const normalizedOptions = typeof options === "function" ? undefined : options;
  const normalizedCallback = typeof options === "function" ? options : callback;
  const hostname = getHostname(input, normalizedOptions);
  const token = process.env.SFW_GITHUB_TOKEN;
  if (!token || hostname !== "api.github.com") return args;

  const markerPath = process.env.SFW_GITHUB_AUTH_MARKER;
  if (markerPath) fs.writeFileSync(markerPath, "authenticated\n");

  if (typeof input === "object" && !(input instanceof URL)) {
    return [
      {
        ...input,
        headers: {
          ...input.headers,
          Authorization: `Bearer ${token}`,
        },
      },
      normalizedCallback,
    ];
  }

  return [
    input,
    {
      ...normalizedOptions,
      headers: {
        ...normalizedOptions?.headers,
        Authorization: `Bearer ${token}`,
      },
    },
    normalizedCallback,
  ];
}

https.request = (...args) => originalRequest(...authenticatedArgs(args));
https.get = (...args) => originalGet(...authenticatedArgs(args));
