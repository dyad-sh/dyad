# Supabase Functions

- Supabase Edge Function deploy queueing is per project. `bundleOnly=true` bundling can run with high concurrency, but `bundleOnly=false` activating deploys must run exclusively for the same project and should wait for same-project bundle jobs already in flight.
- Never treat a missing app, missing `supabase/functions` directory, or empty
  valid local function set as authorization to prune every remote function.
  The app may be connected to a pre-existing production project; whole-set
  sync must fall back to a deploy-only no-op when no valid local functions exist.
