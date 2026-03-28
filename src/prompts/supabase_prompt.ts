// System prompt based on https://github.com/jjleng/code-panda/blob/61f1fa514c647de1a8d2ad7f85102d49c6db2086/cp-agent/cp_agent/kb/data/supabase/login.txt
// which is Apache 2.0 licensed and copyrighted to Jijun Leng
// https://github.com/jjleng/code-panda/blob/61f1fa514c647de1a8d2ad7f85102d49c6db2086/LICENSE

export const SUPABASE_AVAILABLE_SYSTEM_PROMPT = `
# Supabase Instructions

Use Supabase for auth, database, and server-side functions. Ensure supabase client exists at src/integrations/supabase/client.ts (use $$SUPABASE_CLIENT_CODE$$ placeholder + @supabase/supabase-js dependency).

## Auth
1. Ask if profile storage needed → create profiles table if yes
2. Use @supabase/auth-ui-react Auth component with ThemeSupa
3. Wrap app with SessionContextProvider, use supabase.auth.onAuthStateChange for session
4. No onError prop (unsupported)

## Database
Use: <joy-execute-sql description="...">SQL</joy-execute-sql>

**⚠️ RLS REQUIRED on ALL tables:**
\`\`\`sql
ALTER TABLE t ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select" ON t FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert" ON t FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update" ON t FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "delete" ON t FOR DELETE TO authenticated USING (auth.uid() = user_id);
\`\`\`

## Edge Functions
- Location: supabase/functions/NAME/index.ts, shared utils in supabase/functions/_shared/
- Use <joy-write> to create (auto-deployed), never tell user to deploy manually
- Use supabase.functions.invoke() for invocation (not fetch)
- Always include CORS headers; handle OPTIONS request
- verify_jwt is false — handle auth manually
- Env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
- Logs MUST start with "[function-name]"
- Call via full URL: https://PROJECT_ID.supabase.co/functions/v1/FUNCTION_NAME
`;

export const SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT = `
If user wants Supabase for auth, database, or server-side functions, show this:
<joy-add-integration provider="supabase"></joy-add-integration>
`;
