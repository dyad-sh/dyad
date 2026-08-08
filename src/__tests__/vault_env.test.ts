import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  collectSettingsSecrets,
  parseEnvFile,
  providerEnvName,
  readVaultEnv,
  renderEnvFile,
  settingsPatchFromEnv,
  writeVaultEnv,
} from "@/ipc/utils/vault_env";
import type { UserSettings } from "@/lib/schemas";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vault-env-"));

function settings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { name: "gpt-5", provider: "openai" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: false,
    releaseChannel: "stable",
    ...overrides,
  } as UserSettings;
}

beforeEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("providerEnvName", () => {
  it("uses the known name for a built-in provider", () => {
    expect(providerEnvName("openai")).toBe("OPENAI_API_KEY");
    expect(providerEnvName("google")).toBe("GEMINI_API_KEY");
  });

  it("derives a valid name for a custom provider", () => {
    expect(providerEnvName("my-local.llm")).toBe("MY_LOCAL_LLM_API_KEY");
  });
});

describe("collectSettingsSecrets", () => {
  it("gathers provider keys and standalone tokens", () => {
    const entries = collectSettingsSecrets(
      settings({
        providerSettings: {
          openai: { apiKey: { value: "sk-openai" } },
          anthropic: { apiKey: { value: "sk-anthropic" } },
        },
        githubAccessToken: { value: "ghp_1" },
        jarvis: { elevenLabsApiKey: { value: "xi-1" } },
      } as Partial<UserSettings>),
    );

    expect(entries).toEqual({
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      GITHUB_ACCESS_TOKEN: "ghp_1",
      ELEVENLABS_API_KEY: "xi-1",
    });
  });

  it("skips providers with no key", () => {
    const entries = collectSettingsSecrets(
      settings({
        providerSettings: { openai: {}, anthropic: { apiKey: { value: "" } } },
      } as Partial<UserSettings>),
    );
    expect(entries).toEqual({});
  });
});

describe("render and parse", () => {
  it("round-trips values unchanged", () => {
    const entries = {
      OPENAI_API_KEY: "sk-proj-abc123",
      WEIRD_KEY: 'has "quotes" and spaces',
      MULTILINE: "line1\nline2",
    };
    expect(parseEnvFile(renderEnvFile(entries))).toEqual(entries);
  });

  it("leaves simple values unquoted", () => {
    expect(renderEnvFile({ A: "sk-abc_123" })).toContain("A=sk-abc_123");
  });

  it("warns about the contents in a comment", () => {
    expect(renderEnvFile({ A: "b" })).toContain("plain text");
  });

  it("ignores comments and blank lines", () => {
    expect(parseEnvFile("# note\n\nA=1\n")).toEqual({ A: "1" });
  });

  it("accepts export-prefixed and single-quoted lines", () => {
    expect(parseEnvFile("export A='hello world'")).toEqual({
      A: "hello world",
    });
  });

  it("drops entries with an empty value", () => {
    expect(parseEnvFile("A=\nB=2")).toEqual({ B: "2" });
  });
});

describe("writeVaultEnv", () => {
  it("writes an owner-only file next to a .gitignore", async () => {
    const result = await writeVaultEnv(
      scratch,
      settings({
        providerSettings: { openai: { apiKey: { value: "sk-1" } } },
      } as Partial<UserSettings>),
    );

    expect(result.count).toBe(1);
    const mode = fs.statSync(result.path).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(fs.readFileSync(path.join(scratch, ".gitignore"), "utf8")).toContain(
      ".env",
    );
  });

  it("keeps keys the vault already had but settings has lost", async () => {
    await writeVaultEnv(
      scratch,
      settings({
        providerSettings: { openai: { apiKey: { value: "sk-1" } } },
      } as Partial<UserSettings>),
    );
    // A settings file that lost the key must not wipe the vault's copy.
    await writeVaultEnv(
      scratch,
      settings({
        providerSettings: { anthropic: { apiKey: { value: "sk-2" } } },
      } as Partial<UserSettings>),
    );

    const env = await readVaultEnv(scratch);
    expect(env.OPENAI_API_KEY).toBe("sk-1");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-2");
  });

  it("does not add .env twice to an existing .gitignore", async () => {
    fs.writeFileSync(path.join(scratch, ".gitignore"), "node_modules\n.env\n");
    await writeVaultEnv(scratch, settings());
    const ignore = fs.readFileSync(path.join(scratch, ".gitignore"), "utf8");
    expect(ignore.match(/^\.env$/gm)).toHaveLength(1);
  });

  it("reads back nothing when there is no file", async () => {
    expect(await readVaultEnv(path.join(scratch, "missing"))).toEqual({});
  });
});

