// Manual Electron stress probe. Build first with npm run build.
// Creates only synthetic data in a fresh temporary profile and retains artifacts.
// This can make the test renderer unresponsive and consume several GiB of RAM.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require("playwright");
const eph = require("electron-playwright-helpers");
const repoRoot = path.resolve(__dirname, "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-transcript-stress-"));
const dataRoot = root;
for (const dir of [root, root + "/xdg", root + "/synthetic-app"])
  fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(root + "/empty-gitconfig", "");
const report = {
  startedAt: new Date().toISOString(),
  samples: [],
  phases: [],
  errors: [],
};
const log = (x) => {
  console.log(JSON.stringify(x));
  fs.writeFileSync(root + "/report.json", JSON.stringify(report, null, 2));
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
let app,
  page,
  sampling,
  phase = "startup",
  busy = false;
async function sample() {
  if (busy || !app) return;
  busy = true;
  try {
    const data = await bounded(
      app.evaluate(({ app }) => ({
        metrics: app.getAppMetrics(),
        memory: process.memoryUsage(),
      })),
      3000,
      "main metrics",
    );
    report.samples.push({ time: Date.now(), phase, ...data });
    fs.writeFileSync(root + "/report.json", JSON.stringify(report, null, 2));
  } catch (e) {
    report.errors.push({ phase, kind: "metrics", message: String(e) });
  }
  busy = false;
}
async function mark(name) {
  phase = name;
  report.phases.push({ name, time: Date.now() });
  await sample();
  log({ phase: name });
}
async function rendererProbe(label) {
  const start = Date.now();
  try {
    const data = await bounded(
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              resolve({
                nodes: document.getElementsByTagName("*").length,
                visibleTextLength: document.body.innerText.length,
                heap: performance.memory
                  ? {
                      used: performance.memory.usedJSHeapSize,
                      total: performance.memory.totalJSHeapSize,
                      limit: performance.memory.jsHeapSizeLimit,
                    }
                  : null,
                hasTail: document.body.innerText.includes(
                  "SYNTHETIC_STRESS_TAIL",
                ),
              }),
            ),
          ),
      ),
      10000,
      "renderer probe",
    );
    const result = { label, elapsedMs: Date.now() - start, ...data };
    (report.probes ??= []).push(result);
    log({ probe: result });
  } catch (e) {
    report.errors.push({ label, message: String(e) });
    log({ probe: label, error: String(e) });
  }
}

// Match the synthetic numeric JSON used for the recorded macOS run.
function generateRecords() {
  const float = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  for (let fileIndex = 0; fileIndex < 100; fileIndex++) {
    const records = [];
    let bytes = 3,
      recordIndex = 0;
    while (bytes < 250000) {
      const seed = fileIndex * 10000 + recordIndex;
      const record =
        JSON.stringify({
          objectId: "object_" + (recordIndex % 100),
          frame: Math.floor(recordIndex / 100),
        }).slice(0, -1) +
        ',"x":' +
        float(((seed * 17) % 192000) / 100) +
        ',"y":' +
        float(((seed * 31) % 108000) / 100) +
        ',"rotation":' +
        float(((seed * 7) % 36000) / 100) +
        ',"scale":' +
        float((50 + (seed % 151)) / 100) +
        ',"opacity":' +
        float((seed % 101) / 100) +
        "}";
      records.push(record);
      bytes += record.length + 2;
      recordIndex++;
    }
    fs.writeFileSync(
      path.join(
        root,
        "transcript-" + String(fileIndex + 1).padStart(3, "0") + ".json",
      ),
      "[\n" + records.join(",\n") + "\n]\n",
      { flag: "wx" },
    );
  }
}

