import { createClient } from "@supabase/supabase-js";

// Supabase client for JoyCreate renderer (edge function calls, etc.)
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://jgsbmnzhvuwiujqbaieo.supabase.co";

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
