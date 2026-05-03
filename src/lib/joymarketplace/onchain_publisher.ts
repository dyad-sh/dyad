/**
 * OnchainPublisher — encapsulates the JoyMarketplace on-chain write surface.
 *
 *   verifyCreatorGate(addr) — reads JoyCreatorGate.canMint(addr)
 *   lazyMintDrop(uri, qty)  — proxy-mints a new ERC-1155 token via JoyCreatorGate
 *   createListing(...)      — creates a marketplace listing on the v3 marketplace
 *   goldskyWatch(...)       — polls a Goldsky subgraph until the asset is indexed
 *
 * Every write supports `{ dryRun: true }` which returns calldata + gas estimates
 * without sending the tx. This is the path the smoke-test exercises on CI / in
 * environments without a funded wallet.
 *
 * NOTE: The simple `createListing(uint256,uint256,address)` ABI in
 * `CONTRACT_ABIS.ENHANCED_MODEL_MARKETPLACE` is used as a placeholder. The full
 * Thirdweb MarketplaceV3 surface (`createListing(IDirectListings.ListingParameters)`)
 * is a follow-up.  See `briefs/onchain-publish-bot-integration.md` for context.
 */

import { ethers } from "ethers";
import log from "electron-log";
import {
  AMOY_ENS_CONTRACTS,
  CONTRACT_ABIS,
  CONTRACT_ADDRESSES,
  POLYGON_AMOY,
} from "@/config/joymarketplace";

const logger = log.scope("onchain_publisher");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  blockExplorer?: string;
}

export interface DryRunResult {
  dryRun: true;
  to: string;
  data: string;
  gasEstimate: bigint;
}

export interface MintResult {
  tokenId: string;
  txHash?: string;
  gasEstimate?: bigint;
  dryRun?: boolean;
  to?: string;
  data?: string;
}

export interface ListingResult {
  listingId: string;
  txHash?: string;
  gasEstimate?: bigint;
  dryRun?: boolean;
  to?: string;
  data?: string;
}

export interface VerifyResult {
  canMint: boolean;
  reason?: string;
}

export interface GoldskyWatchResult {
  indexed: boolean;
  asset?: unknown;
  error?: string;
}

// Thirdweb DropERC1155 — minimum surface we need to derive nextTokenId
const DROP_ERC1155_ABI = [
  "function nextTokenIdToMint() view returns (uint256)",
  // ERC-1155 metadata
  "function uri(uint256 id) view returns (string)",
];

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------

export class OnchainPublisher {
  private wallet: ethers.Wallet;
  private chain: ChainConfig;
  private provider: ethers.JsonRpcProvider;

