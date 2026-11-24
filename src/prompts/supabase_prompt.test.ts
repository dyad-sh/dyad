import { describe, expect, it, vi } from "vitest";
import {
  getSupabaseAvailableSystemPrompt,
  SUPABASE_AUTH_REDIRECT_RULE,
  SUPABASE_AUTH_BROWSER_EXAMPLE,
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
      expect(prompt).toContain(SUPABASE_AUTH_BROWSER_EXAMPLE);
      const run = new Function(
        "window",
        "supabase",
        "email",
        "password",
        `return (async () => { ${SUPABASE_AUTH_BROWSER_EXAMPLE} })();`,
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

describe("self-hosted Supabase prompt", () => {
  const url = "http://supabase.example.com";
  const selfHosted = (
    functionsDeployed: boolean,
    pendingFunctions: string[] = [],
  ) =>
    getSupabaseAvailableSystemPrompt("// client", {
      url,
      functionsDeployed,
      pendingFunctions,
    });

  it("replaces Cloud-only instructions instead of contradicting them", () => {
    for (const prompt of [selfHosted(true), selfHosted(false)]) {
      for (const cloudOnly of [
        "supabase.co",
        "Supabase Console",
        "Manage Secrets",
        "URL Configuration",
        "Dyad registers",
        "<resource-link>",
        "override",
      ]) {
        expect(prompt).not.toContain(cloudOnly);
      }
      expect(prompt).toContain(
        `This app uses a self-hosted Supabase instance at ${url}, not Supabase Cloud.`,
      );
      expect(prompt).toContain(
        `   - Format: ${url}/functions/v1/EDGE_FUNCTION_NAME\n`,
      );
      expect(prompt).toContain("ADDITIONAL_REDIRECT_URLS");
    }
  });

  it("keeps the Cloud passages for Cloud projects", () => {
    const prompt = getSupabaseAvailableSystemPrompt("// client");
    expect(prompt).toContain(
      "   - Format: https://SUPABASE_PROJECT_ID.supabase.co/functions/v1/EDGE_FUNCTION_NAME\n",
    );
    expect(prompt).toContain(
      "Direct them to: Project -> Edge Functions -> Manage Secrets",
    );
    expect(prompt).not.toContain("self-hosted");
  });

  it("says whether functions run on the instance", () => {
    expect(selfHosted(true)).toContain(
      "- Edge Functions are deployed automatically after edits. After an update,",
    );
    const withoutSsh = selfHosted(false);
    expect(withoutSsh).toContain(
      "- Edge Functions are NOT deployed to this instance",
    );
    expect(withoutSsh).not.toContain("deployed automatically");
  });

  it("names functions whose update may not be live yet", () => {
    expect(selfHosted(true, ["send-email", "charge"])).toContain(
      "These functions were just updated and may still answer with their previous code: send-email, charge. A result from calling one may not reflect the latest code yet.",
    );
  });

  it("leaves telling the user about setup state to Dyad's UI", () => {
    const pendingFunctions = ["send-email"];
    for (const functionsDeployed of [true, false]) {
      // Only the secrets rule asks the agent to tell the user something,
      // as the Cloud instructions do for secrets. "Do NOT tell the user" is
      // a prohibition, not a request.
      expect(
        selfHosted(functionsDeployed, pendingFunctions).match(
          /(?<!not )tell the user/gi,
        ),
      ).toEqual(["Tell the user"]);
    }
  });

  it("says nothing about updates when none are pending or none are deployed", () => {
    const pendingFunctions = ["send-email"];
    for (const prompt of [
      selfHosted(true),
      selfHosted(false, pendingFunctions),
    ]) {
      expect(prompt).not.toContain("just updated");
    }
  });
});
