import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const fakeAuth = (): Plugin => ({
  name: "recorder-fake-auth",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(
        request.url ?? "/",
        "http://recorder.test",
      ).pathname;

      if (
        pathname === "/api/auth/sign-in/email" &&
        request.method === "POST"
      ) {
        request.resume();
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.setHeader(
          "Set-Cookie",
          "recorder-session=authenticated; Path=/; HttpOnly; SameSite=Lax",
        );
        response.end(JSON.stringify({ user: { id: "test-user" } }));
        return;
      }

      if (pathname === "/api/auth/get-session") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        const authenticated = request.headers.cookie?.includes(
          "recorder-session=authenticated",
        );
        response.end(
          JSON.stringify(
            authenticated ? { user: { id: "test-user" } } : null,
          ),
        );
        return;
      }

      next();
    });
  },
});

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [fakeAuth(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
