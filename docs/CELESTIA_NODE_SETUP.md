# Celestia Node Setup

## Overview

This guide sets up a Celestia Light Node for Joy80MVP Marketplace blob submissions on mainnet.

**Wallet Address:** `celestia1vxssxrs2t27wtgur7lmqcep5zntz3nhjp48z7k`

## Quick Start (WSL - Recommended)

### 1. Install Celestia in WSL (if not installed):
```bash
wsl bash -c 'cd ~ && go install github.com/celestiaorg/celestia-node/cmd/celestia@latest'
```

### 2. Start the node:

**Windows PowerShell:**
```powershell
# Start node (runs in background)
.\start-celestia-node.ps1

# Stop node
.\stop-celestia-node.ps1

# View logs
wsl tail -f ~/celestia-node.log
```

**Windows Batch:**
```bash
# Start node (runs in foreground)
celestia-start.bat
```

**Direct WSL Command:**
```bash
wsl celestia light start --core.ip consensus.lunaroasis.net --p2p.network celestia --rpc.addr 0.0.0.0 --rpc.port 26658
```

### 3. Check Status:
```bash
wsl celestia state balance
```

---

## Docker Setup (Alternative)

If you prefer Docker:

### 1. Build the Docker image:
```bash
docker compose -f docker-compose.celestia.yml build
```

### 2. Start the node (runs in background):
```bash
docker compose -f docker-compose.celestia.yml up -d
```

### 3. View logs:
```bash
docker compose -f docker-compose.celestia.yml logs -f
```

### 4. Check node status:
```bash
docker exec celestia-mainnet-node celestia state balance --node.store /root/.celestia-light
```

### 5. Submit a blob:
```bash
docker exec celestia-mainnet-node curl -s -X POST -H "Content-Type: application/json" \
  -d '{"id":1,"jsonrpc":"2.0","method":"blob.Submit","params":[[{"namespace":"AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwbXZwMTI=","data":"SGVsbG8gZnJvbSBKb3k4ME1WUCBNYXJrZXRwbGFjZSEgRmlyc3QgYmxvYiBvbiBDZWxlc3RpYSBNYWlubmV0IQ==","share_version":0}],{"gas_price":0.002}]}' \
  http://localhost:26658
```

### 6. Stop the node:
```bash
docker compose -f docker-compose.celestia.yml down
```

### 7. Stop and remove all data:
```bash
docker compose -f docker-compose.celestia.yml down -v
```

## Features

- ✅ Runs as background service (survives terminal close)
- ✅ Auto-restarts on crash
- ✅ Uses existing wallet from WSL
- ✅ RPC accessible on http://localhost:26658
- ✅ Health checks every 30 seconds
- ✅ Easy log viewing

## Useful Commands

**Check if running:**
```bash
docker ps | grep celestia
```

**View resource usage:**
```bash
docker stats celestia-mainnet-node
```

**Restart node:**
```bash
docker compose -f docker-compose.celestia.yml restart
```

**Check wallet balance:**
```bash
docker exec celestia-mainnet-node celestia state balance --node.store /root/.celestia-light
```

## Namespace Information

The Joy80MVP marketplace uses the following namespace for blob submissions:
- **Namespace (Base64):** `AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwbXZwMTI=`
- **Decoded:** `joy80mvp12`

## Integration with JoyCreate

The Celestia node exposes RPC on `http://localhost:26658` which can be used by:
- NFT Marketplace for storing asset metadata
- Document attestations
- Dataset provenance records
- Agent workflow logs

### Example: Submit from Node.js

```typescript
async function submitBlob(data: string): Promise<string> {
  const namespace = "AAAAAAAAAAAAAAAAAAAAAAAAAGpveTgwbXZwMTI=";
  const encodedData = Buffer.from(data).toString('base64');
  
  const response = await fetch('http://localhost:26658', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'blob.Submit',
      params: [[{
        namespace,
        data: encodedData,
        share_version: 0
      }], { gas_price: 0.002 }]
    })
  });
  
  const result = await response.json();
  return result.result; // Returns blob height
}
```

## Troubleshooting

### Node won't start
1. Check if ports 26658 and 2121 are available
2. Ensure Docker daemon is running
3. Verify wallet keys exist in `~/.celestia-light`

### Balance shows 0
Your wallet needs TIA tokens for gas fees. Get tokens from:
- Exchanges (Binance, Kraken, etc.)
- OTC

### RPC connection refused
Wait 60 seconds after startup for the node to sync and be ready.
