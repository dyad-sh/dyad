#!/bin/bash
# Commandes de déploiement manuel pour dyad1.ty-dev.site

echo "=== Déploiement MCP HTTP sur dyad1.ty-dev.site ==="
echo ""

# 1. Aller dans le répertoire
cd /root/dyad-1

# 2. Mettre à jour le code (si git est configuré)
# git pull

# 3. Installer les dépendances MCP
cd mcp-server
npm install
npm run build

# 4. Retour au répertoire principal
cd ..

# 5. Reconstruire et redémarrer les conteneurs
docker compose down
docker compose up -d --build

# 6. Attendre que les conteneurs démarrent
echo "Attente du démarrage des conteneurs..."
sleep 10

# 7. Vérifier les conteneurs
echo ""
echo "=== Status des conteneurs ==="
docker compose ps

# 8. Vérifier les logs MCP
echo ""
echo "=== Logs du conteneur MCP (dernières 20 lignes) ==="
docker logs dyad-mcp --tail 20

# 9. Tester le endpoint health
echo ""
echo "=== Test du endpoint health ==="
curl -f http://localhost:3008/health && echo "" || echo "ERREUR: Le serveur HTTP n'est pas accessible"

echo ""
echo "=== Déploiement terminé ==="
echo "Testez depuis l'extérieur avec:"
echo "  curl http://dyad1.ty-dev.site:3008/health"
