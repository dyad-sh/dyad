import { StringDecoder } from "node:string_decoder";
import {
  priceOf as computePrice,
  createUsageCollector,
} from "./accounting.mjs";
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
  // Pinned for determinism. A model ABSENT from the pin resolves to no
  // maxOutputTokens, and the AI SDK Anthropic provider then defaults to 4096 —
  // which silently truncated every large write for claude-fable-5-1 and made
  // it "implement nothing after milestone 1". Newer models need a newer pin:
  // APPBENCH_CATALOG selects one; run-cell refuses a model the pin lacks.
  process.env.APPBENCH_CATALOG || "catalog-2026-07-28.json",
);
const PRICING_PATH = path.join(__dirname, "..", "pricing", "pricing.json");
const pricing = fs.existsSync(PRICING_PATH)
  ? JSON.parse(fs.readFileSync(PRICING_PATH, "utf8"))
  : null;

fs.mkdirSync(OUT_DIR, { recursive: true });
const logPath = path.join(OUT_DIR, `requests-${CELL_ID}.jsonl`);
let spentUsd = 0;

function priceOf(model, usage) {
  return computePrice(model, usage, pricing);
}

function record(row) {
  fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`);
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    // Reports the proxy's effort override so run-cell can verify it. The
    // override only fires from THIS process's env: in external-services mode
    // the driver, not run-cell, starts the proxy — one driver forgot to pass
    // APPBENCH_EFFORT and an entire "xhigh" arm silently ran at the product
    // default, distinguishable only by reading the request ledger afterwards.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ ok: true, effort: process.env.APPBENCH_EFFORT || null }),
    );
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
        if (parsed.thinking && /^gemini\//.test(parsed.model || "")) {
          // Gemini through the engine (LiteLLM) takes a thinking BUDGET, not
          // reasoning_effort. Mirror Dyad's own thinkingBudget setting mapping
          // (thinking_utils.getGeminiThinkingBudgetTokens: medium=4000,
          // high=-1 dynamic) so a forced tier is exactly what the product
          // sends at that setting. Tiers Dyad has no budget for are refused
          // loudly rather than silently running at the default.
          const budget = { minimal: 0, low: 1000, medium: 4000, high: -1 }[
            forcedEffort
          ];
          if (budget === undefined) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                error: `engine-proxy: no Gemini thinking budget for effort '${forcedEffort}'`,
              }),
            );
            return;
          }
          parsed.thinking = { ...parsed.thinking, budget_tokens: budget };
        } else if (req.url.includes("/responses")) {
          parsed.reasoning = {
            ...parsed.reasoning,
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
        // Output-cap disclosure: a model whose responses stop at exactly 4096
        // tokens is being capped somewhere; recording what the CLIENT asked
        // for separates a client-side resolution miss from a server clamp.
        maxTokens:
          parsed.max_tokens ??
          parsed.max_output_tokens ??
          parsed.max_completion_tokens ??
          undefined,
        // Reasoning-effort disclosure (design §2): capture whichever field the
        // provider path uses so runs prove the effort tier actually sent.
        effort:
          parsed.reasoning?.effort ??
          parsed.reasoning_effort ??
          parsed.effort ??
          parsed.output_config?.effort ??
          (parsed.thinking
            ? `thinking:${parsed.thinking.type ?? "on"}` +
              (parsed.thinking.budget_tokens !== undefined
                ? `:budget=${parsed.thinking.budget_tokens}`
                : "")
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
        const usageCollector = createUsageCollector();
        const decoder = new StringDecoder("utf8");
        let firstByteAt = null;
        upstreamRes.on("data", (chunk) => {
          if (firstByteAt === null) firstByteAt = Date.now();
          usageCollector.push(decoder.write(chunk));
          res.write(chunk);
        });
        upstreamRes.on("end", () => {
          res.end();
          usageCollector.push(decoder.end());
          const usage = usageCollector.finish();
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
server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[engine-proxy] :${PORT} -> ${UPSTREAM.href} | cell=${CELL_ID} | log=${logPath}${CEILING ? ` | ceiling=$${CEILING}` : ""}`,
  );
});
