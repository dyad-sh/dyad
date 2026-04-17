import React from "react";
import { Web3Providers } from "@/config/web3-providers";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { CreateAssetWizard } from "@/components/marketplace/CreateAssetWizard";

export default function CreateAssetPage() {
  return (
    <AuthProvider>
      <Web3Providers>
        <CreateAssetWizard />
      </Web3Providers>
    </AuthProvider>
  );
}
