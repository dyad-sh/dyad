/**
 * Supabase Agent Context Capability
 *
 * Provides context information to the AI agent about the Supabase project.
 */

import { IS_TEST_BUILD } from "../../../ipc/utils/test_utils";
import { retryWithRateLimit } from "../../../ipc/utils/retryWithRateLimit";
import { getSupabaseClientForOrganization } from "./oauth";
import {
  SUPABASE_SCHEMA_QUERY,
  SUPABASE_FUNCTIONS_QUERY,
} from "../../../supabase_admin/supabase_schema_query";
import type {
  AgentContextCapability,
  GetContextParams,
  GetProjectInfoParams,
} from "../../types";

// ─────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────

async function getClient(organizationSlug?: string | null) {
  if (!organizationSlug) {
    throw new Error("Organization slug is required for Supabase operations");
  }
  return getSupabaseClientForOrganization(organizationSlug);
}

async function getPublishableKey({
  projectId,
  accountId,
}: {
  projectId: string;
  accountId?: string | null;
}): Promise<string> {
  if (IS_TEST_BUILD) {
    return "test-publishable-key";
  }

  const supabase = await getClient(accountId);
  let keys;
  try {
    keys = await retryWithRateLimit(
      () => supabase.getProjectApiKeys(projectId),
      `Get API keys for ${projectId}`,
    );
  } catch (error) {
    throw new Error(
      `Failed to fetch API keys for Supabase project "${projectId}". This could be due to: 1) Invalid project ID, 2) Network connectivity issues, or 3) Supabase API unavailability. Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!keys) {
    throw new Error("No keys found for Supabase project " + projectId);
  }

  const publishableKey = keys.find(
    (key) =>
      (key as any)["name"] === "anon" || (key as any)["type"] === "publishable",
  );

  if (!publishableKey) {
    throw new Error(
      "No publishable key found for project. Make sure you are connected to the correct Supabase account and project. See https://dyad.sh/docs/integrations/supabase#no-publishable-keys",
    );
  }

  return publishableKey.api_key;
}

// Query to get just table names (lightweight)
const TABLE_NAMES_QUERY = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
  ORDER BY table_name;
`;

// ─────────────────────────────────────────────────────────────────────
// Agent Context Capability Implementation
// ─────────────────────────────────────────────────────────────────────

export function createAgentContextCapability(): AgentContextCapability {
  return {
    getContext: async (params: GetContextParams): Promise<string> => {
      const { projectId, accountId } = params;

      if (IS_TEST_BUILD) {
        if (projectId === "test-branch-project-id") {
          return "1234".repeat(200_000);
        }
        return "[[TEST_BUILD_SUPABASE_CONTEXT]]";
      }

      const supabase = await getClient(accountId);
      const publishableKey = await getPublishableKey({
        projectId,
        accountId,
      });

      const schema = await retryWithRateLimit(
        () => supabase.runQuery(projectId, SUPABASE_SCHEMA_QUERY),
        `Get schema for ${projectId}`,
      );

      const secrets = await retryWithRateLimit(
        () => supabase.getSecrets(projectId),
        `Get secrets for ${projectId}`,
      );
      const secretNames = secrets?.map((secret) => secret.name);

      const context = `
# Supabase Context

## Supabase Project ID
${projectId}

## Publishable key (aka anon key)
${publishableKey}

## Secret names (environmental variables)
${JSON.stringify(secretNames)}

## Schema
${JSON.stringify(schema)}
`;

      return context;
    },

    getProjectInfo: async (params: GetProjectInfoParams): Promise<string> => {
      const { projectId, accountId, includeDbFunctions } = params;

      if (IS_TEST_BUILD) {
        let result = `# Supabase Project Info

## Project ID
${projectId}

## Publishable Key
test-publishable-key

## Secret Names
["TEST_SECRET_1", "TEST_SECRET_2"]

## Table Names
["users", "posts", "comments"]
`;
        if (includeDbFunctions) {
          result += `
## Database Functions
[{"name": "test_function", "arguments": "", "return_type": "void", "language": "plpgsql"}]
`;
        }
        return result;
      }

      const supabase = await getClient(accountId);
      const publishableKey = await getPublishableKey({
        projectId,
        accountId,
      });

      const secrets = await retryWithRateLimit(
        () => supabase.getSecrets(projectId),
        `Get secrets for ${projectId}`,
      );
      const secretNames = secrets?.map((secret) => secret.name) ?? [];

      const tableResult = await retryWithRateLimit(
        () => supabase.runQuery(projectId, TABLE_NAMES_QUERY),
        `Get table names for ${projectId}`,
      );
      const tableNames =
        (tableResult as unknown as { table_name: string }[] | undefined)?.map(
          (row) => row.table_name,
        ) ?? [];

      let result = `# Supabase Project Info

## Project ID
${projectId}

## Publishable Key
${publishableKey}

## Secret Names
${JSON.stringify(secretNames)}

## Table Names
${JSON.stringify(tableNames)}
`;

      if (includeDbFunctions) {
        const functionsResult = await retryWithRateLimit(
          () => supabase.runQuery(projectId, SUPABASE_FUNCTIONS_QUERY),
          `Get DB functions for ${projectId}`,
        );
        result += `
## Database Functions
${JSON.stringify(functionsResult)}
`;
      }

      return result;
    },
  };
}

// Re-export helper for generating client code
export async function getSupabaseClientCode({
  projectId,
  accountId,
}: {
  projectId: string;
  accountId?: string | null;
}): Promise<string> {
  const publishableKey = await getPublishableKey({
    projectId,
    accountId,
  });

  return `
// This file is automatically generated. Do not edit it directly.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://${projectId}.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "${publishableKey}";

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);`;
}
