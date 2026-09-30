# Supabase Functions

- Supabase Edge Function deploy queueing is per project. `bundleOnly=true` bundling can run with high concurrency, but `bundleOnly=false` activating deploys must run exclusively for the same project and should wait for same-project bundle jobs already in flight.
- Capture the complete deployment batch before releasing repository/provider preparation claims. Upload and retry from immutable Blobs, sharing one captured `_shared` set across the batch; never re-read live function files during upload.
- Pass `appId` to standalone app-scoped function deploy/delete helpers. Callers already owning `supabase-functions` must omit it to avoid nested admission. Retain this dedicated claim through network settlement; project reassociation and recordings also claim it, while test runs do not. Start request deadlines after project-queue admission and carry chat cancellation through requests and retry delays.
- Pre-commit hooks enqueue confirmed function removals in `pendingFunctionDeletes` for root finalization. Deleting remotely while the hook holds repository/provider claims can race an older snapshot's activation and recreate the removed function.
- Never treat a missing app, missing `supabase/functions` directory, or empty
  valid local function set as authorization to prune every remote function.
  The app may be connected to a pre-existing production project; whole-set
  sync must fall back to a deploy-only no-op when no valid local functions exist.
