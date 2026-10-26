// Manual Electron stress probe for assistant messages with many large MCP tool
// calls. Build first with npm run build. Creates only synthetic data in a fresh
// temporary profile and retains artifacts.
//
//   MCP_STRESS_VARIANT=before node scripts/manual-tests/mcp-transcript-stress.cjs
//   MCP_STRESS_VARIANT=after  node scripts/manual-tests/mcp-transcript-stress.cjs
//
// "before" stores tool-call arguments the way the agent emitters write them
// today (full pretty-printed JSON). "after" stores them through the 128 KB
// transcript cap. Results are capped by sanitizeMcpToolResult in both.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require("playwright");
const eph = require("electron-playwright-helpers");
const repoRoot = path.resolve(__dirname, "../..");

const VARIANT = process.env.MCP_STRESS_VARIANT || "before";
const CALLS = Number(process.env.MCP_STRESS_CALLS || 20);
const ARG_BYTES = Number(process.env.MCP_STRESS_ARG_BYTES || 1024 * 1024);
const RESULT_BYTES = Number(process.env.MCP_STRESS_RESULT_BYTES || 1024 * 1024);
const EXPAND = Number(process.env.MCP_STRESS_EXPAND || 5);
const TAIL = "SYNTHETIC_MCP_STRESS_TAIL";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-mcp-stress-"));
for (const dir of [root + "/xdg", root + "/synthetic-app", root + "/profile"])
  fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(root + "/empty-gitconfig", "");
const report = {
  variant: VARIANT,
  params: { CALLS, ARG_BYTES, RESULT_BYTES, EXPAND },
  startedAt: new Date().toISOString(),
  samples: [],
  phases: [],
  errors: [],
};
const save = () =>
  fs.writeFileSync(root + "/report.json", JSON.stringify(report, null, 2));
const log = (x) => {
  console.log(JSON.stringify(x));
  save();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bounded = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, r) => {
      const t = setTimeout(() => r(new Error(label + " timed out")), ms);
      t.unref();
    }),
  ]);

function records(targetBytes, seedBase) {
  const out = [];
  let bytes = 0;
  for (let i = 0; bytes < targetBytes; i++) {
    const s = seedBase + i;
    const record = {
      objectId: "object_" + (i % 100),
      frame: Math.floor(i / 100),
      x: ((s * 17) % 192000) / 100,
      y: ((s * 31) % 108000) / 100,
      rotation: ((s * 7) % 36000) / 100,
      scale: (50 + (s % 151)) / 100,
      opacity: (s % 101) / 100,
    };
    out.push(record);
    bytes += JSON.stringify(record).length + 1;
  }
  return out;
}

async function buildMessage() {
  const { sanitizeMcpToolResult, MCP_RESULT_MAX_BYTES } = await import(
    path.join(repoRoot, "src/ipc/utils/mcp_result_sanitizer.ts")
  );
  const { escapeXmlContent } = await import(
    path.join(repoRoot, "shared/xmlEscape.ts")
  );
  // Mirrors formatMcpToolCallArgsForTranscript: keep today's pretty JSON when
  // it fits, otherwise store the sanitizer's bounded compact JSON.
  const capArgs = (args) => {
    const sanitized = sanitizeMcpToolResult(args);
    const pretty = JSON.stringify(sanitized.value, null, 2);
    const body =
      Buffer.byteLength(pretty, "utf8") <= MCP_RESULT_MAX_BYTES
        ? pretty
        : sanitized.serialized;
    return { body, truncated: sanitized.truncated };
  };
  const parts = ["Synthetic MCP stress turn.\n\n"];
  let argBytes = 0;
  let resultBytes = 0;
  for (let call = 0; call < CALLS; call++) {
    const callId = "synthetic-call-" + call;
    const args = { table: "frames", rows: records(ARG_BYTES, call * 100000) };
    let callBody;
    let truncatedAttr = "";
    if (VARIANT === "after") {
      const capped = capArgs(args);
      callBody = capped.body;
      if (capped.truncated) truncatedAttr = ' input-truncated="true"';
    } else {
      callBody = JSON.stringify(args, null, 2);
    }
    const result = sanitizeMcpToolResult({
      content: [
        {
          type: "text",
          text: JSON.stringify(records(RESULT_BYTES, call * 100000 + 50000)),
        },
      ],
    }).serialized;
    argBytes += callBody.length;
    resultBytes += result.length;
    parts.push(
      `Calling bulk_upsert batch ${call + 1}.\n\n`,
      `<dyad-mcp-tool-call server="synthetic-mcp" tool="bulk_upsert" call-id="${callId}"${truncatedAttr}>\n${escapeXmlContent(callBody)}\n</dyad-mcp-tool-call>\n`,
      `<dyad-mcp-tool-result server="synthetic-mcp" tool="bulk_upsert" call-id="${callId}">\n${escapeXmlContent(result)}\n</dyad-mcp-tool-result>\n\n`,
    );
  }
  parts.push(TAIL);
  const content = parts.join("");
  report.payload = {
    totalBytes: Buffer.byteLength(content),
    argBytes,
    resultBytes,
  };
  fs.writeFileSync(root + "/assistant-message.md", content);
}

