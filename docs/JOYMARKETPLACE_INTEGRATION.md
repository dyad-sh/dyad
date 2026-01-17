# 🔗 JoyCreate → JoyMarketplace.io Integration

## Overview

This integration connects the local JoyCreate desktop app to the online JoyMarketplace.io platform, enabling you to push locally created assets to the marketplace for sale.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        JoyCreate (Local App)                        │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │
│  │ Asset       │  │ NFT         │  │ IPLD Receipt                │ │
│  │ Creator     │  │ Marketplace │  │ Service                     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────────┬──────────────┘ │
│         │                │                        │                 │
│         └────────────────┼────────────────────────┘                 │
│                          │                                          │
│  ┌───────────────────────▼───────────────────────────────────────┐ │
│  │              MarketplaceSyncService                            │ │
│  │  • syncListing()      • ingestReceipt()    • verifyPayout()   │ │
│  │  • batchSyncListings() • verifyReceipt()   • getUSDCBalance() │ │
│  └───────────────────────┬───────────────────────────────────────┘ │
│                          │                                          │
│  ┌───────────────────────▼───────────────────────────────────────┐ │
│  │              ReceiptPinningService                             │ │
│  │  • pinTo4everland()   • pinToPinata()     • pinToHelia()      │ │
│  └───────────────────────┬───────────────────────────────────────┘ │
│                          │                                          │
└──────────────────────────┼──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    JoyMarketplace.io (Online)                       │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │ Supabase        │  │ Smart Contracts │  │ IPFS Gateways       │ │
│  │ (API + DB)      │  │ (Polygon)       │  │ (4everland/Pinata)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Configuration

### Contract Addresses (Polygon Mainnet - Chain ID 137)

| Contract | Address | Purpose |
|----------|---------|---------|
| JOY_ASSET_NFT | `0xA8566De9dA7bC1dD9D9595F56CFe34De7EaeF2CC` | AI Asset NFTs |
| JOY_DOMAIN_REGISTRY | `0x2A0Fd0c6f9Cff0034626C3bfcb1E7884aDb74680` | .joy domain names |
| ENHANCED_MODEL_MARKETPLACE | `0x8408Aeefb2557aaDe48d50E5b1B3b8A0C6275542` | Marketplace listings |
| JOY_TOKEN_V3 | `0xa3224811e8E765c3aB1314Ee7B6291E171aA2a43` | JOY token |
| USDC_POLYGON | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | USDC payouts |
| HELIA_PINNING_SERVICE | `0xe0B1787D3b72Cde79d1A6D9c559f5e2B819eeb58` | Content pinning |

### API Configuration

```typescript
const JOYMARKETPLACE_API = {
  baseUrl: "https://api.joymarketplace.io",
  webUrl: "https://joymarketplace.io",
  supabaseUrl: "https://jgsbmnzhvuwiujqbaieo.supabase.co",
  authScheme: "Bearer", // Authorization: Bearer <API_KEY>
};
```

### Environment Variables

Set these in your `.env` file or system environment:

```env
# JoyMarketplace API
JOYMARKETPLACE_API_URL=https://api.joymarketplace.io
JOYMARKETPLACE_WEB_URL=https://joymarketplace.io
JOYMARKETPLACE_SUPABASE_ANON_KEY=your_supabase_anon_key

# Pinning Services
FOUREVERLAND_API_KEY=your_4everland_api_key
FOUREVERLAND_PROJECT_ID=your_4everland_project_id
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET_KEY=your_pinata_secret_key
```

## Usage

### 1. Connect to JoyMarketplace

```typescript
import { MarketplaceSyncClient } from "@/ipc/marketplace_sync_client";

// Get your API key from joymarketplace.io dashboard
const result = await MarketplaceSyncClient.connect("your-api-key");
if (result.success) {
  console.log("Connected as:", result.publisherId);
}
```

### 2. Set Up Your Store (from .joy Domain)

```typescript
// Get store info from your .joy domain
const store = await MarketplaceSyncClient.getStoreFromDomain("mystore.joy");

// Or manually create store info
const storeInfo = {
  storeName: "My AI Store",
  creatorId: "your-wallet-address",
  creatorWallet: "0x...",
  payoutWallet: "0x...",
  logo: "ipfs://...",
  bio: "Description of your store",
};

// Set as default for all listings
await MarketplaceSyncClient.setDefaultStore(storeInfo);
```

### 3. Sync Listings

