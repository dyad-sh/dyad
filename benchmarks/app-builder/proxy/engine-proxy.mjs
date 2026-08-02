// Engine recording proxy for the app-builder benchmark.
//
// Forwards every request to the Dyad engine (streaming pass-through) and
// records one JSONL row per /chat/completions request with exact token usage
// parsed from the final SSE usage chunk, correlated to Dyad chat turns via the
// X-Dyad-Request-Id header. Also serves the pinned language-model catalog at
// /catalog so runs are deterministic (point DYAD_LANGUAGE_MODEL_CATALOG_URL
// here).
//
// Usage:
//   node engine-proxy.mjs [--port 7789] [--upstream https://engine.dyad.sh/v1] \
//     [--out <dir>] [--cell <cellId>]
// Env: APPBENCH_CELL_CEILING_USD (abort cell when estimated spend exceeds it)
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
function argOf(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
}
const PORT = Number(argOf("--port", "7789"));
const UPSTREAM = new URL(argOf("--upstream", "https://engine.dyad.sh/v1"));
const OUT_DIR = argOf("--out", path.join(__dirname, "logs"));
const CELL_ID = argOf("--cell", "adhoc");
const CEILING = Number(process.env.APPBENCH_CELL_CEILING_USD || "0") || null;

const CATALOG_PATH = path.join(
  __dirname,
  "..",
  "catalog",
  "catalog-2026-07-28.json",
);
const PRICING_PATH = path.join(__dirname, "..", "pricing", "pricing.json");
const pricing = fs.existsSync(PRICING_PATH)
  ? JSON.parse(fs.readFileSync(PRICING_PATH, "utf8"))
  : null;

fs.mkdirSync(OUT_DIR, { recursive: true });
const logPath = path.join(OUT_DIR, `requests-${CELL_ID}.jsonl`);
let spentUsd = 0;

function priceOf(model, usage) {
  if (!pricing?.models) return null;
  const key = Object.keys(pricing.models).find((k) => model?.includes(k));
  if (!key) return null;
  const p = pricing.models[key];
  const cached = usage.cachedTokens ?? 0;
  const writes = usage.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, (usage.promptTokens ?? 0) - cached - writes);
  const tier =
    p.tiers && (usage.promptTokens ?? 0) >= p.tiers.threshold ? p.tiers : p;
  // Cache writes bill at the provider's write rate when published (Anthropic
  // 1.25x input for 5-min TTL); otherwise at the plain input rate.
  const writeRate = p.cacheWrite ?? tier.input;
  return (
    (uncached * tier.input + cached * tier.cachedInput + writes * writeRate) /
      1e6 +
    ((usage.completionTokens ?? 0) * tier.output) / 1e6
  );
}

