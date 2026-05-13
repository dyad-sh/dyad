import { describe, expect, it } from "vitest";

import { getSupabaseAvailableSystemPrompt } from "../prompts/supabase_prompt";

describe("getSupabaseAvailableSystemPrompt", () => {
  it("instructs agents to grant Data API access with RLS policies", () => {
    const prompt = getSupabaseAvailableSystemPrompt("// supabase client");

    expect(prompt).toContain("### Data API Grants");
    expect(prompt).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.table_name TO service_role;",
    );
    expect(prompt).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.table_name TO authenticated;",
    );
    expect(prompt).toContain(
      "-- GRANT SELECT ON TABLE public.table_name TO anon;",
    );
    expect(prompt).toContain(
      "GRANT USAGE, SELECT ON SEQUENCE public.table_name_id_seq TO authenticated;",
    );

    const createTableIndex = prompt.indexOf("CREATE TABLE public.table_name");
    const grantIndex = prompt.indexOf(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.table_name TO authenticated;",
      createTableIndex,
    );
    const rlsIndex = prompt.indexOf(
      "ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;",
      grantIndex,
    );

    expect(createTableIndex).toBeGreaterThanOrEqual(0);
    expect(grantIndex).toBeGreaterThan(createTableIndex);
    expect(rlsIndex).toBeGreaterThan(grantIndex);
  });

  it("adds explicit profile table grants without granting anon by default", () => {
    const prompt = getSupabaseAvailableSystemPrompt("// supabase client");

    expect(prompt).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;",
    );
    expect(prompt).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;",
    );
    expect(prompt).toContain(
      "-- ONLY add this policy if public profile viewing is specifically required\nGRANT SELECT ON TABLE public.profiles TO anon;",
    );
  });
});
