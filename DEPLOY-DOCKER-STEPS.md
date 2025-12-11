# Guide de Déploiement Docker - Serveur MCP HTTP

## Étape 1: Copier les fichiers sur le serveur distant

**Depuis votre machine Windows (PowerShell) :**

```powershell
# Copier tout le projet dyad-1 vers le serveur
scp -r C:\Users\amine\dyad-1 root@dyad1.ty-dev.site:/root/
```

**Vérification :**
```bash
# Sur le serveur distant
ls -la /root/dyad-1/
```

---

## Étape 2: Vérifier le Dockerfile MCP

**Sur le serveur distant :**

```bash
cd /root/dyad-1/mcp-server
cat Dockerfile
```

**Le Dockerfile doit contenir :**
- `EXPOSE 3008`
- `CMD ["node", "dist/http-proxy.js"]`

Si ce n'est pas le cas, le fichier a été mis à jour localement et doit être recopié.

---

## Étape 3: Installer les dépendances et compiler

**Sur le serveur distant :**

```bash
cd /root/dyad-1/mcp-server

# Installer les dépendances
npm install

# Compiler TypeScript
npm run build

# Vérifier que http-proxy.js existe
ls -la dist/http-proxy.js
```

---

## Étape 4: Construire et démarrer avec Docker Compose

**Sur le serveur distant :**

```bash
cd /root/dyad-1

# Arrêter les anciens conteneurs
docker compose down

# Construire et démarrer le conteneur MCP
docker compose up -d --build mcp-server

# Attendre quelques secondes
sleep 5
```

---

## Étape 5: Vérifier le déploiement

**Sur le serveur distant :**

```bash
# Vérifier que le conteneur tourne
docker compose ps

# Devrait afficher :
# NAME        IMAGE              STATUS    PORTS
# dyad-mcp    dyad-1-mcp-server  Up        0.0.0.0:3008->3008/tcp

# Voir les logs en temps réel
docker logs dyad-mcp --tail 30 -f

# Devrait afficher :
# ╔════════════════════════════════════════════════════════════╗
# ║  Dyad MCP HTTP Proxy                                       ║
# ╚════════════════════════════════════════════════════════════╝
#   Server:     http://0.0.0.0:3008
#   Health:     http://0.0.0.0:3008/health
#   ...
```

**Appuyez sur Ctrl+C pour quitter les logs**

---

## Étape 6: Tester localement sur le serveur

**Sur le serveur distant :**

```bash
# Test du endpoint health
curl http://localhost:3008/health

# Devrait retourner :
# {"status":"healthy","server":"dyad-mcp-http-proxy",...}

# Test du endpoint apps
curl http://localhost:3008/api/apps

# Vérifier que le port écoute
ss -tlnp | grep 3008

# Devrait afficher :
# LISTEN  0  511  0.0.0.0:3008  0.0.0.0:*
```

---

## Étape 7: Ouvrir le port dans le firewall

**Sur le serveur distant :**

```bash
# Pour UFW (Ubuntu/Debian)
ufw allow 3008/tcp
ufw status

# Pour firewalld (CentOS/RHEL)
firewall-cmd --add-port=3008/tcp --permanent
firewall-cmd --reload

# Pour iptables
iptables -A INPUT -p tcp --dport 3008 -j ACCEPT
iptables-save
```

---

## Étape 8: Tester depuis l'extérieur

**Depuis votre machine Windows (PowerShell) :**

```powershell
# Test du endpoint health
curl http://dyad1.ty-dev.site:3008/health

# Test du endpoint apps
curl http://dyad1.ty-dev.site:3008/api/apps

# Test avec le script de test
cd C:\Users\amine\dyad-1\mcp-server
$env:MCP_HTTP_URL="http://dyad1.ty-dev.site:3008"
npm run test:http
```

---

## Dépannage

### Le conteneur ne démarre pas

```bash
# Voir les logs d'erreur
docker logs dyad-mcp

# Vérifier la configuration docker-compose
docker compose config | grep -A 20 mcp-server

# Reconstruire complètement
docker compose down
docker compose build --no-cache mcp-server
docker compose up -d mcp-server
```

### Le port 3008 n'est pas accessible

```bash
# Vérifier que le conteneur écoute sur le bon port
docker exec dyad-mcp netstat -tlnp

# Vérifier le mapping de port
docker port dyad-mcp

# Vérifier le firewall
ufw status | grep 3008
```

### Erreur "http-proxy.js not found"

```bash
# Recompiler sur le serveur
cd /root/dyad-1/mcp-server
npm run build
ls -la dist/

# Ou reconstruire le conteneur
cd /root/dyad-1
docker compose build --no-cache mcp-server
docker compose up -d mcp-server
```

---

## Commandes utiles

```bash
# Redémarrer le conteneur MCP
docker compose restart mcp-server

# Voir les logs en continu
docker logs dyad-mcp -f

# Entrer dans le conteneur
docker exec -it dyad-mcp sh

# Arrêter tous les services
docker compose down

# Démarrer tous les services
docker compose up -d

# Voir l'utilisation des ressources
docker stats dyad-mcp
```

---

## Résumé des endpoints disponibles

Une fois déployé, les endpoints suivants seront accessibles :

- **Health Check:** `http://dyad1.ty-dev.site:3008/health`
- **List Apps:** `http://dyad1.ty-dev.site:3008/api/apps`
- **Get App:** `http://dyad1.ty-dev.site:3008/api/apps/:id`
- **List Chats:** `http://dyad1.ty-dev.site:3008/api/chats`
- **Get Chat:** `http://dyad1.ty-dev.site:3008/api/chats/:id`

---

## Configuration finale

Le serveur MCP HTTP sera accessible :
- **Localement (sur le serveur):** `http://localhost:3008`
- **À distance:** `http://dyad1.ty-dev.site:3008`
- **Via Docker:** Le conteneur `dyad-mcp` mappe le port 3008

**Statut attendu :**
✅ Conteneur `dyad-mcp` en cours d'exécution  
✅ Port 3008 exposé et accessible  
✅ Serveur HTTP proxy fonctionnel  
✅ Endpoints API répondent correctement
