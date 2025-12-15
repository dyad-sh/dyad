#!/bin/bash

# Script de configuration serveur pour Docker Compose Architecture
# À exécuter sur le serveur Linux après le déploiement

set -e  # Arrêter en cas d'erreur

echo "=========================================="
echo "Configuration Serveur - Docker Compose"
echo "=========================================="
echo ""

# 1. Créer le réseau Docker
echo "📡 Création du réseau Docker..."
if docker network ls | grep -q dyad-network; then
    echo "✅ Réseau dyad-network existe déjà"
else
    docker network create dyad-network
    echo "✅ Réseau dyad-network créé"
fi
echo ""

# 2. Créer le volume partagé
echo "💾 Création du volume partagé..."
if docker volume ls | grep -q dyad-apps; then
    echo "✅ Volume dyad-apps existe déjà"
else
    docker volume create dyad-apps
    echo "✅ Volume dyad-apps créé"
fi
echo ""

# 3. Créer le répertoire /apps dans le volume
echo "📁 Création du répertoire /apps..."
docker run --rm -v dyad-apps:/apps alpine mkdir -p /apps
docker run --rm -v dyad-apps:/apps alpine chmod 777 /apps
echo "✅ Répertoire /apps créé avec permissions"
echo ""

# 4. Ouvrir les ports dans le firewall
echo "🔓 Configuration du firewall..."
if command -v ufw &> /dev/null; then
    echo "Utilisation de ufw..."
    sudo ufw allow 32000:33000/tcp
    echo "✅ Ports 32000-33000 ouverts"
else
    echo "⚠️  ufw non trouvé, vérifiez votre firewall manuellement"
    echo "   Ouvrez les ports 32000-33000/tcp"
fi
echo ""

# 5. Arrêter les containers existants
echo "🛑 Arrêt des containers existants..."
docker-compose down || true
echo "✅ Containers arrêtés"
echo ""

# 6. Rebuild les images
echo "🔨 Build des images Docker..."
docker-compose build --no-cache
echo "✅ Images buildées"
echo ""

# 7. Démarrer les services
echo "🚀 Démarrage des services..."
docker-compose up -d
echo "✅ Services démarrés"
echo ""

# 8. Attendre que le serveur soit prêt
echo "⏳ Attente du démarrage du serveur..."
sleep 5
echo ""

# 9. Vérifier le statut
echo "📊 Vérification du statut..."
docker ps --filter "name=dyad"
echo ""

# 10. Afficher les logs
echo "📋 Logs du serveur (dernières 20 lignes)..."
docker logs dyad-server --tail 20
echo ""

echo "=========================================="
echo "✅ Configuration Terminée !"
echo "=========================================="
echo ""
echo "🎯 Prochaines étapes :"
echo ""
echo "1. Vérifier que le serveur fonctionne :"
echo "   curl http://localhost:3000/api/health"
echo ""
echo "2. Créer une nouvelle app sur :"
echo "   https://dyad1.ty-dev.site"
echo ""
echo "3. Envoyer un message à l'IA :"
echo "   'crée une app Next.js simple'"
echo ""
echo "4. L'app sera accessible sur :"
echo "   http://dyad1.ty-dev.site:32XXX"
echo "   (où XXX = ID de l'app)"
echo ""
echo "5. Voir les logs d'une app :"
echo "   docker logs dyad-app-68"
echo ""
echo "6. Arrêter une app :"
echo "   docker stop dyad-app-68"
echo ""
echo "=========================================="