let app;
let page;
let phase = "startup";
let sampling;
let sampleBusy = false;
async function sample() {
  if (sampleBusy || !app) return;
  sampleBusy = true;
  try {
    const metrics = await bounded(
      app.evaluate(({ app }) => app.getAppMetrics()),
      3000,
      "main metrics",
    );
    const kib = (type) =>
      metrics
        .filter((m) => m.type === type)
        .reduce((n, m) => n + m.memory.workingSetSize, 0);
    report.samples.push({
      time: Date.now(),
      phase,
      mainMiB: kib("Browser") / 1024,
      rendererMiB: kib("Tab") / 1024,
    });
  } catch (e) {
    report.errors.push({ phase, kind: "metrics", message: String(e) });
  }
  sampleBusy = false;
}

// One requestAnimationFrame round trip from the test process.
async function frameLatency(timeoutMs) {
  const started = Date.now();
  await bounded(
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    ),
    timeoutMs,
    "frame",
  );
  return Date.now() - started;
}

async function rendererHeapMiB() {
  return bounded(
    page.evaluate(() => performance.memory.usedJSHeapSize / 1048576),
    10000,
    "heap",
  );
}

// Runs `action`, then waits until three consecutive frames arrive quickly.
async function measure(name, action, { maxMs = 180000 } = {}) {
  phase = name;
  const start = Date.now();
  report.phases.push({ name, start });
  await sample();
  try {
    await bounded(action(), maxMs, name + " action");
  } catch (e) {
    report.errors.push({ phase: name, kind: "action", message: String(e) });
  }
  await sleep(500);
  let fast = 0;
  let maxFrameMs = 0;
  let settled = false;
  while (Date.now() - start < maxMs) {
    try {
      const latency = await frameLatency(5000);
      maxFrameMs = Math.max(maxFrameMs, latency);
      fast = latency < 100 ? fast + 1 : 0;
      if (fast >= 3) {
        settled = true;
        break;
      }
      await sleep(100);
    } catch {
      maxFrameMs = Math.max(maxFrameMs, 5000);
      fast = 0;
    }
  }
  const end = Date.now();
  await sample();
  const longTasks = await bounded(
    page.evaluate(
      ({ from, to }) =>
        (window.__dyadLongTasks || []).filter(
          ([s]) =>
            s >= from - performance.timeOrigin &&
            s <= to - performance.timeOrigin,
        ),
      { from: start, to: end },
    ),
    10000,
    "long tasks",
  ).catch(() => []);
  const inPhase = report.samples.filter(
    (s) => s.time >= start && s.time <= end,
  );
  const result = {
    name,
    settled,
    settleMs: end - start,
    maxFrameMs,
    longTaskCount: longTasks.length,
    longestTaskMs: Math.round(Math.max(0, ...longTasks.map(([, d]) => d))),
    longTaskTotalMs: Math.round(longTasks.reduce((n, [, d]) => n + d, 0)),
    peakRendererMiB: Math.round(
      Math.max(0, ...inPhase.map((s) => s.rendererMiB)),
    ),
    endRendererMiB: Math.round(inPhase.at(-1)?.rendererMiB ?? 0),
    heapMiB: Math.round(await rendererHeapMiB().catch(() => -1)),
  };
  (report.results ??= []).push(result);
  log({ result });
  return result;
}

