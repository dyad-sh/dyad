#!/usr/bin/env node
/**
 * Live smoke test for the DropERC1155 + Stores subgraph client.
 *
 * Hits the real Goldsky endpoints and prints what `marketplace:browse` would
 * return today. Run from repo root:
 *
 *   node scripts/smoke-test-drop-subgraph.mjs
 *
 * Network-only — no Electron, no DB, no IPFS. Fails loudly on any non-200
 * subgraph response or empty data envelope.
 */

const drop =
  "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-drop-amoy/0.0.1/gn";
const stores =
  "https://api.goldsky.com/api/public/project_cmnkv2wbi14re01un3l5lb3rf/subgraphs/joy-stores-amoy/0.0.3/gn";

async function gql(url, query, variables = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  const json = await r.json();
  if (json.errors?.length) throw new Error("GraphQL: " + JSON.stringify(json.errors));
  return json.data;
}

function fmt(n) { return n.toLocaleString(); }

async function main() {
  console.log("→ DROP subgraph health");
  const dmeta = await gql(drop, `{ _meta { block { number timestamp } hasIndexingErrors } }`);
  console.log("  block", fmt(dmeta._meta.block.number), "errors:", dmeta._meta.hasIndexingErrors);

  console.log("\n→ STORES subgraph health");
  const smeta = await gql(stores, `{ _meta { block { number timestamp } hasIndexingErrors } }`);
  console.log("  block", fmt(smeta._meta.block.number), "errors:", smeta._meta.hasIndexingErrors);

  console.log("\n→ listDrops(page=1, pageSize=20, orderBy=lazyMintedAt desc)");
  const browse = await gql(
    drop,
    `{ tokens(first: 20, skip: 0, orderBy: lazyMintedAt, orderDirection: desc) {
       id tokenId baseURI lazyMintedAt pricePerToken supplyClaimed maxClaimableSupply totalPurchases
     } }`
  );
  console.log(`  got ${browse.tokens.length} tokens`);
  for (const t of browse.tokens.slice(0, 5)) {
    console.log(`  - #${t.tokenId}: claimed=${t.supplyClaimed ?? 0}/${t.maxClaimableSupply ?? "∞"}, baseURI=${(t.baseURI || "").slice(0, 50) || "(none)"}`);
  }

  console.log("\n→ getDrop(tokenId=11)");
  const detail = await gql(drop, `{ token(id: "11") { id tokenId baseURI pricePerToken } }`);
  console.log("  ", detail.token);

  console.log("\n→ getStore(\"love\")");
  const store = await gql(stores, `{ store(id: "love") { id owner name description isActive } }`);
  console.log("  ", store.store);

  console.log("\n→ listClaimsByBuyer(0xabc...) — random wallet, expect empty");
  const claims = await gql(drop, `{ purchases(where: { claimer: "0x0000000000000000000000000000000000000abc" }, first: 5, orderBy: timestamp, orderDirection: desc) { id tokenId quantity timestamp } }`);
  console.log("  got", claims.purchases.length, "claims");

  console.log("\n✅ DROP-SUBGRAPH SMOKE OK");
}

main().catch((e) => {
  console.error("❌ SMOKE FAILED:", e.message);
  process.exit(1);
});
