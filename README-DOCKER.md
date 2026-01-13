# 🐳 Dyad - Guide Docker Compose

Ce guide explique comment utiliser Docker Compose pour exécuter Dyad en mode développement ou production.

## 📋 Prérequis

- **Docker Desktop** installé et en cours d'exécution
- **Docker Compose** (inclus avec Docker Desktop)
- **PowerShell** (Windows) ou **Bash** (Linux/Mac)

## 🚀 Démarrage rapide

### Mode Développement

```powershell
# Utiliser le script PowerShell
.\start-dev.ps1

# OU manuellement
docker-compose -f docker-compose.dev.yml up --build -d
```

**Services disponibles :**
- 🌐 Frontend : http://localhost:5173
- 🔌 Backend API : http://localhost:3007
- 📡 MCP HTTP Server : http://localhost:3008

### Mode Production

```powershell
# Utiliser le script PowerShell
.\start-prod.ps1

# OU manuellement
docker-compose -f docker-compose.prod.yml up --build -d
```

**Services disponibles :**
- 🌐 Application complète : http://localhost:3007
- 📡 MCP HTTP Server : http://localhost:3008

### Arrêter tous les services

```powershell
.\stop-all.ps1
```

## 📁 Fichiers Docker Compose

| Fichier | Description | Usage |
|---------|-------------|-------|
| `docker-compose.dev.yml` | Environnement développement | Hot reload, debugging |
| `docker-compose.prod.yml` | Environnement production | Build optimisé, performance |
| `docker-compose.yml` | Configuration Coolify | Déploiement cloud automatique |

## 🛠️ Configuration

### 1. Créer le fichier `.env`

```powershell
# Copier l'exemple
cp .env.example .env

# Éditer avec vos clés API
notepad .env
```

### 2. Variables d'environnement requises

```env
# AI Provider Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...

# Base de données (optionnel)
DATABASE_URL=postgresql://user:pass@host:5432/dyad
```

## 📊 Architecture des services

### Mode Développement

```
┌─────────────────────────────────────────────┐
│  Docker Network: dyad-network               │
│                                             │
│  ┌──────────────────┐  Port 5173           │
│  │  dyad-frontend   │  (Vite dev + HMR)    │
│  │  (React SPA)     │                       │
│  └────────┬─────────┘                       │
│           │                                  │
│           ↓ Proxy                           │
│  ┌──────────────────┐  Port 3007           │
│  │  dyad-backend    │  (Express + tsx)     │
│  │  (API Server)    │                       │
│  └────────┬─────────┘                       │
│           │                                  │
│  ┌──────────────────┐  Port 3008           │
│  │ dyad-mcp-server  │  (MCP HTTP Gateway)  │
│  │ (Tools via HTTP) │                       │
│  └──────────────────┘                       │
│                                             │
│  Volumes:                                   │
│  - dyad-data (SQLite DB)                   │
│  - dyad-projects (Apps générées)           │
└─────────────────────────────────────────────┘
```

### Mode Production

```
┌─────────────────────────────────────────────┐
│  Docker Network: dyad-network               │
│                                             │
│  ┌──────────────────┐  Port 3007           │
│  │    dyad-web      │  (Frontend + API)    │
│  │  - Frontend SPA  │  - Vite build        │
│  │  - Express API   │  - Node.js           │
│  │  - Serve static  │                       │
│  └────────┬─────────┘                       │
│           │                                  │
│  ┌──────────────────┐  Port 3008           │
│  │ dyad-mcp-server  │  (MCP HTTP Gateway)  │
│  │ (Production)     │                       │
│  └──────────────────┘                       │
│                                             │
│  Volumes:                                   │
│  - dyad-data-prod                          │
│  - dyad-projects-prod                      │
└─────────────────────────────────────────────┘
```

## 🔧 Commandes utiles

### Développement

