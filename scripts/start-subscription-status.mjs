import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const state = process.argv[2];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function futureDate(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getPayload(requestedState) {
  switch (requestedState) {
    case "payment_past_due":
      return {
        alert: "payment_past_due",
        effectiveAt: null,
        actionUrl: "https://academy.dyad.sh/billing?source=desktop_fixture",
      };
    case "subscription_ending":
      return {
        alert: "subscription_ending",
        effectiveAt: futureDate(14),
        actionUrl:
          "https://academy.dyad.sh/subscription?source=desktop_fixture",
      };
    case "subscription_paused":
      return {
        alert: "subscription_paused",
        effectiveAt: futureDate(30),
        actionUrl:
          "https://academy.dyad.sh/subscription?source=desktop_fixture",
      };
    case "healthy":
      return { alert: null, effectiveAt: null, actionUrl: null };
    default:
      throw new Error(
        `Unknown subscription fixture "${requestedState ?? ""}". ` +
          "Expected payment_past_due, subscription_ending, subscription_paused, or healthy.",
      );
  }
}

let payload;
try {
  payload = getPayload(state);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const fixtureApiKey = randomUUID();
const server = createServer((request, response) => {
  if (
    request.method !== "GET" ||
    request.url !== "/subscription-status" ||
    request.headers.authorization !== `Bearer ${fixtureApiKey}`
  ) {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    console.error("Failed to start the local subscription fixture server.");
    process.exit(1);
  }

  const endpoint = `http://127.0.0.1:${address.port}/subscription-status`;
  console.log(`Starting Dyad with subscription fixture: ${state}`);
  console.log(`  endpoint: ${endpoint}`);

  const child = spawn(npmCommand, ["start"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      DYAD_SUBSCRIPTION_STATUS_URL: endpoint,
      DYAD_SUBSCRIPTION_STATUS_FIXTURE_API_KEY: fixtureApiKey,
    },
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }

  child.on("exit", (code, signal) => {
    server.close(() => {
      if (signal) {
        process.exit(signal === "SIGINT" ? 130 : 143);
      }
      process.exit(code ?? 0);
    });
  });
});
