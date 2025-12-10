#!/bin/bash
# =============================================================================
# Déploiement du serveur MCP HTTP sur dyad1.ty-dev.site
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REMOTE_HOST="dyad1.ty-dev.site"
REMOTE_USER="root"
REMOTE_PATH="/root/dyad-1"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  Déploiement MCP HTTP sur dyad1.ty-dev.site"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Étape 1: Vérifier la connexion SSH
echo -e "${YELLOW}[1/6]${NC} Vérification de la connexion SSH..."
if ssh -o ConnectTimeout=5 ${REMOTE_USER}@${REMOTE_HOST} "echo 'SSH OK'" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Connexion SSH établie"
else
    echo -e "${RED}✗${NC} Impossible de se connecter via SSH"
    echo "Vérifiez vos identifiants SSH et réessayez"
    exit 1
fi

# Étape 2: Copier les fichiers
echo ""
echo -e "${YELLOW}[2/6]${NC} Copie des fichiers vers le serveur distant..."
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude 'data' \
    ./ ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/

echo -e "${GREEN}✓${NC} Fichiers copiés"

# Étape 3: Installer les dépendances
echo ""
echo -e "${YELLOW}[3/6]${NC} Installation des dépendances sur le serveur distant..."
ssh ${REMOTE_USER}@${REMOTE_HOST} << 'ENDSSH'
cd /root/dyad-1/mcp-server
npm install
npm run build
ENDSSH

echo -e "${GREEN}✓${NC} Dépendances installées et build effectué"

# Étape 4: Arrêter les anciens conteneurs
echo ""
echo -e "${YELLOW}[4/6]${NC} Arrêt des anciens conteneurs..."
ssh ${REMOTE_USER}@${REMOTE_HOST} << 'ENDSSH'
cd /root/dyad-1
docker compose down
ENDSSH

echo -e "${GREEN}✓${NC} Anciens conteneurs arrêtés"

# Étape 5: Démarrer les nouveaux conteneurs
echo ""
echo -e "${YELLOW}[5/6]${NC} Démarrage des nouveaux conteneurs..."
ssh ${REMOTE_USER}@${REMOTE_HOST} << 'ENDSSH'
cd /root/dyad-1
docker compose up -d --build
ENDSSH

echo -e "${GREEN}✓${NC} Conteneurs démarrés"

# Étape 6: Vérifier le déploiement
echo ""
echo -e "${YELLOW}[6/6]${NC} Vérification du déploiement..."
sleep 5

# Vérifier les conteneurs
echo "Vérification des conteneurs..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "docker compose -f ${REMOTE_PATH}/docker-compose.yml ps"

# Vérifier le health endpoint
echo ""
echo "Test du endpoint health..."
if curl -f -m 5 http://${REMOTE_HOST}:3008/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Serveur HTTP MCP accessible"
else
    echo -e "${YELLOW}⚠${NC} Le serveur HTTP n'est pas encore accessible"
    echo "Cela peut prendre quelques secondes de plus..."
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ DÉPLOIEMENT TERMINÉ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo "Endpoints disponibles:"
echo "  - Health:      http://${REMOTE_HOST}:3008/health"
echo "  - Apps API:    http://${REMOTE_HOST}:3008/api/apps"
echo "  - Chats API:   http://${REMOTE_HOST}:3008/api/chats"
echo ""
echo "Pour tester:"
echo "  curl http://${REMOTE_HOST}:3008/health"
echo "  curl http://${REMOTE_HOST}:3008/api/apps"
echo ""
echo "Pour voir les logs:"
echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'docker logs dyad-mcp'"
echo ""
