Adding a Cloudflare Worker in its own folder.

<dyad-write path="worker/wrangler.jsonc" description="Worker config">
{
  // A Worker that lives beside the app
  "name": "e2e-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01"
}
</dyad-write>

<dyad-write path="worker/pnpm-lock.yaml" description="Worker lockfile">
lockfileVersion: '9.0'
</dyad-write>

<dyad-write path="worker/src/index.ts" description="Worker entry">
export default {
  fetch() {
    return new Response("hello from the worker");
  },
};
</dyad-write>

Done.
