#!/bin/bash
# =============================================================================
# Installation du serveur MCP HTTP directement sur dyad1.ty-dev.site
# À exécuter DIRECTEMENT sur le serveur distant
# =============================================================================

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Installation MCP HTTP Server                              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Trouver où est installé Dyad
echo "[1/8] Recherche de l'installation Dyad existante..."

DYAD_PATH=""
if [ -d "/root/dyad" ]; then
    DYAD_PATH="/root/dyad"
elif [ -d "/home/dyad" ]; then
    DYAD_PATH="/home/dyad"
elif [ -d "/opt/dyad" ]; then
    DYAD_PATH="/opt/dyad"
else
    # Chercher docker-compose.yml
    COMPOSE_FILE=$(find /root /home /opt -name "docker-compose.yml" -path "*/dyad*" 2>/dev/null | head -1)
    if [ -n "$COMPOSE_FILE" ]; then
        DYAD_PATH=$(dirname "$COMPOSE_FILE")
    fi
fi

if [ -z "$DYAD_PATH" ]; then
    echo "✗ Installation Dyad non trouvée"
    echo "Création d'une nouvelle installation dans /root/dyad-mcp..."
    DYAD_PATH="/root/dyad-mcp"
    mkdir -p "$DYAD_PATH"
else
    echo "✓ Dyad trouvé dans: $DYAD_PATH"
fi

cd "$DYAD_PATH"

# Créer le dossier mcp-server
echo ""
echo "[2/8] Création du dossier mcp-server..."
mkdir -p mcp-server
cd mcp-server

# Créer package.json
echo ""
echo "[3/8] Création de package.json..."
cat > package.json << 'EOF'
{
  "name": "@dyad-sh/mcp-http-server",
  "version": "0.1.0",
  "description": "HTTP proxy for Dyad MCP Server",
  "type": "module",
  "main": "dist/http-proxy.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/http-proxy.js",
    "dev": "tsc && node dist/http-proxy.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/node": "^22.14.0",
    "typescript": "^5.8.3"
  }
}
EOF

# Créer tsconfig.json
echo ""
echo "[4/8] Création de tsconfig.json..."
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF

# Créer le dossier src
mkdir -p src

# Créer http-proxy.ts
echo ""
echo "[5/8] Création de http-proxy.ts..."
cat > src/http-proxy.ts << 'EOF'
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const PORT = parseInt(process.env.MCP_HTTP_PORT || '3008', 10);
const HOST = process.env.MCP_HTTP_HOST || '0.0.0.0';
const MCP_API_URL = process.env.DYAD_API_URL || 'http://localhost:3007';

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'dyad-mcp-http-proxy',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    mcpApiUrl: MCP_API_URL
  });
});

app.get('/api/apps', async (req, res) => {
  try {
    const response = await fetch(`${MCP_API_URL}/api/apps`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get('/api/apps/:id', async (req, res) => {
  try {
    const response = await fetch(`${MCP_API_URL}/api/apps/${req.params.id}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get('/api/chats', async (req, res) => {
  try {
    const response = await fetch(`${MCP_API_URL}/api/chats`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.get('/api/chats/:id', async (req, res) => {
  try {
    const response = await fetch(`${MCP_API_URL}/api/chats/${req.params.id}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Dyad MCP HTTP Proxy                                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Server:     http://${HOST}:${PORT}`);
  console.log(`  Health:     http://${HOST}:${PORT}/health`);
  console.log(`  Apps API:   http://${HOST}:${PORT}/api/apps`);
  console.log(`  Chats API:  http://${HOST}:${PORT}/api/chats`);
  console.log('');
  console.log(`  Proxying to: ${MCP_API_URL}`);
  console.log('');
  console.log('  Ready to accept HTTP requests!');
  console.log('');
});
EOF

# Installer les dépendances
echo ""
echo "[6/8] Installation des dépendances..."
npm install

# Compiler TypeScript
echo ""
echo "[7/8] Compilation TypeScript..."
npm run build

# Vérifier que le fichier compilé existe
if [ ! -f "dist/http-proxy.js" ]; then
    echo "✗ Erreur: dist/http-proxy.js n'a pas été créé"
    exit 1
fi

echo "✓ Compilation réussie"

# Démarrer le serveur en arrière-plan
echo ""
echo "[8/8] Démarrage du serveur HTTP..."

# Créer un service systemd
cat > /etc/systemd/system/dyad-mcp-http.service << EOF
[Unit]
Description=Dyad MCP HTTP Proxy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$DYAD_PATH/mcp-server
Environment="MCP_HTTP_PORT=3008"
Environment="MCP_HTTP_HOST=0.0.0.0"
Environment="DYAD_API_URL=http://localhost:3007"
ExecStart=/usr/bin/node dist/http-proxy.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Recharger systemd
systemctl daemon-reload

# Démarrer le service
systemctl start dyad-mcp-http

# Activer au démarrage
systemctl enable dyad-mcp-http

# Attendre que le serveur démarre
sleep 3

# Vérifier le statut
systemctl status dyad-mcp-http --no-pager

# Ouvrir le firewall
echo ""
echo "Ouverture du port 3008 dans le firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 3008/tcp
    echo "✓ Port 3008 ouvert (UFW)"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --add-port=3008/tcp --permanent
    firewall-cmd --reload
    echo "✓ Port 3008 ouvert (firewalld)"
else
    echo "⚠ Aucun firewall détecté"
fi

# Test final
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✓ INSTALLATION TERMINÉE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Test du serveur..."
sleep 2

if curl -f -m 5 http://localhost:3008/health > /dev/null 2>&1; then
    echo "✓ Serveur HTTP MCP fonctionne!"
    echo ""
    curl http://localhost:3008/health | jq . 2>/dev/null || curl http://localhost:3008/health
else
    echo "✗ Le serveur ne répond pas encore"
    echo "Vérifiez les logs: journalctl -u dyad-mcp-http -f"
fi

echo ""
echo "Endpoints disponibles:"
echo "  - http://localhost:3008/health"
echo "  - http://localhost:3008/api/apps"
echo "  - http://localhost:3008/api/chats"
echo ""
echo "Commandes utiles:"
echo "  systemctl status dyad-mcp-http    # Voir le statut"
echo "  systemctl restart dyad-mcp-http   # Redémarrer"
echo "  journalctl -u dyad-mcp-http -f    # Voir les logs"
echo ""
