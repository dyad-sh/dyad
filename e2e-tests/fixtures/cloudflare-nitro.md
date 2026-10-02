Adding a Nitro server layer to the app.

<dyad-write path="nitro.config.ts" description="Nitro config">
import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
});
</dyad-write>

Done.
