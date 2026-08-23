import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import log from "electron-log";
import { z } from "zod";
import { getFileWriteKey, withLock } from "@/ipc/utils/lock_utils";
import { SecretSchema, type Secret } from "@/lib/schemas";

const logger = log.scope("temp_preview_store");

const StoredRecordSchema = z.object({
  tempId: z.string(),
  canonicalUrl: z.string().url(),
  updateToken: SecretSchema.optional(),
  expiresAt: z.string().nullable(),
  lastPublishedAt: z.string(),
  state: z.enum(["active", "revoked"]),
});

const StoreSchema = z.object({
  version: z.literal(1),
  records: z.record(z.string(), StoredRecordSchema),
});

const StoreEnvelopeSchema = z.object({
  version: z.literal(1),
  records: z.record(z.string(), z.unknown()),
});

export interface TempPreviewRecord {
  tempId: string;
  canonicalUrl: string;
  updateToken?: string;
  expiresAt: string | null;
  lastPublishedAt: string;
  state: "active" | "revoked";
}

export interface TempPreviewTokenCodec {
  encode(token: string): Secret;
  decode(secret: Secret): string;
}

export class TempPreviewStore {
  constructor(
    private readonly filePath: string,
    private readonly tokenCodec: TempPreviewTokenCodec,
  ) {}

  async read(appId: number): Promise<TempPreviewRecord | null> {
    return withLock(getFileWriteKey(this.filePath), async () => {
      const store = await this.readStore();
      const appIdKey = String(appId);
      const record = store.records[appIdKey];
      if (!record) return null;
      let updateToken: string | undefined;
      try {
        updateToken = record.updateToken
          ? this.tokenCodec.decode(record.updateToken)
          : undefined;
      } catch (error) {
        delete store.records[appIdKey];
        await this.recoverCorruptedStore(store, [appId], error);
        return null;
      }
      return {
        ...record,
        updateToken,
      };
    });
  }

  async write(appId: number, record: TempPreviewRecord): Promise<void> {
    await withLock(getFileWriteKey(this.filePath), async () => {
      const store = await this.readStore();
      store.records[String(appId)] = {
        ...record,
        updateToken: record.updateToken
          ? this.tokenCodec.encode(record.updateToken)
          : undefined,
      };
      await this.writeStoreFile(store);
    });
  }

  async remove(appId: number): Promise<void> {
    await withLock(getFileWriteKey(this.filePath), async () => {
      const store = await this.readStore();
      const appIdKey = String(appId);
      if (!(appIdKey in store.records)) return;
      delete store.records[appIdKey];
      await this.writeStoreFile(store);
    });
  }

  private async readStore(): Promise<z.infer<typeof StoreSchema>> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { version: 1, records: {} };
      }
      throw error;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(contents);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return this.recoverCorruptedStore({ version: 1, records: {} });
    }

    const envelope = StoreEnvelopeSchema.safeParse(decoded);
    if (!envelope.success) {
      return this.recoverCorruptedStore({ version: 1, records: {} });
    }

    const records: z.infer<typeof StoreSchema>["records"] = {};
    const discardedAppIds: number[] = [];
    for (const [appId, candidate] of Object.entries(envelope.data.records)) {
      const result = StoredRecordSchema.safeParse(candidate);
      if (result.success) {
        records[appId] = result.data;
      } else {
        const numericAppId = Number(appId);
        if (Number.isSafeInteger(numericAppId))
          discardedAppIds.push(numericAppId);
      }
    }
    const salvaged = { version: 1 as const, records };
    if (
      Object.keys(records).length !== Object.keys(envelope.data.records).length
    ) {
      return this.recoverCorruptedStore(salvaged, discardedAppIds);
    }
    return salvaged;
  }

  private async recoverCorruptedStore(
    salvaged: z.infer<typeof StoreSchema>,
    discardedAppIds: number[] = [],
    cause?: unknown,
  ): Promise<z.infer<typeof StoreSchema>> {
    const backupPath = await this.backUpCorruptedStore();
    await this.writeStoreFile(salvaged);
    const affectedApps =
      discardedAppIds.length === 0
        ? "unknown app records"
        : `app IDs ${discardedAppIds.join(", ")}`;
    const warning = `Quarantined unreadable temporary preview data for ${affectedApps}. Any active preview represented only by that data may require manual cleanup. Original data was backed up${backupPath ? ` to ${backupPath}` : ""}.`;
    if (cause === undefined) {
      logger.warn(warning);
    } else {
      logger.warn(warning, cause);
    }
    return salvaged;
  }

  private async writeStoreFile(
    store: z.infer<typeof StoreSchema>,
  ): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async backUpCorruptedStore(): Promise<string | null> {
    const backupPath = `${this.filePath}.corrupt-${process.pid}-${Date.now()}`;
    try {
      await rename(this.filePath, backupPath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
    return backupPath;
  }
}
