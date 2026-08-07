# Supabase Functions

- Supabase Edge Function deploy queueing is per project. `bundleOnly=true` bundling can run with high concurrency, but `bundleOnly=false` activating deploys must run exclusively for the same project and should wait for same-project bundle jobs already in flight.
- Never treat a missing app or `supabase/functions` directory as an intentional
  empty function set for pruning. The path may be unavailable or the app may
  have been connected to a pre-existing project; only prune all remote
  functions when the local functions directory exists and an explicit sync
  observes it as empty.
