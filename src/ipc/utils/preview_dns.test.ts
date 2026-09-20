import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  buildPreviewDnsSource,
  previewTestNodeOptions,
  PREVIEW_DNS_RELATIVE_PATH,
} from "./preview_dns";

it("resolves callback, promise and Playwright API requests in launched Node, preserving other DNS and NODE_OPTIONS", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dyad dns "));
  const server = http.createServer((req, res) => res.end(req.headers.host));
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as import("node:net").AddressInfo).port;
    const file = path.join(dir, PREVIEW_DNS_RELATIVE_PATH);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, buildPreviewDnsSource());
    const script = `
const assert = require('node:assert/strict');
const dns = require('node:dns');
const { request } = require('playwright');
(async () => {
  assert.equal((await dns.promises.lookup('app-42.localhost')).address, '127.0.0.1');
  assert.deepEqual(await dns.promises.lookup('app-42.localhost', { all: true }), [{ address: '127.0.0.1', family: 4 }]);
  await new Promise((resolve, reject) => dns.lookup('app-42.localhost', (err, address, family) => { if (err) return reject(err); assert.equal(address, '127.0.0.1'); assert.equal(family, 4); resolve(); }));
  assert.equal((await dns.promises.lookup('192.0.2.1')).address, '192.0.2.1');
  await assert.rejects(dns.promises.lookup('app-42.localhost.invalid'));
  const api = await request.newContext();
  const response = await api.get(process.env.DYAD_TEST_BASE_URL);
  assert.equal(await response.text(), 'app-42.localhost:${port}');
  await api.dispose();
})().catch(error => { console.error(error); process.exitCode = 1; });`;
    const result = await promisify(execFile)(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DYAD_TEST_BASE_URL: `http://app-42.localhost:${port}`,
        NODE_OPTIONS: previewTestNodeOptions(dir, "--no-warnings"),
      },
    });
    expect(result.stderr).toBe("");
    expect(previewTestNodeOptions(dir, "--no-warnings")).toContain(
      "--no-warnings --require",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);
