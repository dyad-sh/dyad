/**
 * Supabase Prompts Capability
 *
 * Provides system prompts for the AI agent when Supabase is available or not.
 */

import type { PromptsCapability, GetPromptParams } from "../../types";
import { getSupabaseClientCode } from "./agent_context";

// ─────────────────────────────────────────────────────────────────────
// Prompt Templates
// ─────────────────────────────────────────────────────────────────────

/**
 * System prompt when Supabase is available and connected.
 */
function getSupabaseAvailablePrompt(supabaseClientCode: string): string {
  return `
# Supabase Instructions

The user has Supabase available for their app so use it for any auth, database or server-side functions.

## Supabase Client Setup

Check if a Supabase client exists at \`src/integrations/supabase/client.ts\`.

**If it doesn't exist**, do both of the following:

1. **Create the client file** at \`src/integrations/supabase/client.ts\` (or the most appropriate path for the project structure) with this code:
\`\`\`typescript
${supabaseClientCode}
\`\`\`

2. **Add the dependency** \`@supabase/supabase-js\` to the project.

## Auth

When asked to add authentication or login feature to the app, always follow these steps:

1. User Profile Assessment:
   - Confirm if user profile data storage is needed (username, roles, avatars)
   - If yes: Create profiles table migration
   - If no: Proceed with basic auth setup

2. Core Authentication Setup:
   a. UI Components:
      - Use @supabase/auth-ui-react Auth component
      - Apply light theme (unless dark theme exists)
      - Style to match application design
      - Skip third-party providers unless specified

   b. Session Management:
      - Wrap app with SessionContextProvider (create this yourself)
      - Import supabase client from @/lib/supabaseClient
      - Implement auth state monitoring using supabase.auth.onAuthStateChange
      - Add automatic redirects:
        - Authenticated users → main page
        - Unauthenticated users → login page

   c. Error Handling:
      - Implement AuthApiError handling utility
      - Monitor auth state changes for errors
      - Clear errors on sign-out
      - DO NOT use onError prop (unsupported)

IMPORTANT! You cannot skip step 1.

## Database

If the user wants to use the database, use the following syntax:

<dyad-execute-sql description="Get all users">
SELECT * FROM users;
</dyad-execute-sql>

The description should be a short description of what the code is doing and be understandable by semi-technical users.

You will need to setup the database schema.

### Row Level Security (RLS)

**⚠️ SECURITY WARNING: ALWAYS ENABLE RLS ON ALL TABLES**

Row Level Security (RLS) is MANDATORY for all tables in Supabase. Without RLS policies, ANY user can read, insert, update, or delete ANY data in your database, creating massive security vulnerabilities.

#### RLS Best Practices (REQUIRED):

1. **Enable RLS on Every Table:**
<dyad-execute-sql description="Enable RLS on table">
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
</dyad-execute-sql>

2. **Create Appropriate Policies for Each Operation:**
   - SELECT policies (who can read data)
   - INSERT policies (who can create data)
   - UPDATE policies (who can modify data)
   - DELETE policies (who can remove data)

3. **Common RLS Policy Patterns:**

   **Public Read Access:** (ONLY USE THIS IF SPECIFICALLY REQUESTED)
<dyad-execute-sql description="Create public read access policy">
CREATE POLICY "Public read access" ON table_name FOR SELECT USING (true);
</dyad-execute-sql>

   **User-specific Data Access:**
<dyad-execute-sql description="Create user-specific data access policy">
CREATE POLICY "Users can only see their own data" ON table_name
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own data" ON table_name
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own data" ON table_name
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own data" ON table_name
FOR DELETE TO authenticated USING (auth.uid() = user_id);
</dyad-execute-sql>

#### RLS Policy Creation Template:

When creating any table, ALWAYS follow this pattern:

<dyad-execute-sql description="Create table">
-- Create table
CREATE TABLE table_name (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- other columns
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (REQUIRED)
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- Create policies for each operation needed
CREATE POLICY "policy_name_select" ON table_name
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "policy_name_insert" ON table_name
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "policy_name_update" ON table_name
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "policy_name_delete" ON table_name
FOR DELETE TO authenticated USING (auth.uid() = user_id);
</dyad-execute-sql>

**REMINDER: If you create a table without proper RLS policies, any user can access, modify, or delete ALL data in that table.**

## Server-side Edge Functions

### When to Use Edge Functions

- Use edge functions for:
  - API-to-API communications
  - Handling sensitive API tokens or secrets
  - Typical backend work requiring server-side logic

### Key Implementation Principles

1. Location:
- Write functions in the supabase/functions folder
- Each function should be in a standalone directory where the main file is index.ts (e.g., supabase/functions/hello/index.ts)
- Reusable utilities belong in the supabase/functions/_shared folder. Import them in your edge functions with relative paths like ../_shared/logger.ts.
- Make sure you use <dyad-write> tags to make changes to edge functions.
- The function will be deployed automatically when the user approves the <dyad-write> changes for edge functions.
- Do NOT tell the user to manually deploy the edge function using the CLI or Supabase Console. It's unhelpful and not needed.

2. Configuration:
- DO NOT edit config.toml

3. Supabase Client:
- Do not import code from supabase/
- Functions operate in their own context

4. Function Invocation:
- Use supabase.functions.invoke() method
- Avoid raw HTTP requests like fetch or axios

5. CORS Configuration:
- Always include CORS headers

6. Authentication:
- **IMPORTANT**: \`verify_jwt\` is set to \`false\` by default
- Authentication must be handled manually in your user code

7. Secrets Management:
- Pre-configured secrets, no need to set up manually:
  - SUPABASE_URL
  - SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY
  - SUPABASE_DB_URL

8. Logging:
- Implement comprehensive logging for debugging purposes.
- CRITICAL LOGGING RULE: Every log statement MUST start with "[function-name]".

9. Client Invocation:
- Call edge functions using the full hardcoded URL path
- Format: https://SUPABASE_PROJECT_ID.supabase.co/functions/v1/EDGE_FUNCTION_NAME
`;
}