```powershell
# Démarrer tous les services
docker-compose -f docker-compose.dev.yml up -d

# Voir les logs en temps réel
docker-compose -f docker-compose.dev.yml logs -f

# Logs d'un service spécifique
docker-compose -f docker-compose.dev.yml logs -f dyad-backend

# Redémarrer un service
docker-compose -f docker-compose.dev.yml restart dyad-backend

# Arrêter tous les services
docker-compose -f docker-compose.dev.yml down

# Arrêter et supprimer les volumes
docker-compose -f docker-compose.dev.yml down -v

# Rebuild un service
docker-compose -f docker-compose.dev.yml up -d --build dyad-backend
```

### Production

```powershell
# Build et démarrer
docker-compose -f docker-compose.prod.yml up -d --build

# Voir les logs
docker-compose -f docker-compose.prod.yml logs -f

# Redémarrer
docker-compose -f docker-compose.prod.yml restart

# Arrêter
docker-compose -f docker-compose.prod.yml down
```

### Inspection et débogage

```powershell
# Lister les conteneurs actifs
docker ps

# Accéder au shell d'un conteneur
docker exec -it dyad-backend-dev sh
docker exec -it dyad-frontend-dev sh

# Vérifier la santé des services
docker inspect dyad-backend-dev | grep -A 5 Health

# Voir l'utilisation des ressources
docker stats
```

## 🏥 Health Checks

Les services exposent des endpoints de santé :

```bash
# Backend
curl http://localhost:3007/api/health

# MCP Server
curl http://localhost:3008/health
```

Réponse attendue :
```json
{
  "status": "healthy",
  "timestamp": "2026-01-13T...",
  ...
}
```

## 📦 Volumes

### Développement
- `dyad-data` : Base de données SQLite et fichiers de données
- `dyad-projects` : Applications Dyad générées

### Production
- `dyad-data-prod` : Données de production
- `dyad-projects-prod` : Applications de production

**Sauvegarder les données :**
```powershell
# Export volume
docker run --rm -v dyad-data:/data -v ${PWD}:/backup alpine tar czf /backup/dyad-data-backup.tar.gz -C /data .

# Import volume
docker run --rm -v dyad-data:/data -v ${PWD}:/backup alpine tar xzf /backup/dyad-data-backup.tar.gz -C /data
```

## 🌐 Déploiement avec Coolify

Le fichier `docker-compose.yml` est configuré pour Coolify :

```powershell
# Push vers Git
git add .
git commit -m "Deploy Dyad"
git push origin main

# Coolify déploie automatiquement
```

**Configuration Traefik incluse :**
- ✅ Certificats SSL automatiques (Let's Encrypt)
- ✅ Sous-domaines d'apps : `app-dyad-{id}.ty-dev.site`
- ✅ WebSocket routing
- ✅ Compression GZIP
- ✅ CORS headers

## 🐛 Dépannage

### Les services ne démarrent pas

```powershell
# Vérifier Docker
docker --version
docker-compose --version

# Vérifier les logs
docker-compose -f docker-compose.dev.yml logs

# Nettoyer et redémarrer
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up --build -d
```

### Erreur de port déjà utilisé

```powershell
# Trouver le processus utilisant le port
netstat -ano | findstr :3007

# Arrêter tous les conteneurs Dyad
docker ps | grep dyad | awk '{print $1}' | xargs docker stop
```

### Hot reload ne fonctionne pas

Vérifiez que les volumes sont bien montés :
```powershell
docker inspect dyad-frontend-dev | grep -A 10 Mounts
```

### Build échoue

```powershell
# Nettoyer le cache Docker
docker builder prune -a

# Rebuild sans cache
docker-compose -f docker-compose.dev.yml build --no-cache
```

## 📚 Ressources

- [Documentation Docker](https://docs.docker.com/)
- [Documentation Docker Compose](https://docs.docker.com/compose/)
- [Dyad GitHub](https://github.com/dyad-sh/dyad)
- [Guide d'architecture](./docs/architecture.md)

## 🎯 Prochaines étapes

1. Configurer vos clés API dans `.env`
2. Démarrer en mode dev : `.\start-dev.ps1`
3. Ouvrir http://localhost:5173
4. Commencer à développer !
