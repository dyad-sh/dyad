# Supabase Shared Modules

Store reusable utilities for Supabase Edge Functions in this directory. Each file should export logic that can be imported from individual functions within `supabase/functions`.

Import helpers from functions using relative paths, for example:

```ts
import { exampleHelper } from "../shared/exampleHelper.ts";
```

Avoid importing client-side application code into shared modules. Everything in this directory must be compatible with the Deno runtime used by Supabase Edge Functions.
