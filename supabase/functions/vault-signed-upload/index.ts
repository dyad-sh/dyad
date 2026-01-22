// Vault Signed Upload Edge Function
// Generates signed upload URLs for ABBA AI project backups
// Requires JWT authentication (do NOT deploy with --no-verify-jwt)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET_NAME = "abba-vault";
// Note: Signed upload URLs expire in ~2 hours (Supabase default)

interface SignedUploadRequest {
  projectName: string;
  sizeBytes: number;
  sha256: string;
  appVersion?: string;
  notes?: string;
}

interface SignedUploadResponse {
  backupId: string;
  path: string;
  signedUrl: string;
  token: string;
}

// Sanitize project name for safe file paths
function sanitizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-") // Replace unsafe chars with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Trim leading/trailing hyphens
    .slice(0, 50); // Limit length
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

    // Initialize Supabase client with service role for admin operations
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
    const body: SignedUploadRequest = await req.json();

    // Validate required fields
    if (!body.projectName || typeof body.projectName !== "string") {
      return new Response(
        JSON.stringify({ error: "projectName is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (!body.sizeBytes || typeof body.sizeBytes !== "number") {
      return new Response(JSON.stringify({ error: "sizeBytes is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!body.sha256 || typeof body.sha256 !== "string") {
      return new Response(JSON.stringify({ error: "sha256 is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Generate storage path
    const timestamp = Date.now();
    const safeProjectName = sanitizeProjectName(body.projectName);
    const storagePath = `${userId}/${timestamp}-${safeProjectName}.zip`;

    // Create admin client for database and storage operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Insert backup record with pending status
    const { data: backupData, error: insertError } = await supabaseAdmin
      .from("vault_backups")
      .insert({
        user_id: userId,
        project_name: body.projectName,
        storage_path: storagePath,
        size_bytes: body.sizeBytes,
        sha256: body.sha256,
        status: "pending",
        app_version: body.appVersion || null,
        notes: body.notes || null,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Failed to insert backup record:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create backup record" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Create signed upload URL
    const { data: signedUrlData, error: signedUrlError } =
      await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .createSignedUploadUrl(storagePath);

    if (signedUrlError) {
      console.error("Failed to create signed URL:", signedUrlError);
      // Clean up the pending backup record
      await supabaseAdmin
        .from("vault_backups")
        .delete()
        .eq("id", backupData.id);
      return new Response(
        JSON.stringify({ error: "Failed to create upload URL" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const response: SignedUploadResponse = {
      backupId: backupData.id,
      path: storagePath,
      signedUrl: signedUrlData.signedUrl,
      token: signedUrlData.token,
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
