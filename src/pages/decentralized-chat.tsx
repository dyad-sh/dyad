/**
 * Decentralized Chat Page
 * Wallet-to-wallet P2P encrypted messaging with IPFS/Helia pinning
 */

import { DecentralizedChatPanel } from "@/components/decentralized-chat";

export default function DecentralizedChatPage() {
  return (
    <div className="h-[calc(100vh-3.5rem)]">
      <DecentralizedChatPanel />
    </div>
  );
}
