# Diagnostic de connexion MCP HTTP

## Résultat du test

### ❌ Connexion au serveur distant ÉCHOUÉE

**Serveur testé:** `dyad1.ty-dev.site:3008`

**Résultat:**
```
curl: (28) Connection timed out after 5010 milliseconds
```

**Test de connectivité réseau:**
- IP résolue: 104.21.63.61 / 172.67.143.223
- Port 3008: ❌ **NON ACCESSIBLE**

## Diagnostic

### Causes possibles

1. **Le serveur HTTP MCP n'est pas déployé sur le serveur distant**
   - Le conteneur `dyad-mcp` n'est pas en cours d'exécution
   - Le serveur HTTP n'est pas démarré dans le conteneur

2. **Le port 3008 n'est pas exposé**
   - Le firewall bloque le port 3008
   - Docker ne mappe pas correctement le port
   - Le reverse proxy (nginx/cloudflare) ne redirige pas le port

3. **Le serveur HTTP n'écoute pas sur 0.0.0.0**
   - Le serveur écoute uniquement sur localhost
   - Configuration de HOST incorrecte

## Solutions

### Solution 1: Déployer le serveur MCP HTTP

#### Option A: Script automatisé (Recommandé)
```bash
# Depuis votre machine locale
cd c:\Users\amine\dyad-1
bash deploy-mcp-http.sh
```

#### Option B: Déploiement manuel
```bash
# 1. Copier les fichiers
scp -r dyad-1 root@dyad1.ty-dev.site:/root/

# 2. Se connecter au serveur
ssh root@dyad1.ty-dev.site

# 3. Installer les dépendances
cd /root/dyad-1/mcp-server
npm install
npm run build

# 4. Redémarrer les conteneurs
cd /root/dyad-1
docker compose down
docker compose up -d --build

# 5. Vérifier
docker ps | grep dyad-mcp
docker logs dyad-mcp
```

### Solution 2: Ouvrir le port 3008

#### Vérifier le firewall
```bash
ssh root@dyad1.ty-dev.site

# UFW (Ubuntu/Debian)
sudo ufw allow 3008/tcp
sudo ufw status

# Firewalld (CentOS/RHEL)
sudo firewall-cmd --add-port=3008/tcp --permanent
sudo firewall-cmd --reload

# iptables
sudo iptables -A INPUT -p tcp --dport 3008 -j ACCEPT
sudo iptables-save
```

#### Vérifier Docker
```bash
# Vérifier que le port est mappé
docker ps | grep dyad-mcp

# Devrait afficher: 0.0.0.0:3008->3008/tcp
```

### Solution 3: Vérifier la configuration du serveur

```bash
ssh root@dyad1.ty-dev.site

# Vérifier les conteneurs
docker compose ps

# Vérifier les logs
docker logs dyad-mcp

# Vérifier si le port écoute
netstat -tlnp | grep 3008

# Tester en local sur le serveur
curl http://localhost:3008/health
```

## Commandes de vérification

### Sur le serveur distant (via SSH)

```bash
# 1. Vérifier que le conteneur tourne
docker ps | grep dyad-mcp

# 2. Vérifier les logs
docker logs dyad-mcp --tail 50

# 3. Tester en local
docker exec -it dyad-mcp curl http://localhost:3008/health

# 4. Vérifier le port
ss -tlnp | grep 3008

# 5. Vérifier la configuration Docker
docker inspect dyad-mcp | grep -A 10 "Ports"
```

### Depuis votre machine locale

```bash
# Test de connectivité basique
ping dyad1.ty-dev.site

# Test du port (si telnet disponible)
telnet dyad1.ty-dev.site 3008

# Test avec curl
curl -v --connect-timeout 5 http://dyad1.ty-dev.site:3008/health

# Test avec PowerShell
Test-NetConnection -ComputerName dyad1.ty-dev.site -Port 3008
```

## Prochaines étapes

1. **Déployer le serveur** en utilisant `deploy-mcp-http.sh`
2. **Vérifier le firewall** et ouvrir le port 3008 si nécessaire
3. **Tester la connexion** avec `curl http://dyad1.ty-dev.site:3008/health`
4. **Vérifier les logs** si des erreurs persistent

## Alternative: Utiliser un reverse proxy

Si vous ne pouvez pas ouvrir le port 3008, vous pouvez utiliser nginx comme reverse proxy:

```nginx
# /etc/nginx/sites-available/dyad-mcp
server {
    listen 80;
    server_name mcp.dyad1.ty-dev.site;

    location / {
        proxy_pass http://localhost:3008;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Puis accéder via: `http://mcp.dyad1.ty-dev.site/health`

## Statut actuel

- ✅ Serveur HTTP MCP fonctionne **localement** (port 3008)
- ✅ Configuration Docker mise à jour
- ✅ Scripts de test créés
- ❌ **Serveur HTTP MCP NON déployé sur dyad1.ty-dev.site**
- ❌ **Port 3008 NON accessible depuis l'extérieur**

**Action requise:** Déployer le serveur sur dyad1.ty-dev.site
