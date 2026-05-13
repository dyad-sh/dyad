# Supabase Functions

- Supabase Edge Function deploy queueing is per project. `bundleOnly=true` bundling can run with high concurrency, but `bundleOnly=false` activating deploys must run exclusively for the same project and should wait for same-project bundle jobs already in flight.
