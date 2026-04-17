import React from "react";
import { ThirdwebProvider } from "thirdweb/react";
import { http, createConfig, WagmiProvider } from "wagmi";
import { polygonAmoy } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Wagmi config targeting Polygon Amoy
export const wagmiConfig = createConfig({
  chains: [polygonAmoy],
  transports: {
    [polygonAmoy.id]: http(),
  },
});

// Dedicated query client for the Web3 provider tree
const web3QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

/**
 * Wraps children in WagmiProvider + ThirdwebProvider + QueryClientProvider.
 * Use this around pages that need wallet / Thirdweb / on-chain functionality.
 */
export function Web3Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={web3QueryClient}>
        <ThirdwebProvider>
          {children}
        </ThirdwebProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
