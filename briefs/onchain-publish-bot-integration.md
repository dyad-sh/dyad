# Onchain Publish — Bot Integration Brief

Status: **deferred from feat/onchain-publish-orchestrator** (the rest of that
branch's deliverables landed; this is the residual follow-up).

## Goal

Add `/publish_agent <id>` and `/publish_dryrun_agent <id>` slash commands to the
Telegram and Discord bots so an operator can fire-and-forget a publish from a
chat client.

## What's already in place

- `src/ipc/handlers/agent_marketplace_handlers.ts` exports a callable
  `publishAgentToMarketplace({ agentId, dryRun, priceUsdc, royaltyBps, category })`
  function. **The bots should call this directly** rather than going through
  `ipcMain` — same process, no IPC round-trip needed.
- `PublishOrchestrator.publishAndForget` never throws; it returns a
  `PublishOutcome` with `ok / blockedAt / errors` so the bot reply is just a
  formatting concern.

## Suggested wiring

### Telegram (`src/lib/telegram_bot_service.ts`)

The service emits `"message-received"` with the parsed update. The slash-command
parsing today happens at the IPC handler / service level. Add to the
`message-received` listener (or in `telegram_handlers.ts`):

```ts
import { publishAgentToMarketplace } from "@/ipc/handlers/agent_marketplace_handlers";

telegramBotService.on("message-received", async (msg) => {
  const text = msg.text ?? "";
  const dryRunMatch = text.match(/^\/publish_dryrun_agent\s+(\d+)/);
  const liveMatch   = text.match(/^\/publish_agent\s+(\d+)/);
  if (!dryRunMatch && !liveMatch) return;
  const agentId = Number((dryRunMatch ?? liveMatch)![1]);
  await telegramBotService.sendMessage(msg.chat.id, `Publishing agent ${agentId}…`);
  const outcome = await publishAgentToMarketplace({
    agentId,
    dryRun: Boolean(dryRunMatch),
  });
  await telegramBotService.sendMessage(msg.chat.id, formatOutcome(outcome));
});

function formatOutcome(o: { ok: boolean; dryRun: boolean; tokenId?: string;
                            listingId?: string; marketplaceUrl?: string;
                            blockedAt?: string; errors?: string[]; }) {
  if (o.ok && o.dryRun) {
    return `✅ DRY-RUN OK\n  tokenId: ${o.tokenId}\n  (no tx sent)`;
  }
  if (o.ok) {
    return `🚀 PUBLISHED\n  token: ${o.tokenId}\n  listing: ${o.listingId}\n  url: ${o.marketplaceUrl}`;
  }
  return `❌ blocked at: ${o.blockedAt}\n${(o.errors ?? []).map(e => "  • " + e).join("\n")}`;
}
```

### Discord (`src/lib/discord_bot_service.ts`)

Discord.js v14 supports both prefix commands (text-based `!publish_agent <id>`)
and slash commands (`/publish_agent`). Use the same `publishAgentToMarketplace`
import; format the reply as an embed using `EmbedBuilder` from `discord.js`.

## Why this was deferred

- The orchestrator + IPC wiring + tests + smoke script were the blocking work
  to unlock real on-chain publishing.
- Bot wiring is mechanical and touching the service files would balloon the PR
  diff. With `publishAgentToMarketplace` exported, it's now a single small
  follow-up PR.

## Acceptance for the follow-up

- `/publish_dryrun_agent <id>` in Telegram replies with the dry-run outcome
  (tokenId placeholder, gas estimate, no tx hash).
- `/publish_agent <id>` in Telegram replies with the real on-chain outcome
  (tokenId, listingId, marketplaceUrl) when the wallet is funded and the gate
  is open.
- Same UX in Discord using an embed.
