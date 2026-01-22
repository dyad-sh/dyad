// Vault List Backups Edge Function
// Lists all backups for the authenticated user
// Requires JWT authentication (do NOT deploy with --no-verify-jwt)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface BackupInfo {
  id: string;
  projectName: string;
  sizeBytes: number | null;
  sha256: string | null;
  status: string;
  createdAt: string;
  appVersion: string | null;
  notes: string | null;
}

interface ListBackupsResponse {
  backups: BackupInfo[];
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    // Verify this is a GET request
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Create client with user's JWT to get their user ID
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the user's JWT and get their ID
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const userId = user.id;

    // Create admin client for database operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch all backups for the user, ordered by creation date descending
    const { data: backups, error: fetchError } = await supabaseAdmin
      .from("vault_backups")
      .select(
        "id, project_name, size_bytes, sha256, status, created_at, app_version, notes"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Failed to fetch backups:", fetchError);
      return new Response(
        JSON.stringify({ error: "Failed to retrieve backups" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Transform to camelCase response
    const backupInfos: BackupInfo[] = (backups || []).map((b) => ({
      id: b.id,
      projectName: b.project_name,
      sizeBytes: b.size_bytes,
      sha256: b.sha256,
      status: b.status,
      createdAt: b.created_at,
      appVersion: b.app_version,
      notes: b.notes,
    }));

    const response: ListBackupsResponse = {
      backups: backupInfos,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