function record(row) {
  fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`);
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if (req.url === "/catalog") {
    res.writeHead(200, { "content-type": "application/json" });
    fs.createReadStream(CATALOG_PATH).pipe(res);
    return;
  }
  if (req.url === "/__spend") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ cellId: CELL_ID, spentUsd }));
    return;
  }
  if (CEILING && spentUsd >= CEILING) {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: `appbench budget_abort: cell ceiling $${CEILING} reached (spent $${spentUsd.toFixed(2)})`,
          type: "appbench_budget_abort",
        },
      }),
    );
    return;
  }

  const startedAt = Date.now();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = Buffer.concat(chunks);
    // Effort override for the reasoning-effort sweep. Dyad's settings expose
    // only low/medium/high (thinkingBudget), but the engine accepts xhigh, so
    // the sweep applies effort here instead of patching the product. Disclosed
    // in the report: these runs do NOT use the product default.
    const forcedEffort = process.env.APPBENCH_EFFORT || null;
    if (forcedEffort && body.length) {
      try {
        const parsed = JSON.parse(body.toString("utf8"));
        if (req.url.includes("/responses")) {
          parsed.reasoning = {
            ...(parsed.reasoning || {}),
            effort: forcedEffort,
          };
        } else {
          parsed.reasoning_effort = forcedEffort;
        }
        body = Buffer.from(JSON.stringify(parsed));
      } catch {
        /* non-JSON bodies pass through untouched */
      }
    }
    let requestMeta = {};
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      requestMeta = {
        model: parsed.model,
        stream: parsed.stream,
        messageCount: parsed.messages?.length,
        toolCount: parsed.tools?.length,
        // Reasoning-effort disclosure (design §2): capture whichever field the
        // provider path uses so runs prove the effort tier actually sent.
        effort:
          parsed.reasoning?.effort ??
          parsed.reasoning_effort ??
          parsed.effort ??
          parsed.output_config?.effort ??
          (parsed.thinking
            ? `thinking:${parsed.thinking.type ?? "on"}`
            : undefined),
      };
    } catch {
      /* non-JSON bodies pass through unrecorded */
    }

    const upstreamPath =
      UPSTREAM.pathname.replace(/\/$/, "") + (req.url === "/" ? "" : req.url);
    const headers = { ...req.headers, host: UPSTREAM.host };
    delete headers["content-length"];
    headers["content-length"] = Buffer.byteLength(body);

    const upstreamReq = (UPSTREAM.protocol === "https:" ? https : http).request(
      {
        hostname: UPSTREAM.hostname,
        port: UPSTREAM.port || (UPSTREAM.protocol === "https:" ? 443 : 80),
        path: upstreamPath,
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        let tail = "";
        let firstByteAt = null;
        upstreamRes.on("data", (chunk) => {
          if (firstByteAt === null) firstByteAt = Date.now();
          // Keep a rolling tail large enough to hold the final SSE usage
          // event — Responses API `response.completed` embeds the full
          // response object, which can be large.
          tail = (tail + chunk.toString("utf8")).slice(-1048576);
          res.write(chunk);
        });
        upstreamRes.on("end", () => {
          res.end();
          const usage = extractUsage(tail);
          const cost = usage ? priceOf(requestMeta.model, usage) : null;
          if (cost) spentUsd += cost;
          record({
            ts: new Date(startedAt).toISOString(),
            cellId: CELL_ID,
            dyadRequestId: req.headers["x-dyad-request-id"] ?? null,
            path: req.url,
            status: upstreamRes.statusCode,
            ...requestMeta,
            usage,
            estimatedUsd: cost,
            requestBytes: body.length,
            ttfbMs: firstByteAt ? firstByteAt - startedAt : null,
            durationMs: Date.now() - startedAt,
          });
        });
      },
    );
    upstreamReq.on("error", (err) => {
      record({
        ts: new Date(startedAt).toISOString(),
        cellId: CELL_ID,
        dyadRequestId: req.headers["x-dyad-request-id"] ?? null,
        path: req.url,
        ...requestMeta,
        error: clientGone ? "client_abort" : String(err),
        requestBytes: body.length,
        durationMs: Date.now() - startedAt,
      });
      if (!clientGone && !res.headersSent) res.writeHead(502);
      if (!clientGone) {
        res.end(JSON.stringify({ error: { message: `proxy: ${err}` } }));
      }
    });
    // Propagate client aborts upstream. Without this, an aborted request
    // keeps running server-side; with per-key serialization at the engine,
    // each leaked request blocks every retry behind it — one slow response
    // then cascades into repeated exactly-300s (undici headersTimeout)
    // stalls. Observed live in the first S-CELL run.
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone = true;
        upstreamReq.destroy(new Error("client_abort"));
      }
    });
    upstreamReq.end(body);
  });
});

// Parse the last usage block out of the SSE stream tail (or a JSON body).
// Handles all three wire formats the engine serves:
//   - OpenAI chat completions: usage.prompt_tokens/completion_tokens
//     (+ prompt_tokens_details.cached_tokens)
//   - OpenAI Responses API (local-agent openai path): response.completed ->
//     response.usage.input_tokens/output_tokens
//     (+ input_tokens_details.cached_tokens)
//   - Anthropic messages (local-agent anthropic path): message_start carries
//     input-side usage (input_tokens, cache_read/creation_input_tokens),
//     message_delta carries output_tokens — merged across events.
function extractUsage(text) {
  let usage = null;
  let anthroIn = null;
  let anthroOut = null;
  const consider = (u) => {
    if (!u) return;
    if (u.prompt_tokens != null || u.completion_tokens != null) {
      usage = {
        promptTokens: u.prompt_tokens ?? null,
        completionTokens: u.completion_tokens ?? null,
        totalTokens: u.total_tokens ?? null,
        cachedTokens: u.prompt_tokens_details?.cached_tokens ?? null,
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? null,
        raw: u,
      };
    } else if (u.input_tokens != null || u.output_tokens != null) {
      usage = {
        promptTokens: u.input_tokens ?? null,
        completionTokens: u.output_tokens ?? null,
        totalTokens:
          u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
        cachedTokens:
          u.input_tokens_details?.cached_tokens ??
          u.cache_read_input_tokens ??
          null,
        reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? null,
        raw: u,
      };
    }
  };
  for (const line of text.split("\n")) {
    const payload = line.startsWith("data:")
      ? line.slice(5).trim()
      : line.trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      if (obj.type === "message_start" && obj.message?.usage) {
        anthroIn = obj.message.usage;
        continue;
      }
      if (obj.type === "message_delta" && obj.usage) {
        anthroOut = obj.usage;
        continue;
      }
      consider(obj.response?.usage ?? obj.usage);
    } catch {
      /* partial chunk fragments are expected in the tail */
    }
  }
  if (!usage && (anthroIn || anthroOut)) {
    const inU = anthroIn ?? {};
    const outU = anthroOut ?? {};
    const inputTokens =
      (inU.input_tokens ?? 0) +
      (inU.cache_read_input_tokens ?? 0) +
      (inU.cache_creation_input_tokens ?? 0);
    usage = {
      promptTokens: inputTokens,
      completionTokens: outU.output_tokens ?? inU.output_tokens ?? null,
      totalTokens: inputTokens + (outU.output_tokens ?? 0),
      cachedTokens: inU.cache_read_input_tokens ?? null,
      cacheWriteTokens: inU.cache_creation_input_tokens ?? null,
      reasoningTokens: null,
      raw: { message_start: anthroIn, message_delta: anthroOut },
    };
  }
  return usage;
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[engine-proxy] :${PORT} -> ${UPSTREAM.href} | cell=${CELL_ID} | log=${logPath}${CEILING ? ` | ceiling=$${CEILING}` : ""}`,
  );
});
