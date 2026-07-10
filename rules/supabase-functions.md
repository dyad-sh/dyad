# Supabase Functions

- Supabase Edge Function deploy queueing is per project. `bundleOnly=true` bundling can run with high concurrency, but `bundleOnly=false` activating deploys must run exclusively for the same project and should wait for same-project bundle jobs already in flight.
- Build and validate a stat-only deployment plan before reading function or `_shared` files. Pass its estimated bytes and source signature to `enqueueSupabaseDeploy`; pending jobs must not retain file buffers, and equivalent source revisions should coalesce.
- Keep deploy memory controls byte-aware as well as count-aware: shared-file buffers belong in the bounded TTL/LRU cache, active payloads share the global byte budget, and idle per-project queues must be evicted.