/**
 * System prompt when Supabase is not available.
 */
const SUPABASE_NOT_AVAILABLE_PROMPT = `
If the user wants to use supabase or do something that requires auth, database or server-side functions (e.g. loading API keys, secrets),
tell them that they need to add supabase to their app.

The following response will show a button that allows the user to add supabase to their app.

<dyad-add-integration provider="supabase"></dyad-add-integration>

# Examples

## Example 1: User wants to use Supabase

### User prompt

I want to use supabase in my app.

### Assistant response

You need to first add Supabase to your app.

<dyad-add-integration provider="supabase"></dyad-add-integration>

## Example 2: User wants to add auth to their app

### User prompt

I want to add auth to my app.

### Assistant response

You need to first add Supabase to your app and then we can add auth.

<dyad-add-integration provider="supabase"></dyad-add-integration>
`;

// ─────────────────────────────────────────────────────────────────────
// Prompts Capability Implementation
// ─────────────────────────────────────────────────────────────────────

export function createPromptsCapability(): PromptsCapability {
  return {
    getSystemPrompt: async (params: GetPromptParams): Promise<string> => {
      const { projectId, accountId } = params;

      // If no project is connected, return the "not available" prompt
      if (!projectId) {
        return SUPABASE_NOT_AVAILABLE_PROMPT;
      }

      // Get the client code and return the "available" prompt
      try {
        const clientCode = await getSupabaseClientCode({
          projectId,
          accountId,
        });
        return getSupabaseAvailablePrompt(clientCode);
      } catch (error) {
        // If we can't get the client code, still return the available prompt
        // with a placeholder
        return getSupabaseAvailablePrompt(
          "// Failed to generate client code. Please check your Supabase connection.",
        );
      }
    },
  };
}

// Re-export prompt templates for direct use
export {
  getSupabaseAvailablePrompt,
  SUPABASE_NOT_AVAILABLE_PROMPT,
};
