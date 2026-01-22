// Vault Confirm Upload Edge Function
// Confirms that a backup upload has completed successfully
// Requires JWT authentication (do NOT deploy with --no-verify-jwt)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ConfirmUploadRequest {
  backupId: string;
}

interface ConfirmUploadResponse {
  success: boolean;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    // Verify this is a POST request
    if (req.method !== "POST") {
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
        },
      );
    }

    const userId = user.id;

    // Parse request body
    const body: ConfirmUploadRequest = await req.json();

    // Validate required fields
    if (!body.backupId || typeof body.backupId !== "string") {
      return new Response(JSON.stringify({ error: "backupId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create admin client for database operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get backup record and verify ownership
    const { data: backup, error: fetchError } = await supabaseAdmin
      .from("vault_backups")
      .select("id, user_id, status")
      .eq("id", body.backupId)
      .single();

    if (fetchError || !backup) {
      return new Response(JSON.stringify({ error: "Backup not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify the backup belongs to the requesting user
    if (backup.user_id !== userId) {
      return new Response(
        JSON.stringify({ error: "Access denied to this backup" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Verify backup is in pending status
    if (backup.status !== "pending") {
      return new Response(
        JSON.stringify({
          error: `Cannot confirm upload: backup status is '${backup.status}'`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Update backup status to uploaded
    const { error: updateError } = await supabaseAdmin
      .from("vault_backups")
      .update({ status: "uploaded" })
      .eq("id", body.backupId);

    if (updateError) {
      console.error("Failed to update backup status:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to confirm upload" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const response: ConfirmUploadResponse = {
      success: true,
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
