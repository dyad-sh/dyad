# Configuration du Serveur MCP pour Dyad Web (Docker)

## 🐳 Architecture Docker

Pour la version web de Dyad avec PostgreSQL, le serveur MCP communique via l'API REST du serveur web.

```
┌─────────────────────────────────────┐
│     MCP Client (Claude Desktop)     │
└──────────────┬──────────────────────┘
               │ stdio
┌──────────────▼──────────────────────┐
│       Dyad MCP Server               │
│      (Docker Container)             │
└──────────────┬──────────────────────┘
               │ HTTP/REST API
┌──────────────▼──────────────────────┐
│      Dyad Web Server                │
│      (Docker Container)             │
└──────────────┬──────────────────────┘
               │ SQL
┌──────────────▼──────────────────────┐
│      PostgreSQL Database            │
│      (Docker or External)           │
└─────────────────────────────────────┘
```

## 📋 Configuration Docker Compose

### Option 1 : MCP Server dans Docker (Recommandé pour Production)

Ajoutez le serveur MCP au `docker-compose.yml` :

```yaml
version: '3.8'

services:
  # Service Dyad Web existant
  dyad:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: dyad-web
    ports:
      - "3007:3007"
    environment:
      - DATABASE_URL=postgresql://user:password@postgres:5432/dyad
      # ... autres variables
    networks:
      - dyad-network

  # PostgreSQL (si non externe)
  postgres:
    image: postgres:16-alpine
    container_name: dyad-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=dyad
      - POSTGRES_PASSWORD=your_secure_password
      - POSTGRES_DB=dyad
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - dyad-network
    ports:
      - "5432:5432"

  # MCP Server
  mcp-server:
    build:
      context: ./mcp-server
      dockerfile: Dockerfile
    container_name: dyad-mcp
    restart: unless-stopped
    environment:
      # URL de l'API Dyad Web (communication interne)
      - DYAD_API_URL=http://dyad:3007
      # Optionnel : authentification si requise
      # - DYAD_API_KEY=your_api_key
    depends_on:
      - dyad
    networks:
      - dyad-network
    profiles:
      - with-mcp

volumes:
  postgres-data:
    driver: local

networks:
  dyad-network:
    driver: bridge
```

### Option 2 : MCP Server Local + Dyad Web Docker

Si vous voulez garder le MCP server sur votre machine locale :

**docker-compose.yml** (Dyad web seulement) :
```yaml
services:
  dyad:
    # ... config existante
    ports:
      - "3007:3007"  # Exposer l'API
    environment:
      - CORS_ORIGIN=*  # Permettre accès local
```

**Configuration MCP Locale** :

Fichier : `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dyad-web": {
      "command": "node",
      "args": [
        "C:\\dyad-1\\mcp-server\\dist\\index.js"
      ],
      "env": {
        "DYAD_API_URL": "http://localhost:3007",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"
      }
    }
  }
}
```

## 🛠️ Configuration des Variables d'Environnement

### Variables Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DYAD_API_URL` | URL de l'API Dyad Web | `http://dyad:3007` (Docker)<br>`http://localhost:3007` (Local) |

### Variables Optionnelles

| Variable | Description | Défaut |
|----------|-------------|--------|
| `DYAD_API_KEY` | Clé API si authentification requise | - |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Accepter certificats auto-signés | `1` |
| `DEBUG` | Activer logs debug | - |
| `LOG_LEVEL` | Niveau de log | `info` |

## 🚀 Démarrage

### Avec Docker Compose

```bash
# Démarrer avec le serveur MCP
docker-compose --profile with-mcp up -d

# Vérifier les logs
docker-compose logs -f mcp-server

# Arrêter
docker-compose --profile with-mcp down
```

### Build et Test

```bash
# Builder le serveur MCP
cd mcp-server
npm run build

# Tester localement avec l'API
export DYAD_API_URL=http://localhost:3007
node dist/index.js
```

## 📡 Endpoints API Utilisés

Le serveur MCP communique avec ces endpoints Dyad :

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/apps` | GET | Liste toutes les apps |
| `/api/apps/:id` | GET | Détails d'une app |
| `/api/apps/:id/chats` | GET | Chats d'une app |
| `/api/chats` | GET | Liste tous les chats |
| `/api/chats/:id` | GET | Détails d'un chat |
| `/api/chats/:id/messages` | GET | Messages d'un chat |
| `/api/messages/:id` | GET | Détails d'un message |

## 🔐 Sécurité

### Authentification API

Si votre serveur Dyad nécessite une authentification :

```yaml
# docker-compose.yml
mcp-server:
  environment:
    - DYAD_API_URL=https://dyad.example.com
    - DYAD_API_KEY=${DYAD_API_KEY}