  constructor(wallet: ethers.Wallet, chain: ChainConfig = POLYGON_AMOY) {
    this.chain = chain;
    // If the wallet was constructed without a provider, attach one for our chain.
    const provider =
      wallet.provider instanceof ethers.JsonRpcProvider
        ? wallet.provider
        : new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId);
    this.provider = provider;
    this.wallet = wallet.connect(provider);
  }

  get signerAddress(): string {
    return this.wallet.address;
  }

  // -- gate -----------------------------------------------------------------

  /**
   * Read JoyCreatorGate.canMint(addr).
   * Returns `{ canMint: false }` (with a reason) on contract revert / RPC error
   * — never throws.
   */
  async verifyCreatorGate(signerAddress: string): Promise<VerifyResult> {
    try {
      const gate = new ethers.Contract(
        AMOY_ENS_CONTRACTS.JoyCreatorGate,
        CONTRACT_ABIS.JOY_CREATOR_GATE,
        this.provider,
      );
      const can = await gate.canMint(signerAddress);
      if (Boolean(can)) return { canMint: true };
      return { canMint: false, reason: "JoyCreatorGate.canMint returned false (no .joy name on this wallet?)" };
    } catch (err) {
      return {
        canMint: false,
        reason: `verifyCreatorGate RPC/revert: ${(err as Error).message}`,
      };
    }
  }

  // -- mint -----------------------------------------------------------------

  /**
   * Lazy-mint a new ERC-1155 token via JoyCreatorGate (which proxies the
   * call into the platformDrop). Auto-derives the next tokenId via the drop
   * contract's `nextTokenIdToMint()` read.
   *
   * Note: `metadataUri` is the IPFS URI for the JSON metadata blob. Persistence
   * of `tokenId -> uri` is the responsibility of the platformDrop contract.
   */
  async lazyMintDrop(
    metadataUri: string,
    quantity: number,
    opts: { dryRun?: boolean } = {},
  ): Promise<MintResult> {
    if (!metadataUri || quantity <= 0) {
      throw new Error(`invalid mint inputs: uri=${metadataUri} qty=${quantity}`);
    }
    // 1. Derive nextTokenId
    const drop = new ethers.Contract(
      AMOY_ENS_CONTRACTS.platformDrop,
      DROP_ERC1155_ABI,
      this.provider,
    );
    let nextTokenId: bigint;
    try {
      nextTokenId = await drop.nextTokenIdToMint();
    } catch (err) {
      // Some deployments may not expose this; fall back to 0 with a warning.
      logger.warn(`drop.nextTokenIdToMint() failed: ${(err as Error).message}`);
      nextTokenId = 0n;
    }

    // 2. Encode the gate call: mint(creator, tokenId, quantity, data)
    //    `data` is opaque — we pass the metadata URI as utf-8 so the gate
    //    contract can persist it as the token's URI if its hook does so.
    const gate = new ethers.Contract(
      AMOY_ENS_CONTRACTS.JoyCreatorGate,
      CONTRACT_ABIS.JOY_CREATOR_GATE,
      this.wallet,
    );
    const encodedData = ethers.toUtf8Bytes(metadataUri);
    const calldata = gate.interface.encodeFunctionData("mint", [
      this.wallet.address,
      nextTokenId,
      BigInt(quantity),
      encodedData,
    ]);

    // 3. Gas estimate
    let gasEstimate: bigint = 0n;
    try {
      gasEstimate = await this.provider.estimateGas({
        from: this.wallet.address,
        to: AMOY_ENS_CONTRACTS.JoyCreatorGate,
        data: calldata,
      });
    } catch (err) {
      logger.warn(`mint gas estimate failed: ${(err as Error).message}`);
    }

    if (opts.dryRun) {
      return {
        tokenId: nextTokenId.toString(),
        gasEstimate,
        dryRun: true,
        to: AMOY_ENS_CONTRACTS.JoyCreatorGate,
        data: calldata,
      };
    }

    // 4. Send
    const tx = await gate.mint(
      this.wallet.address,
      nextTokenId,
      BigInt(quantity),
      encodedData,
    );
    const receipt = await tx.wait();
    return {
      tokenId: nextTokenId.toString(),
      txHash: receipt?.hash ?? tx.hash,
      gasEstimate,
    };
  }

  // -- listing --------------------------------------------------------------

  /**
   * Create a marketplace listing.
   *
   * TODO: replace the simple `createListing(uint256,uint256,address)` ABI
   * with the full Thirdweb MarketplaceV3 `IDirectListings.ListingParameters`
   * struct surface. For now this writes against the `ENHANCED_MODEL_MARKETPLACE`
   * contract using the simple ABI defined in `joymarketplace.ts`.
   */
  async createListing(
    tokenId: string,
    pricePerToken: bigint,
    currency: string,
    _quantity: number,
    opts: { dryRun?: boolean } = {},
  ): Promise<ListingResult> {
    const marketplaceAddr = CONTRACT_ADDRESSES.ENHANCED_MODEL_MARKETPLACE;
    const contract = new ethers.Contract(
      marketplaceAddr,
      CONTRACT_ABIS.ENHANCED_MODEL_MARKETPLACE,
      this.wallet,
    );

    const calldata = contract.interface.encodeFunctionData("createListing", [
      BigInt(tokenId),
      pricePerToken,
      currency,
    ]);

    let gasEstimate: bigint = 0n;
    try {
      gasEstimate = await this.provider.estimateGas({
        from: this.wallet.address,
        to: marketplaceAddr,
        data: calldata,
      });
    } catch (err) {
      logger.warn(`listing gas estimate failed: ${(err as Error).message}`);
    }

    if (opts.dryRun) {
      // No listingId yet — synthetic placeholder.
      return {
        listingId: `dry-${tokenId}`,
        gasEstimate,
        dryRun: true,
        to: marketplaceAddr,
        data: calldata,
      };
    }

    const tx = await contract.createListing(BigInt(tokenId), pricePerToken, currency);
    const receipt = await tx.wait();
    // Try to read listingId from the ListingCreated event
    let listingId = "0";
    try {
      const evt = receipt?.logs
        ?.map((l: ethers.Log): ethers.LogDescription | null => {
          try {
            return contract.interface.parseLog({ topics: [...l.topics], data: l.data });
          } catch {
            return null;
          }
        })
        ?.find((parsed: ethers.LogDescription | null) => parsed?.name === "ListingCreated");
      if (evt && "args" in evt && evt.args && evt.args[0] != null) {
        listingId = evt.args[0].toString();
      }
    } catch (err) {
      logger.warn(`could not parse ListingCreated: ${(err as Error).message}`);
    }
    return {
      listingId,
      txHash: receipt?.hash ?? tx.hash,
      gasEstimate,
    };
  }

  // -- Goldsky --------------------------------------------------------------

  /**
   * Poll a Goldsky subgraph until the given tokenId shows up as an Asset,
   * or until `timeoutMs` elapses. Best-effort — never throws.
   */
  async goldskyWatch(
    subgraphUrl: string,
    tokenId: string,
    timeoutMs: number,
    fetchImpl: typeof fetch = (globalThis.fetch?.bind(globalThis) as typeof fetch),
  ): Promise<GoldskyWatchResult> {
    if (!subgraphUrl) return { indexed: false, error: "no subgraph url" };
    const start = Date.now();
    const query = `query Asset($id: ID!) { asset(id: $id) { id tokenId tokenUri } }`;
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetchImpl(subgraphUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables: { id: tokenId } }),
        });
        if (res.ok) {
          const json = (await res.json()) as { data?: { asset?: unknown } };
          if (json.data?.asset) {
            return { indexed: true, asset: json.data.asset };
          }
        }
      } catch (err) {
        logger.warn(`goldskyWatch poll error: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    return { indexed: false };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an ethers.Wallet from a hex private key + a chain config.
 * Used by the orchestrator after pulling the key from JcnKeyManager.
 */
export function buildWallet(privateKeyHex: string, chain: ChainConfig = POLYGON_AMOY): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, chain.chainId);
  const pk = privateKeyHex.startsWith("0x") ? privateKeyHex : `0x${privateKeyHex}`;
  return new ethers.Wallet(pk, provider);
}
