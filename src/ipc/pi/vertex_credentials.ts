import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

interface MaterializedCredential {
  digest: string;
  directory: string;
  filePath: string;
}

let currentCredential: MaterializedCredential | undefined;
let serializedOperation: Promise<void> = Promise.resolve();

process.once("exit", () => {
  if (currentCredential) {
    rmSync(currentCredential.directory, { recursive: true, force: true });
  }
});

function validateServiceAccountJson(json: string): void {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
  } catch (error) {
    throw new DyadError(
      "Vertex service account key must be valid JSON.",
      DyadErrorKind.Validation,
      { cause: error },
    );
  }
}

export async function materializeVertexServiceAccount(
  json: string,
): Promise<string> {
  validateServiceAccountJson(json);
  const digest = createHash("sha256").update(json).digest("hex");

  let resultPath = "";
  const operation = serializedOperation.then(async () => {
    if (currentCredential?.digest === digest) {
      resultPath = currentCredential.filePath;
      return;
    }

    const directory = await mkdtemp(path.join(tmpdir(), "dyad-vertex-"));
    const filePath = path.join(directory, "service-account.json");
    try {
      await writeFile(filePath, json, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }

    const previous = currentCredential;
    currentCredential = { digest, directory, filePath };
    resultPath = filePath;
    if (previous) {
      await rm(previous.directory, { recursive: true, force: true });
    }
  });
  serializedOperation = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
  return resultPath;
}

export async function disposeVertexCredentialFiles(): Promise<void> {
  const operation = serializedOperation.then(async () => {
    const credential = currentCredential;
    currentCredential = undefined;
    if (credential) {
      await rm(credential.directory, { recursive: true, force: true });
    }
  });
  serializedOperation = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
}
