import { describe, expect, it, vi } from "vitest";
import {
  getSupabaseAvailableSystemPrompt,
  SUPABASE_AUTH_REDIRECT_RULE,
} from "./supabase_prompt";

describe("Supabase auth redirect guidance", () => {
  const prompt = getSupabaseAvailableSystemPrompt(
    "// Existing Supabase client",
  );

  it("requires explicit redirects and includes one in the Auth UI example", () => {
    expect(prompt).toContain(SUPABASE_AUTH_REDIRECT_RULE);
    expect(prompt).toContain(
      "redirectTo={new URL('/auth/callback', window.location.origin).href}",
    );
    expect(prompt).toContain(
      "Do not rely on the project's Site URL fallback or change Site URL",
    );
    expect(prompt).toContain(
      "replace hardcoded localhost callbacks and add missing redirect options",
    );
  });

  it.each(["http://app-9.localhost:42999", "https://production.example"])(
    "examples send each flow back to the active origin %s",
    async (origin) => {
      const auth = {
        signInWithOAuth: vi.fn(),
        signUp: vi.fn(),
        signInWithOtp: vi.fn(),
        resetPasswordForEmail: vi.fn(),
      };
      const example = prompt.match(
        /Browser examples[\s\S]*?```typescript\n([\s\S]*?)```/,
      )?.[1];
      expect(example).toBeDefined();
      const run = new Function(
        "window",
        "supabase",
        "email",
        "password",
        `return (async () => { ${example} })();`,
      );
      await run(
        { location: { origin } },
        { auth },
        "user@example.com",
        "password",
      );
      expect(auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: `${origin}/auth/callback` },
      });
      expect(auth.signUp).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "password",
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      expect(auth.signInWithOtp).toHaveBeenCalledWith({
        email: "user@example.com",
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "user@example.com",
        { redirectTo: `${origin}/reset-password` },
      );
    },
  );
});
