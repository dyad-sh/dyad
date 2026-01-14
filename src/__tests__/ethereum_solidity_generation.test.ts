import { describe, it, expect } from "vitest";
import {
  generateContractPrompt,
  isGenerationSupported,
  GENERATION_TARGETS,
  ETHEREUM_GENERATION_PROMPT,
} from "../prompts/generation_prompts";

describe("Ethereum/Solidity Generation Flow", () => {
  it("should include solidity in GENERATION_TARGETS", () => {
    expect(GENERATION_TARGETS).toContain("solidity");
  });

  it("should support generation for solidity", () => {
    expect(isGenerationSupported("solidity")).toBe(true);
  });

  it("should generate a valid prompt for an ERC721 NFT contract", () => {
    const prompt = generateContractPrompt(
      "solidity",
      "Create an ERC721 NFT contract"
    );

    // Check prompt structure
    expect(prompt).toContain("Solidity");
    expect(prompt).toContain("Create an ERC721 NFT contract");
    expect(prompt).toContain("Generate a smart contract");
  });

  it("should include Counter example in ETHEREUM_GENERATION_PROMPT", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Counter.sol");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Counter");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("dyad-write");
  });

  it("should include proper file structure paths in the prompt", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain(
      "src/<contract-name>/<ContractName>.sol"
    );
  });

  it("should include Solidity fundamentals in the prompt", () => {
    // License and pragma
    expect(ETHEREUM_GENERATION_PROMPT).toContain("SPDX-License-Identifier");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("pragma solidity");

    // Contract structure
    expect(ETHEREUM_GENERATION_PROMPT).toContain("contract");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("constructor");
  });

  it("should include visibility and state mutability concepts", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("public");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("external");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("internal");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("private");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("view");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("pure");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("payable");
  });

  it("should include data locations", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("storage");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("memory");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("calldata");
  });

  it("should include OpenZeppelin patterns", () => {
    // Access control
    expect(ETHEREUM_GENERATION_PROMPT).toContain("@openzeppelin/contracts");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Ownable");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("onlyOwner");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("AccessControl");

    // Security patterns
    expect(ETHEREUM_GENERATION_PROMPT).toContain("ReentrancyGuard");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("nonReentrant");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Pausable");
  });

  it("should include ERC token standards", () => {
    // ERC20
    expect(ETHEREUM_GENERATION_PROMPT).toContain("ERC20");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("_mint");

    // ERC721
    expect(ETHEREUM_GENERATION_PROMPT).toContain("ERC721");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("_safeMint");

    // ERC1155
    expect(ETHEREUM_GENERATION_PROMPT).toContain("ERC1155");
  });

  it("should include events and custom errors patterns", () => {
    // Events
    expect(ETHEREUM_GENERATION_PROMPT).toContain("event");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("emit");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("indexed");

    // Custom errors
    expect(ETHEREUM_GENERATION_PROMPT).toContain("error");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("revert");
  });

  it("should include security considerations", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Security");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Reentrancy");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("CEI");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Checks-Effects-Interactions");
  });

  it("should include gas optimization tips", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Gas");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("optimization");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("unchecked");
  });

  it("should include type guidelines", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("uint256");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("address");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("mapping");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("bytes32");
  });

  it("should include factory pattern", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Factory");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("createVault");
  });

  it("should include upgradeable contract pattern", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("UUPS");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Upgradeable");
    expect(ETHEREUM_GENERATION_PROMPT).toContain("Initializable");
  });

  it("should include dyad-add-dependency for OpenZeppelin", () => {
    expect(ETHEREUM_GENERATION_PROMPT).toContain("dyad-add-dependency");
    expect(ETHEREUM_GENERATION_PROMPT).toContain(
      '@openzeppelin/contracts'
    );
  });
});
