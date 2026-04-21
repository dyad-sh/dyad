import { createClient } from "@supabase/supabase-js";

// Supabase client for JoyCreate renderer (edge function calls, etc.)
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://jgsbmnzhvuwiujqbaieo.supabase.co";

// Falls back to the JoyCreate public anon key so the app does not crash when
// the .env file is absent (e.g. in the packaged Electron app or local dev
// without a .env file). This key is safe to embed — it is the public anon key.
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnc2JtbnpodnV3aXVqcWJhaWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2MDAxNTEsImV4cCI6MjA1NjE3NjE1MX0.jGGW8mTgX7jXcWiylbxmjOwCIGdl226LRauVMXiWtc4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
