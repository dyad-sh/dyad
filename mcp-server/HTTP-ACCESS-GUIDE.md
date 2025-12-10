# Dyad MCP HTTP Access Guide

## Vue d'ensemble

Le serveur MCP Dyad est maintenant accessible via HTTP, permettant une connexion à distance sans SSH ou stdio.

## Configuration

### Local (Port 3008)
```bash
# Démarrer le serveur HTTP
cd mcp-server
npm run http
```

Le serveur sera accessible sur `http://localhost:3008`

### Docker (avec docker-compose)
```bash
# Démarrer tous les services
docker compose up -d

# Le serveur MCP HTTP sera accessible sur http://localhost:3008
```

### Remote (dyad1.ty-dev.site)
```bash
# Accéder au serveur distant
http://dyad1.ty-dev.site:3008
```

## Endpoints Disponibles

### Health Check
```bash
GET http://localhost:3008/health
```

Réponse:
```json
{
  "status": "healthy",
  "server": "dyad-mcp-http-proxy",
  "version": "0.1.0",
  "timestamp": "2025-12-10T18:35:00.000Z",
  "mcpApiUrl": "http://localhost:3007"
}
```

### List Apps
```bash
GET http://localhost:3008/api/apps
```

Réponse:
```json
{
  "apps": [
    {
      "id": 1,
      "name": "My App",
      "path": "/path/to/app",
      "createdAt": "2025-12-10T10:00:00.000Z"
    }
  ]
}
```

### Get App Details
```bash
GET http://localhost:3008/api/apps/:id
```

### List Chats
```bash
GET http://localhost:3008/api/chats
```

### Get Chat Details
```bash
GET http://localhost:3008/api/chats/:id
```

## Tests

### Test Local
```bash
cd mcp-server
npm run test:http
```

### Test Remote
```bash
# Définir l'URL distante
export MCP_HTTP_URL=http://dyad1.ty-dev.site:3008
npm run test:http
```

Ou avec PowerShell:
```powershell
$env:MCP_HTTP_URL="http://dyad1.ty-dev.site:3008"
npm run test:http
```

## Configuration MCP

### Configuration Locale
Déjà ajoutée à `mcp_config.json`:
```json
{
  "dyad-mcp-local": {
    "command": "docker",
    "args": ["exec", "-i", "dyad-mcp", "node", "dist/index.js"]
  }
}
```

### Configuration HTTP (Alternative)
Pour utiliser HTTP au lieu de stdio, vous pouvez créer un wrapper qui communique via HTTP.

## Utilisation avec cURL

### Lister les apps
```bash
curl http://localhost:3008/api/apps
```

### Obtenir une app spécifique
```bash
curl http://localhost:3008/api/apps/1
```

### Lister les chats
```bash
curl http://localhost:3008/api/chats
```

## Utilisation avec JavaScript/TypeScript

```typescript
import fetch from 'node-fetch';

const MCP_URL = 'http://localhost:3008';

// Lister les apps
const response = await fetch(`${MCP_URL}/api/apps`);
const data = await response.json();
console.log(data.apps);

// Obtenir une app
const app = await fetch(`${MCP_URL}/api/apps/1`);
const appData = await app.json();
console.log(appData);
```

## Utilisation avec Python

```python
import requests

MCP_URL = 'http://localhost:3008'

# Lister les apps
response = requests.get(f'{MCP_URL}/api/apps')
apps = response.json()
print(apps['apps'])

# Obtenir une app
app_response = requests.get(f'{MCP_URL}/api/apps/1')
app = app_response.json()
print(app)
```

## Déploiement sur le serveur distant

### 1. Copier les fichiers
```bash
scp -r mcp-server root@dyad1.ty-dev.site:/path/to/dyad-1/
```

### 2. Construire et démarrer
```bash
ssh root@dyad1.ty-dev.site
cd /path/to/dyad-1
docker compose up -d --build
```

### 3. Vérifier
```bash
curl http://dyad1.ty-dev.site:3008/health
```

## Sécurité

> [!WARNING]
> Le serveur HTTP est actuellement configuré avec CORS ouvert (`*`). Pour la production, vous devriez:
> 1. Restreindre les origines CORS
> 2. Ajouter une authentification (API key, JWT, etc.)
> 3. Utiliser HTTPS avec un certificat SSL

## Troubleshooting

### Le serveur ne démarre pas
```bash
# Vérifier si le port 3008 est déjà utilisé
netstat -ano | findstr :3008  # Windows
lsof -i :3008                  # Linux/Mac

# Changer le port
export MCP_HTTP_PORT=3009
npm run http
```

### Erreur de connexion au Dyad API
```bash
# Vérifier que Dyad est en cours d'exécution
curl http://localhost:3007/api/health

# Vérifier les logs Docker
docker logs dyad-web
docker logs dyad-mcp
```

### Erreur CORS
Si vous obtenez des erreurs CORS dans le navigateur, vérifiez que le serveur HTTP est bien configuré avec CORS activé (déjà fait dans `http-proxy.ts`).

## Prochaines étapes

1. ✅ Serveur HTTP créé et fonctionnel
2. ✅ Endpoints API implémentés
3. ✅ Docker configuré avec port 3008
4. ⏳ Déployer sur dyad1.ty-dev.site
5. ⏳ Tester la connexion distante
6. ⏳ Ajouter l'authentification (optionnel)
