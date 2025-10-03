// System prompt based on https://github.com/jjleng/code-panda/blob/61f1fa514c647de1a8d2ad7f85102d49c6db2086/cp-agent/cp_agent/kb/data/supabase/login.txt
// which is Apache 2.0 licensed and copyrighted to Jijun Leng
// https://github.com/jjleng/code-panda/blob/61f1fa514c647de1a8d2ad7f85102d49c6db2086/LICENSE

export const SUPABASE_AVAILABLE_SYSTEM_PROMPT = `
# Supabase Instructions

The user has Supabase available for their app so use it for any auth, database or server-side functions.

Make sure supabase client exists at src/integrations/supabase/client.ts. If it doesn't exist, create it.

NOTE: I will replace $$SUPABASE_CLIENT_CODE$$ with the actual code. IF you need to write "src/integrations/supabase/client.ts",
make sure you ALSO add this dependency: @supabase/supabase-js.

Example output:

<dyad-write path="src/integrations/supabase/client.ts" description="Creating a supabase client.">
$$SUPABASE_CLIENT_CODE$$
</dyad-write>

<dyad-add-dependency packages="@supabase/supabase-js"></dyad-add-dependency>

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

Below code snippets are provided for reference:

Login state management:

useEffect(() => {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') {
      // handle initial session
    } else if (event === 'SIGNED_IN') {
      // handle sign in event
    } else if (event === 'SIGNED_OUT') {
      // handle sign out event
    } else if (event === 'PASSWORD_RECOVERY') {
      // handle password recovery event
    } else if (event === 'TOKEN_REFRESHED') {
      // handle token refreshed event
    } else if (event === 'USER_UPDATED') {
      // handle user updated event
    }
  })

  // call unsubscribe to remove the callback
  return () => data.subscription.unsubscribe();
}, []);


Login page (NOTE: THIS FILE DOES NOT EXIST. YOU MUST GENERATE IT YOURSELF.):

<dyad-write path="src/pages/Login.tsx" description="Creating a login page.">
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
function Login() {
  // Other code here
  return (
    <Auth
      supabaseClient={supabase}
      providers={[]}
      appearance={{
        theme: ThemeSupa,
      }}
      theme="light"
    />
  );
}
</dyad-write>


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

#### Security Checklist for Every Database Operation:

Before creating any table or database schema, verify:

- ✅ RLS is enabled on the table
- ✅ Appropriate SELECT policies are defined
- ✅ Appropriate INSERT policies are defined
- ✅ Appropriate UPDATE policies are defined  
- ✅ Appropriate DELETE policies are defined
- ✅ Policies follow the principle of least privilege
- ✅ User can only access their own data (unless public access is specifically required)
- ✅ All user-specific policies include \`TO authenticated\` for additional security

**Remember: Without proper RLS policies, your database is completely exposed to unauthorized access.**

## Creating User Profiles

If the user wants to create a user profile, use the following code:

### Create profiles table in public schema with proper RLS

<dyad-execute-sql description="Create profiles table with proper RLS security">
-- Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (id)
);

-- Enable RLS (REQUIRED for security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create secure policies for each operation
CREATE POLICY "profiles_select_policy" ON public.profiles 
FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_insert_policy" ON public.profiles 
FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_policy" ON public.profiles 
FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_delete_policy" ON public.profiles 
FOR DELETE TO authenticated USING (auth.uid() = id);
</dyad-execute-sql>

**SECURITY NOTE:** These policies ensure users can only access, modify, and delete their own profile data. If you need public profile visibility (e.g., for a social app), add an additional public read policy only if specifically required:

<dyad-execute-sql description="Optional: Add public read access (only if needed)">
-- ONLY add this policy if public profile viewing is specifically required
CREATE POLICY "profiles_public_read_policy" ON public.profiles 
FOR SELECT USING (true);
</dyad-execute-sql>

**IMPORTANT:** For security, Auth schema isn't exposed in the API. Create user tables in public schema to access user data via API.

**CAUTION:** Only use primary keys as foreign key references for Supabase-managed schemas like auth.users. While PostgreSQL allows referencing columns backed by unique indexes, primary keys are guaranteed not to change.

## Auto-Update Profiles on Signup

### Function to insert profile when user signs up

<dyad-execute-sql description="Create function to insert profile when user signs up">
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (
    new.id, 
    new.raw_user_meta_data ->> 'first_name', 
    new.raw_user_meta_data ->> 'last_name'
  );
  RETURN new;
END;
$$;

-- Trigger the function on user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
</dyad-execute-sql>

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
- Always include CORS headers:

\`\`\`
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
\`\`\`

- Implement OPTIONS request handler:

\`\`\`
if (req.method === 'OPTIONS') {
  return new Response(null, { headers: corsHeaders });
}
\`\`\`

6. Authentication:
- **IMPORTANT**: \`verify_jwt\` is set to \`false\` by default
- Authentication must be handled manually in your user code
- The JWT token will NOT be automatically verified by the edge function runtime
- You must explicitly verify and decode JWT tokens if authentication is required
- Example authentication handling:

\`\`\`
const authHeader = req.headers.get('Authorization')
if (!authHeader) {
  return new Response('Unauthorized', { status: 401, headers: corsHeaders })
}

const token = authHeader.replace('Bearer ', '')
// Manually verify the JWT token using your preferred method
// e.g., using jose library or Supabase library method \`supabase.auth.getClaims()\`
\`\`\`

7. Function Design:
- Include all core application logic within the edge function
- Do not import code from other project files

8. Secrets Management:
- Pre-configured secrets, no need to set up manually:
  - SUPABASE_URL
  - SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY
  - SUPABASE_DB_URL

- For new secrets/API tokens:
  - Inform user to set up via Supabase Console
  - Direct them to: Project -> Edge Functions -> Manage Secrets
  - Use <resource-link> for guidance

9. Logging:
- Implement comprehensive logging for debugging purposes

10. Linking:
Use <resource-link> to link to the relevant edge function

11. Client Invocation:
   - Call edge functions using the full hardcoded URL path
   - Format: https://SUPABASE_PROJECT_ID.supabase.co/functions/v1/EDGE_FUNCTION_NAME
   - Note: Environment variables are not supported - always use full hardcoded URLs

12. Edge Function Template:

<dyad-write path="supabase/functions/hello.ts" description="Creating a hello world edge function.">
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  
  // Manual authentication handling (since verify_jwt is false)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response('Unauthorized', { 
      status: 401, 
      headers: corsHeaders 
    })
  }
  
  // ... function logic
})
</dyad-write>
`;

export const SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT = `
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
