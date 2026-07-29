// S-AUTH spike: self-hosted better-auth 1.4.18 standing in for Neon Auth (Managed Better Auth).
// Serves the Better Auth HTTP API at http://127.0.0.1:7791/auth — the value the benchmark's
// neon-sim shim will return as the Neon Auth base_url.
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import pg from "pg";
import http from "node:http";

const PORT = 7791;

export const auth = betterAuth({
  baseURL: `http://127.0.0.1:${PORT}/auth`,
  basePath: "/auth",
  secret: "spike-s-auth-secret-0123456789abcdef0123456789abcdef",
  database: new pg.Pool({
    connectionString: "postgres://mini@localhost:5432/spike_sauth",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  trustedOrigins: [
    "http://localhost:3100",
    "http://127.0.0.1:3100",
    "http://localhost:3000",
  ],
  advanced: {
    // Managed Neon Auth emits cookies named __Secure-neon-auth.*; the
    // @neondatabase/auth proxy filters cookies by exactly that prefix, so the
    // stand-in must match it.
    cookiePrefix: "neon-auth",
    useSecureCookies: true,
  },
});

const handler = toNodeHandler(auth);

http
  .createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    handler(req, res);
  })
  .listen(PORT, () => {
    console.log(
      `[s-auth] better-auth listening on http://127.0.0.1:${PORT}/auth`,
    );
  });
