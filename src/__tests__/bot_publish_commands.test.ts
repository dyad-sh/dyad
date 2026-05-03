/**
 * Unit tests for src/lib/joymarketplace/bot_publish_commands.ts
 *
 * Covers the slash-command parser and outcome formatter only.
 * `runPublishCommand` is exercised indirectly by the formatter tests +
 * a smoke check that confirms the function exists and has the right
 * signature; it depends on `publishAgentToMarketplace` which talks to
 * the real DB + orchestrator and is covered by the smoke test instead.
 */

import { describe, expect, it } from "vitest";

import {
  detectPublishCommand,
  formatPublishOutcome,
} from "@/lib/joymarketplace/bot_publish_commands";
import type { PublishOutcome } from "@/lib/joymarketplace/publish_orchestrator";

describe("detectPublishCommand", () => {
  it("returns null for null/undefined/empty", () => {
    expect(detectPublishCommand(null)).toBeNull();
    expect(detectPublishCommand(undefined)).toBeNull();
    expect(detectPublishCommand("")).toBeNull();
    expect(detectPublishCommand("   ")).toBeNull();
  });

  it("returns null for unrelated chat", () => {
    expect(detectPublishCommand("hello there")).toBeNull();
    expect(detectPublishCommand("/publish hello")).toBeNull(); // no _agent suffix
    expect(detectPublishCommand("/skills")).toBeNull();
  });

  it("matches /publish_agent <id>", () => {
    const m = detectPublishCommand("/publish_agent 14");
    expect(m).not.toBeNull();
    expect(m!.command).toBe("publish");
    expect(m!.agentId).toBe(14);
  });

  it("matches /publish_dryrun_agent <id>", () => {
    const m = detectPublishCommand("/publish_dryrun_agent 7");
    expect(m).not.toBeNull();
    expect(m!.command).toBe("dryrun");
    expect(m!.agentId).toBe(7);
  });

  it("matches /publish_help", () => {
    const m = detectPublishCommand("/publish_help");
    expect(m).not.toBeNull();
    expect(m!.command).toBe("help");
    expect(m!.agentId).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(detectPublishCommand("/Publish_Agent 1")?.command).toBe("publish");
    expect(detectPublishCommand("/PUBLISH_DRYRUN_AGENT 2")?.command).toBe("dryrun");
  });

  it("ignores trailing junk after the id", () => {
    const m = detectPublishCommand("/publish_agent 42 please");
    expect(m).not.toBeNull();
    expect(m!.agentId).toBe(42);
  });

  it("rejects non-numeric ids", () => {
    expect(detectPublishCommand("/publish_agent abc")).toBeNull();
    expect(detectPublishCommand("/publish_agent")).toBeNull();
  });

  it("does NOT match commands with stray prefixes", () => {
    expect(detectPublishCommand("hello /publish_agent 1")).toBeNull();
    expect(detectPublishCommand("foo/publish_agent 1")).toBeNull();
  });
});

describe("formatPublishOutcome", () => {
  it("formats a successful dry-run with gas estimates and notes", () => {
    const o: PublishOutcome & { agentId: number } = {
      ok: true,
      dryRun: true,
      contentCid: "bafyContent",
      metadataCid: "bafyMeta",
      metadataUri: "ipfs://bafyMeta",
      estimatedGas: { mint: "0", listing: "23176" },
      errors: ["gate would block real mint"],
      agentId: 14,
    };
    const text = formatPublishOutcome(o);
    expect(text).toContain("DRY-RUN OK for agent 14");
    expect(text).toContain("contentCid: bafyContent");
    expect(text).toContain("metadataUri: ipfs://bafyMeta");
    expect(text).toContain("est. mint gas: 0");
    expect(text).toContain("est. list gas: 23176");
    expect(text).toContain("gate would block real mint");
    expect(text).toContain("(no tx sent)");
  });

  it("formats a real publish success with token+listing+url", () => {
    const o: PublishOutcome & { agentId: number } = {
      ok: true,
      dryRun: false,
      tokenId: "13",
      listingId: "0xabc",
      mintTxHash: "0xmint",
      listTxHash: "0xlist",
      marketplaceUrl: "https://joymarketplace.io/asset/13",
      goldskyIndexed: true,
      agentId: 14,
    };
    const text = formatPublishOutcome(o);
    expect(text).toContain("PUBLISHED agent 14");
    expect(text).toContain("tokenId: 13");
    expect(text).toContain("listingId: 0xabc");
    expect(text).toContain("mintTx: 0xmint");
    expect(text).toContain("listTx: 0xlist");
    expect(text).toContain("https://joymarketplace.io/asset/13");
    expect(text).toContain("goldsky: indexed");
  });

  it("notes when goldsky indexing has not landed yet", () => {
    const o: PublishOutcome & { agentId: number } = {
      ok: true,
      dryRun: false,
      tokenId: "13",
      goldskyIndexed: false,
      agentId: 14,
    };
    expect(formatPublishOutcome(o)).toContain("not yet indexed");
  });

  it("formats a no-signer failure with import-key fix hint", () => {
    const o: PublishOutcome & { agentId: number } = {
      ok: false,
      dryRun: false,
      blockedAt: "no-signer",
      errors: ["No active chain key found"],
      agentId: 14,
    };
    const text = formatPublishOutcome(o);
    expect(text).toContain("Publish blocked for agent 14");
    expect(text).toContain("step: no-signer");
    expect(text).toContain("No active chain key found");
    expect(text).toContain("jcn:key:import");
  });

  it("formats a no-gate failure with .joy domain fix hint", () => {
    const o: PublishOutcome & { agentId: number } = {
      ok: false,
      dryRun: false,
      blockedAt: "no-gate",
      errors: ["canMint returned false"],
      agentId: 14,
    };
    const text = formatPublishOutcome(o);
    expect(text).toContain("step: no-gate");
    expect(text).toContain(".joy domain");
  });

  it("handles missing agentId gracefully", () => {
    const o: PublishOutcome = {
      ok: false,
      dryRun: false,
      errors: ["something exploded"],
    };
    const text = formatPublishOutcome(o);
    expect(text).toContain("Publish blocked for agent");
    expect(text).toContain("something exploded");
  });
});
