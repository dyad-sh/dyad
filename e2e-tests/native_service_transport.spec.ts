import { expect, test, _electron } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("native service transport reads compressed responses and preserves signed uploads in Electron", async () => {
  const server = createServer(async (req, res) => {
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.end(
        JSON.stringify({
          bytes: Buffer.concat(chunks).toString("base64"),
          type: req.headers["content-type"],
        }),
      );
      return;
    }
    if (req.headers.authorization !== "Bearer synthetic-key") {
      res.writeHead(401);
      res.end();
      return;
    }
    const body = gzipSync(JSON.stringify({ remaining: 7 }));
    res.writeHead(200, {
      "Content-Encoding": "gzip",
      "Transfer-Encoding": "chunked",
    });
    res.write(body.subarray(0, 17));
    setImmediate(() => res.end(body.subarray(17)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "native-service-transport-"),
  );
  let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    await build({
      entryPoints: ["src/ipc/utils/native_fetch.ts"],
      outfile: path.join(directory, "fetch.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
    });
    const entry = path.join(directory, "main.cjs");
    await writeFile(
      entry,
      'globalThis.fetchService = require("./fetch.cjs").default; require("electron").app.whenReady();',
    );
    app = await _electron.launch({
      args: [entry],
      executablePath: process.env.DYAD_E2E_SERVICE_ELECTRON_EXECUTABLE,
    });
    const result = await app.evaluate(async (_, base) => {
      const request = (globalThis as any).fetchService as typeof fetch;
      const response = await request(base, {
        headers: { Authorization: "Bearer synthetic-key" },
      });
      // A Buffer slice exercises pooled backing storage and byte offsets.
      const bytes = Buffer.from([99, 137, 80, 78, 71, 0, 255, 99]).subarray(
        1,
        7,
      );
      const uploaded = await request(base, {
        method: "PUT",
        body: bytes as unknown as BodyInit,
        headers: { "Content-Type": "image/png" },
      });
      return {
        electron: process.versions.electron,
        encoding: response.headers.get("content-encoding"),
        data: await response.json(),
        upload: await uploaded.json(),
      };
    }, base);
    console.log(
      `Native service transport passed in Electron ${result.electron}`,
    );
    expect(result).toMatchObject({
      encoding: "gzip",
      data: { remaining: 7 },
      upload: { bytes: "iVBORwD/", type: "image/png" },
    });
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
