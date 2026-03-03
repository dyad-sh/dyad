// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({
    supabase: {
      accessToken: { value: "test-access-token" },
      expiresIn: 3600,
      tokenTimestamp: Math.floor(Date.now() / 1000),
    },
  })),
  writeSettings: vi.fn(),
}));

vi.mock("@dyad-sh/supabase-management-js", () => ({
  SupabaseManagementAPI: class {
    options: { accessToken: string };

    constructor(options: { accessToken: string }) {
      this.options = options;
    }
  },
  SupabaseManagementAPIError: class extends Error {
    response: Response;

    constructor(message: string, response: Response) {
      super(message);
      this.name = "SupabaseManagementAPIError";
      this.response = response;
    }
  },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import {
  deploySupabaseFunction,
  type DeployedFunctionResponse,
} from "@/supabase_admin/supabase_management_client";

describe("deploySupabaseFunction", () => {
  let appPath: string;

  beforeEach(async () => {
    appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-supabase-test-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(appPath, { recursive: true, force: true });
  });

  it("uploads nested function source files with the expected paths", async () => {
    const functionName = "incoming-call-router";
    const functionRoot = path.join(
      appPath,
      "supabase",
      "functions",
      functionName,
    );

    const functionFiles = [
      "index.ts",
      "src/controllers/conference.ts",
      "src/controllers/initial.ts",
      "src/controllers/ivr.ts",
      "src/services/supabase.ts",
      "src/utils/text.ts",
    ];

    for (const file of functionFiles) {
      const filePath = path.join(functionRoot, file);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `// Dummy content for ${file}`);
    }

    const mockResponse: DeployedFunctionResponse = {
      id: "function-id",
      slug: functionName,
      name: functionName,
      status: "ACTIVE",
      version: 1,
    };

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const formData = init?.body as unknown as FormData;
      expect(formData).toBeInstanceOf(FormData);

      const metadata = JSON.parse(String(formData.get("metadata")));
      expect(metadata).toEqual({
        entrypoint_path: `${functionName}/index.ts`,
        name: functionName,
        verify_jwt: false,
        import_map_path: `${functionName}/import_map.json`,
      });

      const uploadedPaths = formData
        .getAll("file")
        .map((entry) => (entry as File).name)
        .sort();
      const expectedPaths = [
        `${functionName}/import_map.json`,
        ...functionFiles.map((f) => `${functionName}/${f}`),
      ].sort();
      expect(uploadedPaths).toEqual(expectedPaths);

      return new Response(JSON.stringify(mockResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await deploySupabaseFunction({
      supabaseProjectId: "test-project",
      functionName,
      appPath,
      organizationSlug: null,
    });

    expect(result).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.supabase.com/v1/projects/test-project/functions/deploy?slug=incoming-call-router",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