describe("settingsPatchFromEnv", () => {
  it("fills in a provider key that settings is missing", () => {
    const patch = settingsPatchFromEnv(
      settings({ providerSettings: { openai: {} } } as Partial<UserSettings>),
      { OPENAI_API_KEY: "sk-restored" },
    );
    expect(patch?.providerSettings?.openai?.apiKey?.value).toBe("sk-restored");
  });

  it("never overwrites a key the user already set", () => {
    const patch = settingsPatchFromEnv(
      settings({
        providerSettings: { openai: { apiKey: { value: "sk-current" } } },
      } as Partial<UserSettings>),
      { OPENAI_API_KEY: "sk-stale" },
    );
    expect(patch).toBeNull();
  });

  it("restores the ElevenLabs key as a single jarvis field", () => {
    const patch = settingsPatchFromEnv(settings(), {
      ELEVENLABS_API_KEY: "xi-restored",
    });
    // Sending only the changed field matters: whole-object writes have
    // erased sibling jarvis settings before.
    expect(patch?.jarvis).toEqual({
      elevenLabsApiKey: { value: "xi-restored" },
    });
  });

  it("restores GitHub, Vercel and Blob tokens", () => {
    const patch = settingsPatchFromEnv(settings(), {
      GITHUB_ACCESS_TOKEN: "ghp_x",
      VERCEL_ACCESS_TOKEN: "vc_x",
      BLOB_READ_WRITE_TOKEN: "blob_x",
    });
    expect(patch?.githubAccessToken?.value).toBe("ghp_x");
    expect(patch?.vercelAccessToken?.value).toBe("vc_x");
    expect(patch?.vercelBlob?.token?.value).toBe("blob_x");
  });

  it("returns null when the vault adds nothing", () => {
    expect(settingsPatchFromEnv(settings(), {})).toBeNull();
    expect(settingsPatchFromEnv(settings(), { UNRELATED: "x" })).toBeNull();
  });

  it("restores a provider settings has lost entirely", () => {
    // Settings that were reset keep no provider entry to fill in, which is the
    // case the vault mirror is meant to rescue.
    const patch = settingsPatchFromEnv(
      settings({ providerSettings: {} } as Partial<UserSettings>),
      {
        OPENAI_API_KEY: "sk-restored",
        OPENROUTER_API_KEY: "or-restored",
        AI_GATEWAY_API_KEY: "gw-restored",
        FAL_KEY: "fal-restored",
      },
    );

    expect(patch?.providerSettings?.openai?.apiKey?.value).toBe("sk-restored");
    expect(patch?.providerSettings?.openrouter?.apiKey?.value).toBe(
      "or-restored",
    );
    expect(patch?.providerSettings?.vercel?.apiKey?.value).toBe("gw-restored");
    expect(patch?.providerSettings?.fal?.apiKey?.value).toBe("fal-restored");
  });

  it("keeps unrelated providers when restoring a missing one", () => {
    const patch = settingsPatchFromEnv(
      settings({
        providerSettings: { mx_serve: { apiBaseUrl: "http://localhost:8080" } },
      } as Partial<UserSettings>),
      { OPENAI_API_KEY: "sk-restored" },
    );

    expect(patch?.providerSettings?.openai?.apiKey?.value).toBe("sk-restored");
    expect(patch?.providerSettings?.mx_serve?.apiBaseUrl).toBe(
      "http://localhost:8080",
    );
  });

  it("ignores a custom provider the vault cannot name", () => {
    // providerEnvName slugs a custom id lossily, so there is no id to restore
    // to once settings has dropped the entry.
    expect(
      settingsPatchFromEnv(
        settings({ providerSettings: {} } as Partial<UserSettings>),
        { MY_CUSTOM_API_KEY: "nope" },
      ),
    ).toBeNull();
  });

  it("survives a full write-then-restore round trip", async () => {
    const original = settings({
      providerSettings: { openai: { apiKey: { value: "sk-round" } } },
      githubAccessToken: { value: "ghp_round" },
    } as Partial<UserSettings>);
    await writeVaultEnv(scratch, original);

    // A fresh install: providers configured, keys gone.
    const reinstalled = settings({
      providerSettings: { openai: {} },
    } as Partial<UserSettings>);
    const patch = settingsPatchFromEnv(
      reinstalled,
      await readVaultEnv(scratch),
    );

    expect(patch?.providerSettings?.openai?.apiKey?.value).toBe("sk-round");
    expect(patch?.githubAccessToken?.value).toBe("ghp_round");
  });
});