```typescript
// Sync a single listing
const listing = {
  localId: "local-asset-123",
  name: "My AI Model",
  description: "A powerful AI model for...",
  category: "ai-model",
  price: 25, // in MATIC
  currency: "MATIC",
  thumbnailCid: "QmThumbnail...",
  metadataCid: "QmMetadata...",
  contentCid: "QmContent...",
  licenseType: "commercial",
  royaltyBps: 500, // 5%
  store: storeInfo,
};

const result = await MarketplaceSyncClient.syncListing(listing);
console.log("Listed:", result.listingId);

// Batch sync multiple listings
const results = await MarketplaceSyncClient.batchSyncListings([listing1, listing2, listing3]);
```

### 4. Handle Receipts

```typescript
// Pin a receipt to IPFS
const pinResults = await MarketplaceSyncClient.pinReceipt(receiptRecord);
console.log("Pinned to:", pinResults.map(r => r.provider));

// Ingest receipt to marketplace
const receipt = {
  v: 1,
  type: "inference-receipt",
  issuer: "seller-wallet",
  payer: "buyer-wallet",
  model: { id: "model-123" },
  payment: {
    chain: "eip155:137",
    currency: "USDC",
    tx: "0xtx...",
    amount: "10.00",
  },
  // ... other fields
};

await MarketplaceSyncClient.ingestReceipt(receipt, cidOfReceipt);
```

### 5. Verify Payouts

```typescript
// Check USDC balance
const balance = await MarketplaceSyncClient.getUSDCBalance("0xYourWallet...");
console.log("USDC Balance:", balance);

// Verify a payout transaction
const verification = await MarketplaceSyncClient.verifyPayout("0xTransactionHash...");
if (verification.verified) {
  console.log("Payout confirmed:", verification.amount, "USDC");
}
```

## Field Mapping

### Domain → Store Mapping

| On-Chain Field | Marketplace Field |
|----------------|-------------------|
| domain.name | storeName |
| domain.owner | creatorWallet |
| domain.metadata.logo | storeLogo |
| domain.metadata.bio | storeDescription |

### NFT → Asset Mapping

| On-Chain Field | Marketplace Field |
|----------------|-------------------|
| tokenId | assetId |
| tokenURI | metadataUri |
| owner | creatorId |
| properties.name | assetName |
| properties.description | assetDescription |
| properties.image | thumbnailUrl |
| properties.price | price |
| properties.license | licenseType |

### Receipt → Transaction Mapping

| Receipt Field | Transaction Field |
|---------------|-------------------|
| issuer | sellerId |
| payer | buyerId |
| model.id | assetId |
| payment.tx | transactionHash |
| payment.amount | amount |
| store.name | storeName |
| store.creatorId | creatorId |

## Payout Configuration

| Setting | Value |
|---------|-------|
| USDC Contract | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Required Confirmations | 12 |
| Minimum Payout | $10 USDC |
| Platform Fee | 2.5% |
| Creator Share | 97.5% |

## Pinning Configuration

### 4everland (Primary)

```typescript
{
  apiUrl: "https://api.4everland.dev",
  pinningEndpoint: "/bucket/pin",
  gateway: "https://4everland.io/ipfs",
}
```

### Pinata (Backup)

```typescript
{
  apiUrl: "https://api.pinata.cloud",
  gateway: "https://gateway.pinata.cloud/ipfs",
}
```

## Files Created

| File | Purpose |
|------|---------|
| [src/config/joymarketplace.ts](src/config/joymarketplace.ts) | Configuration & contract addresses |
| [src/lib/marketplace_sync_service.ts](src/lib/marketplace_sync_service.ts) | Core sync logic |
| [src/lib/receipt_pinning_service.ts](src/lib/receipt_pinning_service.ts) | IPFS pinning |
| [src/ipc/handlers/marketplace_sync_handlers.ts](src/ipc/handlers/marketplace_sync_handlers.ts) | IPC handlers |
| [src/ipc/marketplace_sync_client.ts](src/ipc/marketplace_sync_client.ts) | Renderer API |

## Next Steps

1. **Get API Key**: Log in to joymarketplace.io and get your publisher API key
2. **Configure Pinning**: Set up 4everland or Pinata API keys for IPFS pinning
3. **Register Domain**: Get a .joy domain for your store identity
4. **Start Syncing**: Use the client API to push your locally created assets

## Troubleshooting

### "Not connected to marketplace"
Run `MarketplaceSyncClient.connect(apiKey)` first with a valid API key.

### "Domain not found"
Make sure the domain is registered on Polygon mainnet and currently active.

### "Pinning failed"
Check that your 4everland or Pinata API keys are correctly configured.

### Transaction verification fails
Ensure the transaction has at least 12 confirmations on Polygon.
