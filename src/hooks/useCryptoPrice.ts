import { useQuery } from "@tanstack/react-query";

interface CryptoPrices {
  matic: number;
  usd: number;
}

async function fetchMaticPrice(): Promise<CryptoPrices> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    const usd: number = data?.["matic-network"]?.usd ?? 0;
    return { matic: usd > 0 ? 1 / usd : 0, usd };
  } catch {
    // Fallback — don't break the UI over a price feed
    return { matic: 0, usd: 0 };
  }
}

/** Provides latest MATIC/USD price via CoinGecko (60 s stale time). */
export function useCryptoPrice() {
  const { data: prices = { matic: 0, usd: 0 } } = useQuery<CryptoPrices>({
    queryKey: ["crypto-price", "matic"],
    queryFn: fetchMaticPrice,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return { prices };
}
