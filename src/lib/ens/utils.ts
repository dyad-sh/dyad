/**
 * ENS / .joy domain utilities
 *
 * Uses ethers v6 namehash to compute ENS node hashes and helpers
 * for JoyResolver text-record encoding.
 */

import { namehash, solidityPackedKeccak256 } from "ethers";

/** The namehash of the .joy TLD */
export const JOY_TLD_NODE = namehash("joy");

/**
 * Compute the ENS node for `<name>.joy`.
 *
 * @example storeNode("alice") → namehash("alice.joy")
 */
export function storeNode(name: string): string {
  return namehash(`${name}.joy`);
}

/**
 * Compute the labelhash for a plain label (used as ERC-721 tokenId
 * in BaseRegistrar).
 *
 * @example labelhash("alice") → keccak256("alice")
 */
export function labelhash(label: string): string {
  return solidityPackedKeccak256(["string"], [label]);
}
