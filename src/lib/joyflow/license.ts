/**
 * JoyFlow License — ERC-1155 license token minting and verification.
 *
 * Ported from joy-publish-bundle/src/lib/joyflow/license.ts. Uses the
 * platform's Edition contract (ERC-1155) for license tokens.
 *
 * Configure via Vite env vars:
 *   VITE_EDITION_CONTRACT_ADDRESS  — Edition (ERC-1155) contract address
 *   VITE_THIRDWEB_CLIENT_ID        — thirdweb client ID
 *
 * If either is missing, calls throw a descriptive error rather than failing
 * silently, so the wizard UI can surface a clear message.
 */

import {
  createThirdwebClient,
  getContract,
  readContract,
  sendTransaction,
  prepareContractCall,
} from "thirdweb";
import { polygonAmoy } from "thirdweb/chains";

export interface LicenseParams {
  to: string;
  tokenId: bigint;
  amount: bigint;
  uri?: string;
}

const EDITION_ADDRESS = import.meta.env.VITE_EDITION_CONTRACT_ADDRESS || "";
const CLIENT_ID = import.meta.env.VITE_THIRDWEB_CLIENT_ID || "";

function getEditionContract() {
  if (!EDITION_ADDRESS || !CLIENT_ID) {
    throw new Error(
      "Edition contract or Thirdweb client not configured (VITE_EDITION_CONTRACT_ADDRESS / VITE_THIRDWEB_CLIENT_ID)",
    );
  }

  const client = createThirdwebClient({ clientId: CLIENT_ID });
  return getContract({
    client,
    chain: polygonAmoy,
    address: EDITION_ADDRESS,
  });
}

export async function mintLicense(
  params: LicenseParams,
  account: Parameters<typeof sendTransaction>[0]["account"],
): Promise<{ txHash: string }> {
  const contract = getEditionContract();

  const tx = prepareContractCall({
    contract,
    method: "function mint(address to, uint256 id, uint256 amount, bytes data)",
    params: [params.to as `0x${string}`, params.tokenId, params.amount, "0x"],
  });

  const result = await sendTransaction({ transaction: tx, account });
  return { txHash: result.transactionHash };
}

export async function verifyLicense(
  walletAddress: string,
  tokenId: bigint,
): Promise<boolean> {
  try {
    const contract = getEditionContract();

    const balance = await readContract({
      contract,
      method:
        "function balanceOf(address account, uint256 id) view returns (uint256)",
      params: [walletAddress as `0x${string}`, tokenId],
    });

    return balance > 0n;
  } catch (error) {
    console.error("[JoyFlow] License verification failed:", error);
    return false;
  }
}
