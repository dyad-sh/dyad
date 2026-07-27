// @vitest-environment node
import { access, readFile, stat } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  disposeVertexCredentialFiles,
  materializeVertexServiceAccount,
} from "./vertex_credentials";

afterEach(async () => {
  await disposeVertexCredentialFiles();
});

describe("Vertex service-account credential bridge", () => {
  it("materializes one restrictive process-scoped JSON file and removes it on dispose", async () => {
    const json = JSON.stringify({
      type: "service_account",
      project_id: "demo-project",
      private_key: "secret",
      client_email: "test@example.com",
    });

    const firstPath = await materializeVertexServiceAccount(json);
    const secondPath = await materializeVertexServiceAccount(json);

    expect(secondPath).toBe(firstPath);
    expect(await readFile(firstPath, "utf8")).toBe(json);
    if (process.platform !== "win32") {
      expect((await stat(firstPath)).mode & 0o777).toBe(0o600);
    }

    await disposeVertexCredentialFiles();
    await expect(access(firstPath)).rejects.toThrow();
  });

  it("rejects malformed service-account JSON before writing a file", async () => {
    await expect(materializeVertexServiceAccount("not-json")).rejects.toThrow(
      "valid JSON",
    );
  });
});
