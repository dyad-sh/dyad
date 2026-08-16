import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ElevenLabs key must survive the full settings round-trip: written by
 * the renderer as a partial update, encrypted on disk, and read back in
 * plaintext for the voice session.
 */

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-settings-"));

vi.mock("electron", () => ({
  app: { on: vi.fn(), getPath: () => scratchRoot },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  safeStorage: {
    // Mirror the real thing closely enough to catch double-encryption.
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString();
      if (!text.startsWith("enc:")) {
        throw new Error("Not encrypted with this key");
      }
      return text.slice(4);
    },
  },
}));

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => scratchRoot,
}));

const { readSettings, writeSettings, getSettingsFilePath } =
  await import("@/main/settings");

function rawFile(): Record<string, any> {
  return JSON.parse(fs.readFileSync(getSettingsFilePath(), "utf8"));
}

beforeEach(() => {
  try {
    fs.unlinkSync(getSettingsFilePath());
  } catch {
    // First run.
  }
});

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

describe("JARVIS settings persistence", () => {
  it("saves the ElevenLabs key and reads it back in plaintext", () => {
    writeSettings({
      jarvis: { elevenLabsApiKey: { value: "xi-my-secret" } },
    });

    const settings = readSettings();
    expect(settings.jarvis?.elevenLabsApiKey?.value).toBe("xi-my-secret");
  });

  it("stores the key encrypted on disk, never in plaintext", () => {
    writeSettings({
      jarvis: { elevenLabsApiKey: { value: "xi-my-secret" } },
    });

    const onDisk = rawFile();
    expect(onDisk.jarvis.elevenLabsApiKey.value).not.toBe("xi-my-secret");
    expect(onDisk.jarvis.elevenLabsApiKey.encryptionType).toBe(
      "electron-safe-storage",
    );
    expect(JSON.stringify(onDisk)).not.toContain("xi-my-secret");
  });

  it("keeps the key when an unrelated setting is written afterwards", () => {
    writeSettings({
      jarvis: { elevenLabsApiKey: { value: "xi-my-secret" } },
    });
    writeSettings({ selectedChatMode: "ask" });

    const settings = readSettings();
    expect(settings.jarvis?.elevenLabsApiKey?.value).toBe("xi-my-secret");
  });

  it("keeps the key when another JARVIS field is updated", () => {
    writeSettings({
      jarvis: { elevenLabsApiKey: { value: "xi-my-secret" } },
    });

    // The settings page sends the whole jarvis object back, as the renderer
    // received it (already decrypted).
    const current = readSettings().jarvis;
    writeSettings({ jarvis: { ...current, voiceId: "voice-123" } });

    const settings = readSettings();
    expect(settings.jarvis?.voiceId).toBe("voice-123");
    expect(settings.jarvis?.elevenLabsApiKey?.value).toBe("xi-my-secret");
  });

  it("does not double-encrypt across repeated saves", () => {
    writeSettings({ jarvis: { elevenLabsApiKey: { value: "xi-my-secret" } } });
    writeSettings({ jarvis: { ...readSettings().jarvis, speed: 1.1 } });
    writeSettings({ jarvis: { ...readSettings().jarvis, stability: 0.4 } });

    expect(readSettings().jarvis?.elevenLabsApiKey?.value).toBe("xi-my-secret");
  });

  it("keeps the key when only one other field is written", () => {
    writeSettings({ jarvis: { elevenLabsApiKey: { value: "xi-my-secret" } } });

    // How the settings page and the Agents page now write: just the change.
    writeSettings({ jarvis: { voiceEngine: "realtime" } });
    writeSettings({ jarvis: { inputDeviceId: "device-42" } });
    writeSettings({ jarvis: { brainAgentId: "agent-7" } });

    const settings = readSettings();
    expect(settings.jarvis?.elevenLabsApiKey?.value).toBe("xi-my-secret");
    expect(settings.jarvis?.voiceEngine).toBe("realtime");
    expect(settings.jarvis?.inputDeviceId).toBe("device-42");
    expect(settings.jarvis?.brainAgentId).toBe("agent-7");
  });

  it("persists the chat read-aloud provider with the ElevenLabs voice", () => {
    writeSettings({
      jarvis: {
        chatReadAloudProvider: "elevenlabs",
        voiceId: "voice-123",
      },
    });

    expect(readSettings().jarvis).toMatchObject({
      chatReadAloudProvider: "elevenlabs",
      voiceId: "voice-123",
    });
  });

  it("clears the key when it is removed", () => {
    writeSettings({ jarvis: { elevenLabsApiKey: { value: "xi-my-secret" } } });

    const current = readSettings().jarvis;
    writeSettings({
      jarvis: { ...current, elevenLabsApiKey: undefined },
    });

    expect(readSettings().jarvis?.elevenLabsApiKey).toBeUndefined();
  });

  it("survives the partial-update schema the IPC contract validates against", async () => {
    const { UserSettingsSchema } = await import("@/lib/schemas");
    const parsed = UserSettingsSchema.partial().safeParse({
      jarvis: {
        elevenLabsApiKey: { value: "xi-my-secret" },
        voiceId: "voice-123",
      },
    });

    expect(parsed.success).toBe(true);
    expect((parsed as any).data.jarvis.elevenLabsApiKey.value).toBe(
      "xi-my-secret",
    );
    expect((parsed as any).data.jarvis.voiceId).toBe("voice-123");
  });
});
