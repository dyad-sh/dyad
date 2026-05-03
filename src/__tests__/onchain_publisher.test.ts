/**
 * OnchainPublisher — unit tests.
 *
 * We do NOT hit any real RPC. Instead we construct an `ethers.Wallet` with a
 * stub `JsonRpcProvider` whose `send` method we override to return canned
 * responses. This lets us verify:
 *   - canMint() decoding works
 *   - lazyMintDrop returns the next tokenId from nextTokenIdToMint()
 *   - dryRun path returns calldata + gas estimate without sending
 *   - createListing dry-run encodes against the correct contract
 */

import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";

vi.mock("electron-log", () => ({
  default: { scope: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }) },
}));

import { OnchainPublisher } from "@/lib/joymarketplace/onchain_publisher";
import {
  AMOY_ENS_CONTRACTS,
  CONTRACT_ABIS,
  CONTRACT_ADDRESSES,
  POLYGON_AMOY,
} from "@/config/joymarketplace";

// Build a wallet with a stub provider whose `send` we can drive deterministically.
function buildStubWallet(sendImpl: (method: string, params: unknown[]) => Promise<unknown>): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(POLYGON_AMOY.rpcUrl, POLYGON_AMOY.chainId);
  // Override private network detection + transport for deterministic tests.
  const p = provider as unknown as {
    _detectNetwork: () => Promise<ethers.Network>;
    send: (method: string, params: unknown[]) => Promise<unknown>;
  };
  p._detectNetwork = async () =>
    new ethers.Network(POLYGON_AMOY.name, BigInt(POLYGON_AMOY.chainId));
  p.send = sendImpl;
  // Pseudo-private-key — never used to sign anything we send.
  const pk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  return new ethers.Wallet(pk, provider);
}

describe("OnchainPublisher", () => {
  it("verifyCreatorGate returns canMint=true when gate replies non-zero", async () => {
    const send = vi.fn(async (method: string, _params: unknown[]) => {
      if (method === "eth_chainId") return `0x${POLYGON_AMOY.chainId.toString(16)}`;
      if (method === "eth_call") {
        // Pad bool true into 32 bytes
        return "0x0000000000000000000000000000000000000000000000000000000000000001";
      }
      throw new Error(`unexpected ${method}`);
    });
    const wallet = buildStubWallet(send);
    const publisher = new OnchainPublisher(wallet, POLYGON_AMOY);
    const r = await publisher.verifyCreatorGate(wallet.address);
    expect(r.canMint).toBe(true);
  });

  it("verifyCreatorGate returns canMint=false with reason on revert", async () => {
    const send = vi.fn(async (method: string, _params: unknown[]) => {
      if (method === "eth_chainId") return `0x${POLYGON_AMOY.chainId.toString(16)}`;
      if (method === "eth_call") throw new Error("revert: no joy name");
      throw new Error(`unexpected ${method}`);
    });
    const wallet = buildStubWallet(send);
    const publisher = new OnchainPublisher(wallet, POLYGON_AMOY);
    const r = await publisher.verifyCreatorGate(wallet.address);
    expect(r.canMint).toBe(false);
    expect(r.reason).toMatch(/revert/);
  });

  it("lazyMintDrop dry-run returns nextTokenId, calldata and gas estimate", async () => {
    let nextIdCallCount = 0;
    const send = vi.fn(async (method: string, params: unknown[]) => {
      if (method === "eth_chainId") return `0x${POLYGON_AMOY.chainId.toString(16)}`;
      if (method === "eth_call") {
        // Inspect the `to` field; if it's the platformDrop, return uint256(7)
        const call = params[0] as { to?: string; data?: string };
        if (call?.to?.toLowerCase() === AMOY_ENS_CONTRACTS.platformDrop.toLowerCase()) {
          nextIdCallCount += 1;
          return "0x0000000000000000000000000000000000000000000000000000000000000007";
        }
        // Other read calls (e.g. canMint) — just return zero
        return "0x0000000000000000000000000000000000000000000000000000000000000000";
      }
      if (method === "eth_estimateGas") {
        return "0x5208"; // 21000
      }
      throw new Error(`unexpected ${method}`);
    });
    const wallet = buildStubWallet(send);
    const publisher = new OnchainPublisher(wallet, POLYGON_AMOY);
    const r = await publisher.lazyMintDrop("ipfs://bafyMeta", 1, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.tokenId).toBe("7");
    expect(nextIdCallCount).toBe(1);
    expect(r.gasEstimate).toBe(21000n);
    expect(r.to?.toLowerCase()).toBe(AMOY_ENS_CONTRACTS.JoyCreatorGate.toLowerCase());
    // Decode the calldata back via the gate ABI to assert the args.
    const iface = new ethers.Interface(CONTRACT_ABIS.JOY_CREATOR_GATE);
    const decoded = iface.parseTransaction({ data: r.data! });
    expect(decoded?.name).toBe("mint");
    expect(decoded?.args[0].toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(decoded?.args[1]).toBe(7n);
    expect(decoded?.args[2]).toBe(1n);
  });

  it("createListing dry-run targets ENHANCED_MODEL_MARKETPLACE with the correct args", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "eth_chainId") return `0x${POLYGON_AMOY.chainId.toString(16)}`;
      if (method === "eth_estimateGas") return "0x9c40"; // 40000
      throw new Error(`unexpected ${method}`);
    });
    const wallet = buildStubWallet(send);
    const publisher = new OnchainPublisher(wallet, POLYGON_AMOY);
    const r = await publisher.createListing(
      "7",
      1_000_000n, // 1 USDC
      CONTRACT_ADDRESSES.USDC_POLYGON,
      1,
      { dryRun: true },
    );
    expect(r.dryRun).toBe(true);
    expect(r.to?.toLowerCase()).toBe(CONTRACT_ADDRESSES.ENHANCED_MODEL_MARKETPLACE.toLowerCase());
    expect(r.gasEstimate).toBe(40000n);
    const iface = new ethers.Interface(CONTRACT_ABIS.ENHANCED_MODEL_MARKETPLACE);
    const decoded = iface.parseTransaction({ data: r.data! });
    expect(decoded?.name).toBe("createListing");
    expect(decoded?.args[0]).toBe(7n);
    expect(decoded?.args[1]).toBe(1_000_000n);
    expect(decoded?.args[2].toLowerCase()).toBe(CONTRACT_ADDRESSES.USDC_POLYGON.toLowerCase());
  });
});