async function installLongTaskObserver() {
  await page.evaluate(() => {
    window.__dyadLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.__dyadLongTasks.push([entry.startTime, entry.duration]);
    }).observe({ type: "longtask", buffered: true });
  });
}

async function navigate(url) {
  await page.evaluate((url) => {
    history.pushState({}, "", url);
    dispatchEvent(new PopStateEvent("popstate"));
  }, url);
}

async function forceGc() {
  await bounded(
    page.evaluate(() => {
      window.gc?.();
    }),
    30000,
    "gc",
  ).catch(() => {});
  await sleep(1000);
}

(async () => {
  console.log("Artifacts: " + root);
  await buildMessage();
  log({ payload: report.payload });
  fs.writeFileSync(
    root + "/profile/user-settings.json",
    JSON.stringify({
      hasRunBefore: true,
      telemetryConsent: "opted_out",
      enableAutoUpdate: false,
      autoExpandPreviewPanel: false,
      enablePnpmMinimumReleaseAgeWarning: false,
      selectedChatMode: "ask",
      selectedModel: { name: "synthetic", provider: "openai" },
      providerSettings: {},
    }),
  );
  const info = eph.parseElectronApp(
    eph.findLatestBuild(path.join(repoRoot, "out")),
  );
  app = await _electron.launch({
    executablePath: info.executable,
    args: [
      info.main,
      "--user-data-dir=" + root + "/profile",
      "--js-flags=--expose-gc",
      "--enable-precise-memory-info",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--no-first-run",
      "--proxy-server=http://127.0.0.1:9",
      "--proxy-bypass-list=<-loopback>",
      "--host-resolver-rules=MAP * ~NOTFOUND",
    ],
    env: {
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      E2E_TEST_BUILD: "true",
      NODE_ENV: "production",
      // Dummy value only: bypass provider setup without a usable credential.
      OPENAI_API_KEY: "sk-test-synthetic-no-network",
      XDG_CONFIG_HOME: root + "/xdg",
      GIT_CONFIG_GLOBAL: root + "/empty-gitconfig",
      DYAD_ENGINE_URL: "http://127.0.0.1:9",
      DYAD_GATEWAY_URL: "http://127.0.0.1:9",
      DYAD_DEFAULT_APPROVE_BUILDS_URL: "http://127.0.0.1:9",
      OLLAMA_HOST: "http://127.0.0.1:9",
      LM_STUDIO_BASE_URL_FOR_TESTING: "http://127.0.0.1:9",
    },
    timeout: 60000,
  });
  for (const stream of [app.process().stdout, app.process().stderr])
    stream?.on("data", (d) => fs.appendFileSync(root + "/electron.log", d));
  await app.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (details, callback) => callback({ cancel: true }),
    );
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("crash", () => {
    report.errors.push({ kind: "renderer-crash", phase });
    log({ renderer: "crashed", phase });
  });
  await page.waitForLoadState("domcontentloaded");
  const initialUrl = page.url();
  const seed = await app.evaluate(async ({ app }, root) => {
    const require = process.mainModule.require.bind(process.mainModule);
    const Database = require(app.getAppPath() + "/node_modules/better-sqlite3");
    const db = new Database(
      require("node:path").join(app.getPath("userData"), "sqlite.db"),
    );
    const appId = Number(
      db
        .prepare("INSERT INTO apps (name,path) VALUES (?,?)")
        .run("MCP Stress Test", root + "/synthetic-app").lastInsertRowid,
    );
    const insertChat = db.prepare(
      "INSERT INTO chats (app_id,title,chat_mode) VALUES (?,?,?)",
    );
    const insertMessage = db.prepare(
      "INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)",
    );
    const chatId = Number(
      insertChat.run(appId, "Synthetic MCP Stress", "ask").lastInsertRowid,
    );
    insertMessage.run(chatId, "user", "Upsert the synthetic frames.");
    const messageId = Number(
      insertMessage.run(chatId, "assistant", "Synthetic baseline message.")
        .lastInsertRowid,
    );
    const otherChatId = Number(
      insertChat.run(appId, "Other chat", "ask").lastInsertRowid,
    );
    insertMessage.run(otherChatId, "user", "Hello.");
    insertMessage.run(otherChatId, "assistant", "Other chat message.");
    db.close();
    return { appId, chatId, otherChatId, messageId };
  }, root);
  report.seed = seed;
  const chatUrl = `/chat?id=${seed.chatId}&appId=${seed.appId}`;
  const otherUrl = `/chat?id=${seed.otherChatId}&appId=${seed.appId}`;
  await navigate(chatUrl);
  await page
    .getByText("Synthetic baseline message.", { exact: true })
    .waitFor({ timeout: 30000 });
  sampling = setInterval(() => sample(), 1000);
  phase = "baseline";
  await sleep(5000);
  await forceGc();
  await sample();
  report.baseline = {
    rendererMiB: Math.round(report.samples.at(-1)?.rendererMiB ?? 0),
    heapMiB: Math.round(await rendererHeapMiB()),
  };
  log({ baseline: report.baseline });

  await app.evaluate(
    async ({ app }, { root, messageId }) => {
      const require = process.mainModule.require.bind(process.mainModule);
      const Database = require(
        app.getAppPath() + "/node_modules/better-sqlite3",
      );
      const db = new Database(
        require("node:path").join(app.getPath("userData"), "sqlite.db"),
      );
      db.prepare("UPDATE messages SET content=? WHERE id=?").run(
        require("node:fs").readFileSync(root + "/assistant-message.md", "utf8"),
        messageId,
      );
      db.close();
    },
    { root, messageId: seed.messageId },
  );
  await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
  await installLongTaskObserver();

  await measure("load", async () => {
    await navigate(chatUrl);
    await page.getByText(TAIL).waitFor({ timeout: 170000 });
  });

  for (let i = 0; i < EXPAND; i++) {
    await measure("expand-" + (i + 1), () =>
      page.evaluate((i) => {
        const cards = [
          ...document.querySelectorAll('[role="button"][aria-expanded]'),
        ].filter((card) => card.textContent.includes("bulk_upsert"));
        cards[i].click();
      }, i),
    );
  }

  await measure("navigate-away", () => navigate(otherUrl));
  await forceGc();
  await sample();
  report.afterNavigateAway = {
    rendererMiB: Math.round(report.samples.at(-1)?.rendererMiB ?? 0),
    heapMiB: Math.round(await rendererHeapMiB().catch(() => -1)),
  };
  log({ afterNavigateAway: report.afterNavigateAway });
  await measure("navigate-back", async () => {
    await navigate(chatUrl);
    await page.getByText(TAIL).waitFor({ timeout: 170000 });
  });

  await app.evaluate(async ({ BrowserWindow }, dest) => {
    const require = process.mainModule.require.bind(process.mainModule);
    const w = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    require("node:fs").writeFileSync(
      dest,
      (await w.webContents.capturePage()).toPNG(),
    );
  }, root + "/final.png");
  report.finishedAt = new Date().toISOString();
  log({ finished: true });
})()
  .catch((e) => {
    report.errors.push({
      kind: "fatal",
      phase,
      message: String(e),
      stack: e.stack,
    });
    log({ fatal: String(e), phase });
    process.exitCode = 1;
  })
  .finally(async () => {
    clearInterval(sampling);
    save();
    if (app) {
      await bounded(app.close(), 10000, "close").catch(() => {
        app.process().kill("SIGKILL");
      });
    }
  });
