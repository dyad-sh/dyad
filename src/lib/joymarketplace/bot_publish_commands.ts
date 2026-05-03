/**
 * Bot publish-command helpers.
 *
 * Shared by Telegram and Discord handlers so the slash-command parsing
 * and outcome-formatting logic only lives in one place.
 *
 * Commands handled:
 *   /publish_agent <id>            -> live on-chain publish via orchestrator
 *   /publish_dryrun_agent <id>     -> pin + mint encode + gas estimate, no tx
 *   /publish_help                  -> short usage card
 *
 * The handler imports `publishAgentToMarketplace` from the agent marketplace
 * IPC handler module so we share the exact same code path the renderer uses.
 * That function already calls through `PublishOrchestrator.publishAndForget`,
 * which never throws — every failure is reported via the returned
 * `PublishOutcome`.
 */

import log from "electron-log";

import { publishAgentToMarketplace } from "@/ipc/handlers/agent_marketplace_handlers";
import type { PublishOutcome } from "@/lib/joymarketplace/publish_orchestrator";

const logger = log.scope("bot_publish_commands");

export interface PublishCommandMatch {
  command: "publish" | "dryrun" | "help";
  agentId?: number;
  raw: string;
}

/**
 * Detect a publish-related slash command in inbound text. Returns null when
 * the message is not a publish command so callers can fall through to the
 * regular AI router.
 */
export function detectPublishCommand(text: string | undefined | null): PublishCommandMatch | null {
  if (!text) return null;
  const trimmed = text.trim();

  // /publish_help
  if (/^\/publish_help\b/i.test(trimmed)) {
    return { command: "help", raw: trimmed };
  }

  // /publish_dryrun_agent <id>
  const dryRun = trimmed.match(/^\/publish_dryrun_agent\s+(\d+)\b/i);
  if (dryRun) {
    return { command: "dryrun", agentId: Number(dryRun[1]), raw: trimmed };
  }

  // /publish_agent <id>
  const live = trimmed.match(/^\/publish_agent\s+(\d+)\b/i);
  if (live) {
    return { command: "publish", agentId: Number(live[1]), raw: trimmed };
  }

  return null;
}

const HELP_CARD = [
  "📦 *Publish commands*",
  "",
  "/publish_dryrun_agent <id> — pin metadata, simulate mint, report gas. No tx sent.",
  "/publish_agent <id> — live on-chain publish (DropERC1155 lazy mint + claim conditions).",
  "/publish_help — show this card.",
  "",
  "Live publishing requires a chain-key in the JCN key manager and a .joy domain on that wallet.",
  "If either is missing, the dry-run still works and the live command will report blockedAt.",
].join("\n");

/**
 * Format a PublishOutcome into a chat-friendly string. Plain text — Telegram
 * and Discord both render it cleanly; Markdown features (`*bold*`, code
 * fences) are kept to a minimum so it works in both clients.
 */
export function formatPublishOutcome(o: PublishOutcome & { agentId?: number }): string {
  const id = o.agentId !== undefined ? `agent ${o.agentId}` : "agent";
  if (o.ok && o.dryRun) {
    const lines = [
      `✅ DRY-RUN OK for ${id}`,
      o.contentCid ? `  contentCid: ${o.contentCid}` : null,
      o.metadataCid ? `  metadataCid: ${o.metadataCid}` : null,
      o.metadataUri ? `  metadataUri: ${o.metadataUri}` : null,
      o.estimatedGas?.mint ? `  est. mint gas: ${o.estimatedGas.mint}` : null,
      o.estimatedGas?.listing ? `  est. list gas: ${o.estimatedGas.listing}` : null,
      "  (no tx sent)",
    ].filter(Boolean);
    if (o.errors?.length) {
      lines.push("  notes:");
      for (const e of o.errors) lines.push(`    • ${e}`);
    }
    return lines.join("\n");
  }
  if (o.ok) {
    const lines = [
      `🚀 PUBLISHED ${id}`,
      o.tokenId ? `  tokenId: ${o.tokenId}` : null,
      o.listingId ? `  listingId: ${o.listingId}` : null,
      o.mintTxHash ? `  mintTx: ${o.mintTxHash}` : null,
      o.listTxHash ? `  listTx: ${o.listTxHash}` : null,
      o.marketplaceUrl ? `  url: ${o.marketplaceUrl}` : null,
      o.goldskyIndexed === true
        ? "  goldsky: indexed ✅"
        : o.goldskyIndexed === false
          ? "  goldsky: not yet indexed (will appear shortly)"
          : null,
    ].filter(Boolean);
    return lines.join("\n");
  }
  // failure
  const lines = [`❌ Publish blocked for ${id}`];
  if (o.blockedAt) lines.push(`  step: ${o.blockedAt}`);
  if (o.errors?.length) {
    for (const e of o.errors) lines.push(`  • ${e}`);
  }
  if (o.blockedAt === "no-signer") {
    lines.push("  Fix: import a chain key (jcn:key:import) or generate one (jcn:key:generate).");
  }
  if (o.blockedAt === "no-gate") {
    lines.push("  Fix: the signing wallet must own a .joy domain (creatorGate requirement).");
  }
  return lines.join("\n");
}

/**
 * Run a detected publish command. Always resolves with a chat-ready string,
 * never throws. Caller is expected to send the returned text back to the
 * channel.
 */
export async function runPublishCommand(match: PublishCommandMatch): Promise<string> {
  if (match.command === "help") {
    return HELP_CARD;
  }
  if (match.agentId === undefined || Number.isNaN(match.agentId)) {
    return "Usage: /publish_agent <agent-id>  or  /publish_dryrun_agent <agent-id>";
  }
  const dryRun = match.command === "dryrun";
  try {
    logger.info(`Bot publish command: ${match.command} agent=${match.agentId}`);
    const outcome = await publishAgentToMarketplace({
      agentId: match.agentId,
      dryRun,
    });
    return formatPublishOutcome(outcome);
  } catch (err) {
    // publishAgentToMarketplace shouldn't throw, but defend in depth.
    logger.error("Bot publish command threw unexpectedly:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ Internal error running ${match.command} for agent ${match.agentId}: ${msg}`;
  }
}
