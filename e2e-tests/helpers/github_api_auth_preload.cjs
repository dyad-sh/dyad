const https = require("node:https");

const originalGet = https.get.bind(https);

https.get = (input, options, callback) => {
  const token = process.env.GITHUB_TOKEN;
  if (
    !token ||
    !(input instanceof URL) ||
    input.hostname !== "api.github.com"
  ) {
    return originalGet(input, options, callback);
  }

  return originalGet(
    input,
    {
      ...options,
      headers: {
        ...options?.headers,
        Authorization: `Bearer ${token}`,
      },
    },
    callback,
  );
};
