import { expect } from "@playwright/test";
import Database from "better-sqlite3";
import path from "path";
import { test, Timeout } from "./helpers/test_helper";

async function setGitHubDeviceCodeResponseMode(
  fakeLlmPort: number,
  mode: "json" | "github-gzip-chunked",
) {
  const response = await fetch(
    `http://localhost:${fakeLlmPort}/github/api/test/device-code-response-mode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to set GitHub device-code response mode: ${response.status}`,
    );
  }
}

async function patchSafeStorageForLegacyPlaintextProbe(po: {
  electronApp: {
    evaluate: <T>(
      callback: (electron: typeof Electron.CrossProcessExports) => T,
    ) => Promise<T>;
  };
}) {
  await po.electronApp.evaluate(({ safeStorage }) => {
    const globalState = globalThis as typeof globalThis & {
      __dyadE2eSafeStorage?: {
        isEncryptionAvailable: typeof safeStorage.isEncryptionAvailable;
        decryptString: typeof safeStorage.decryptString;
        decryptCalls: number;
      };
    };

    globalState.__dyadE2eSafeStorage = {
      isEncryptionAvailable: safeStorage.isEncryptionAvailable,
      decryptString: safeStorage.decryptString,
      decryptCalls: 0,
    };

    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.decryptString = () => {
      globalState.__dyadE2eSafeStorage!.decryptCalls++;
      throw new Error("legacy plaintext should not reach decryptString");
    };
  });
}

async function restoreSafeStoragePatch(po: {
  electronApp: {
    evaluate: <T>(
      callback: (electron: typeof Electron.CrossProcessExports) => T,
    ) => Promise<T>;
  };
}) {
  await po.electronApp.evaluate(({ safeStorage }) => {
    const globalState = globalThis as typeof globalThis & {
      __dyadE2eSafeStorage?: {
        isEncryptionAvailable: typeof safeStorage.isEncryptionAvailable;
        decryptString: typeof safeStorage.decryptString;
        decryptCalls: number;
      };
    };
    const original = globalState.__dyadE2eSafeStorage;
    if (!original) return;
    safeStorage.isEncryptionAvailable = original.isEncryptionAvailable;
    safeStorage.decryptString = original.decryptString;
    delete globalState.__dyadE2eSafeStorage;
  });
}

async function getSafeStorageDecryptCalls(po: {
  electronApp: {
    evaluate: <T>(callback: () => T) => Promise<T>;
  };
}) {
  return po.electronApp.evaluate(() => {
    const globalState = globalThis as typeof globalThis & {
      __dyadE2eSafeStorage?: { decryptCalls: number };
    };
    return globalState.__dyadE2eSafeStorage?.decryptCalls ?? 0;
  });
}

test("GitHub device flow handles GitHub-style gzip chunked response", async ({
  po,
}) => {
  await setGitHubDeviceCodeResponseMode(po.fakeLlmPort, "github-gzip-chunked");

  try {
    await po.setUp();
    await po.sendPrompt("tc=basic");
    await po.appManagement.getTitleBarAppNameButton().click();

    await po.page.getByRole("button", { name: "Connect to GitHub" }).click();

    await expect(po.page.getByText("FAKE-CODE")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(
      po.page.getByText("Failed to start GitHub connection"),
    ).toBeHidden();
  } finally {
    await setGitHubDeviceCodeResponseMode(po.fakeLlmPort, "json");
  }
});

test("MCP OAuth legacy plaintext state does not call safeStorage.decryptString", async ({
  po,
}) => {
  await expect(po.page.getByRole("link", { name: "Plugins" })).toBeVisible({
    timeout: Timeout.EXTRA_LONG,
  });

  const server = await po.page.evaluate(async () => {
    return await (window as any).electron.ipcRenderer.invoke(
      "mcp:create-server",
      {
        name: "legacy-oauth-state",
        transport: "http",
        url: "http://localhost:65535/mcp",
        enabled: true,
        oauthEnabled: true,
      },
    );
  });

  const legacyState = Buffer.from(
    JSON.stringify({
      tokens: {
        access_token: "legacy-token",
        token_type: "Bearer",
      },
    }),
    "utf8",
  ).toString("base64");

  const sqlite = new Database(path.join(po.userDataDir, "sqlite.db"));
  try {
    sqlite
      .prepare("UPDATE mcp_servers SET oauth_state = ? WHERE id = ?")
      .run(legacyState, server.id);
  } finally {
    sqlite.close();
  }

  await patchSafeStorageForLegacyPlaintextProbe(po);
  try {
    const servers = await po.page.evaluate(async () => {
      return await (window as any).electron.ipcRenderer.invoke(
        "mcp:list-servers",
      );
    });

    const storedServer = servers.find((s: any) => s.id === server.id);
    expect(storedServer?.oauthConnected).toBe(true);
    expect(await getSafeStorageDecryptCalls(po)).toBe(0);
  } finally {
    await restoreSafeStoragePatch(po);
  }
});
