/**
 * Unified Identity Page — Create Once, Use Everywhere
 * 
 * Route: /identity
 * 
 * Central hub for managing your Universal Identity:
 * DID + ENS/JNS + Multi-chain Wallets + Social Proofs + Reputation
 */

import { UnifiedIdentityHub } from "@/components/identity/UnifiedIdentityHub";

export default function UnifiedIdentityPage() {
  return (
    <div className="h-full">
      <UnifiedIdentityHub />
    </div>
  );
}
