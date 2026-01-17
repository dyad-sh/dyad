/**
 * Compute Network Page
 * Decentralized AI inference with libp2p/Helia
 */

import { ComputeNetworkPanel } from "@/components/compute-network";

export default function ComputeNetworkPage() {
  return (
    <div className="h-[calc(100vh-3.5rem)]">
      <ComputeNetworkPanel />
    </div>
  );
}