```

```bash
# .env
DYAD_API_KEY=your_secret_key_here
```

### Réseau Docker

Le serveur MCP et Dyad Web doivent être sur le même réseau Docker :

```yaml
networks:
  dyad-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### CORS

Si le MCP server est externe, configurez CORS dans Dyad :

```yaml
dyad:
  environment:
    - CORS_ORIGIN=*  # Pour dev seulement
    # Production:
    - CORS_ORIGIN=https://your-domain.com
```

## 🧪 Test de la Configuration

### 1. Vérifier que Dyad Web répond

```bash
curl http://localhost:3007/api/health
# Devrait retourner: {"status":"ok"}
```

### 2. Tester l'API Apps

```bash
curl http://localhost:3007/api/apps
# Devrait retourner: {"apps":[...]}
```

### 3. Tester le Serveur MCP

```bash
# Définir la variable d'environnement
export DYAD_API_URL=http://localhost:3007

# Lancer le serveur MCP
node mcp-server/dist/index.js

# Dans un autre terminal, tester avec MCP Inspector
npx @modelcontextprotocol/inspector mcp-server/dist/index.js
```

## 📊 Monitoring

### Logs Docker

```bash
# Logs du serveur MCP
docker-compose logs -f mcp-server

# Logs du serveur Web
docker-compose logs -f dyad

# Logs PostgreSQL
docker-compose logs -f postgres
```

### Health Checks

Ajoutez un health check au serveur MCP :

```yaml
mcp-server:
  healthcheck:
    test: ["CMD", "node", "-e", "process.exit(0)"]
    interval: 30s
    timeout: 10s
    retries: 3
```

## 🐛 Troubleshooting

### Erreur : "Failed to fetch from Dyad API"

**Cause** : Le serveur MCP ne peut pas atteindre l'API Dyad.

**Solutions** :
1. Vérifier que `DYAD_API_URL` est correct
2. Vérifier que Dyad Web est démarré : `docker ps`
3. Tester l'API : `curl http://dyad:3007/api/health`
4. Vérifier le réseau : `docker network inspect dyad_dyad-network`

### Erreur : "CORS policy"

**Cause** : CORS non configuré pour accepter les requêtes du MCP server.

**Solution** :
```yaml
dyad:
  environment:
    - CORS_ORIGIN=*  # ou l'origine spécifique
```

### Erreur : "Connection refused"

**Cause** : Port non exposé ou service non démarré.

**Solutions** :
1. Vérifier les ports : `docker-compose ps`
2. Exposer le port Dyad : `ports: - "3007:3007"`
3. Vérifier le firewall

### Erreur : "Database not found"

**Cause** : Le serveur MCP essaie d'utiliser SQLite au lieu de l'API.

**Solution** :
```bash
# S'assurer que DYAD_API_URL est défini
echo $DYAD_API_URL
# Devrait afficher : http://dyad:3007 ou http://localhost:3007
```

## 📦 Déploiement Production

### 1. Utiliser des Variables d'Environnement Sécurisées

```bash
# .env (ne pas commiter!)
DYAD_API_URL=https://api.dyad.example.com
DYAD_API_KEY=prod_secret_key_here
DATABASE_URL=postgresql://user:pass@postgres.example.com:5432/dyad
```

### 2. Configurer SSL/TLS

```yaml
mcp-server:
  environment:
    - DYAD_API_URL=https://api.dyad.example.com
    - NODE_TLS_REJECT_UNAUTHORIZED=1  # Valider les certificats
```

### 3. Limiter les Ressources

```yaml
mcp-server:
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 512M
      reservations:
        cpus: '0.25'
        memory: 256M
```

### 4. Backup et Monitoring

```yaml
volumes:
  postgres-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /path/to/backup/postgres-data
```

## 🔗 Ressources

- [Documentation Docker Dyad](../docker-compose.yml)
- [API Dyad Server](../server/src/routes/)
- [MCP Server README](./README.md)
- [Guide d'Intégration](./INTEGRATION-GUIDE.md)

---

**Mode recommandé** : Docker Compose avec MCP server dans un container séparé communiquant via l'API REST.