(async () => {
  console.log("Artifacts: " + root);
  generateRecords();
  fs.mkdirSync(root + "/profile-run2", { recursive: true });
  const parts = [];
  for (let i = 1; i <= 100; i++)
    parts.push(
      fs
        .readFileSync(
          dataRoot + `/transcript-${String(i).padStart(3, "0")}.json`,
          "utf8",
        )
        .trim()
        .slice(1, -1)
        .trim(),
    );
  const content =
    "Synthetic animation records.\n\n```json\n[\n" +
    parts.join(",\n") +
    "\n]\n```\n\nSYNTHETIC_STRESS_TAIL";
  fs.writeFileSync(root + "/assistant-message.md", content);
  report.payloadBytes = Buffer.byteLength(content);
  report.recordCount = parts.reduce(
    (n, s) => n + (s.match(/"objectId"/g) || []).length,
    0,
  );
  fs.writeFileSync(
    root + "/profile-run2/user-settings.json",
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
  report.build = { executable: info.executable, main: info.main };
  app = await _electron.launch({
    executablePath: info.executable,
    args: [
      info.main,
      "--user-data-dir=" + root + "/profile-run2",
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
  app
    .process()
    .stdout?.on("data", (d) => fs.appendFileSync(root + "/electron.log", d));
  app
    .process()
    .stderr?.on("data", (d) => fs.appendFileSync(root + "/electron.log", d));
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
  page.on("pageerror", (e) => {
    report.errors.push({ kind: "pageerror", phase, message: String(e) });
  });
  await page.waitForLoadState("domcontentloaded");
  report.initialUrl = page.url();
  const seed = await app.evaluate(async ({ app }, root) => {
    const require = process.mainModule.require.bind(process.mainModule);
    const Database = require(app.getAppPath() + "/node_modules/better-sqlite3");
    const db = new Database(
      require("node:path").join(app.getPath("userData"), "sqlite.db"),
    );
    const appId = Number(
      db
        .prepare("INSERT INTO apps (name,path) VALUES (?,?)")
        .run("Transcript Stress Test", root + "/synthetic-app").lastInsertRowid,
    );
    const chatId = Number(
      db
        .prepare("INSERT INTO chats (app_id,title,chat_mode) VALUES (?,?,?)")
        .run(appId, "Synthetic Memory Stress", "ask").lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)",
    ).run(chatId, "user", "Display synthetic animation records.");
    const messageId = Number(
      db
        .prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)")
        .run(chatId, "assistant", "Synthetic baseline assistant message.")
        .lastInsertRowid,
    );
    db.close();
    return { appId, chatId, messageId, userData: app.getPath("userData") };
  }, root);
  report.seed = seed;
  log({ seed });
  // TanStack uses browser history; preserve the file entry and add the chat route in its hash only if configured that way.
  await page.evaluate(({ chatId, appId }) => {
    history.pushState({}, "", `/chat?id=${chatId}&appId=${appId}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, seed);
  await page
    .getByTestId("messages-list")
    .waitFor({ state: "visible", timeout: 30000 });
  await page
    .getByText("Synthetic baseline assistant message.", { exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByText("Start free Dyad Pro trial", { exact: true })
    .waitFor({ state: "hidden", timeout: 15000 });
  sampling = setInterval(() => sample(), 1000);
  await mark("baseline");
  await sleep(5000);
  await rendererProbe("baseline");

  const windowInfo = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    w.show();
    w.focus();
    return { sourceId: w.getMediaSourceId(), bounds: w.getBounds() };
  });
  report.windowInfo = windowInfo;
  async function capture(name, seconds) {
    const started = Date.now();
    try {
      await bounded(
        app.evaluate(
          async ({ BrowserWindow }, dest) => {
            const require = process.mainModule.require.bind(process.mainModule);
            const w = BrowserWindow.getAllWindows().find((w) => w.isVisible());
            const image = await w.webContents.capturePage();
            require("node:fs").writeFileSync(dest, image.toPNG());
          },
          root + "/" + name + ".png",
        ),
        8000,
        "window capture",
      );
      const result = {
        name,
        seconds,
        actualElapsedMs: report.loadStart ? started - report.loadStart : null,
        captureMs: Date.now() - started,
        bytes: fs.statSync(root + "/" + name + ".png").size,
      };
      (report.captures ??= []).push(result);
      log({ capture: result });
    } catch (e) {
      report.errors.push({ kind: "screenshot", name, message: String(e) });
      log({ screenshotError: String(e), name });
      throw e;
    }
  }
  await capture("00-baseline", 0);
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
  await bounded(
    page.goto(report.initialUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }),
    35000,
    "reload entry",
  );
  await mark("loading-25MB");
  report.loadStart = Date.now();
  void page
    .evaluate(({ chatId, appId }) => {
      history.pushState({}, "", `/chat?id=${chatId}&appId=${appId}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, seed)
    .then(() => {
      report.navigationReturnedMs = Date.now() - report.loadStart;
    })
    .catch((e) => {
      report.errors.push({ kind: "navigation", message: String(e) });
    });
  let probeBusy = false;
  const probes = setInterval(() => {
    if (probeBusy) return;
    probeBusy = true;
    const started = Date.now();
    bounded(
      page.evaluate(() => ({
        nodes: document.getElementsByTagName("*").length,
        messagesListPresent: !!document.querySelector(
          '[data-testid="messages-list"]',
        ),
        heap: performance.memory?.usedJSHeapSize,
      })),
      2000,
      "renderer heartbeat",
    )
      .then((data) => {
        (report.heartbeats ??= []).push({
          elapsedMs: Date.now() - report.loadStart,
          latencyMs: Date.now() - started,
          ...data,
        });
      })
      .catch((e) => {
        (report.heartbeats ??= []).push({
          elapsedMs: Date.now() - report.loadStart,
          error: String(e),
        });
      })
      .finally(() => {
        probeBusy = false;
      });
  }, 10000);
  try {
    for (let seconds = 10; seconds <= 120; seconds += 10) {
      await sleep(Math.max(0, report.loadStart + seconds * 1000 - Date.now()));
      await capture(String(seconds).padStart(3, "0") + "s", seconds);
    }
  } finally {
    clearInterval(probes);
  }
  report.finishedAt = new Date().toISOString();
  await sample();
  log({ finished: true, screenshots: report.captures.length });
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
    fs.writeFileSync(root + "/report.json", JSON.stringify(report, null, 2));
    if (app) {
      await bounded(app.close(), 10000, "close").catch(() => {
        app.process().kill("SIGKILL");
      });
    }
  });
