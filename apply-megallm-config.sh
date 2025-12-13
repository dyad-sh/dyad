#!/bin/bash
# Script pour appliquer la configuration MegaLLM sur le serveur de production

echo "🚀 Configuration de MegaLLM sur le serveur de production..."

# Variables
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-dyad}"
DB_USER="${DATABASE_USER:-postgres}"

# Copier le script SQL sur le serveur
echo "📤 Copie du script SQL sur le serveur..."
scp configure-megallm.sql amine@ty-dev.site:/tmp/configure-megallm.sql

# Exécuter le script SQL sur le serveur
echo "⚙️  Exécution de la configuration dans la base de données..."
ssh amine@ty-dev.site << 'ENDSSH'
  # Se connecter à la base de données et exécuter le script
  docker exec -i $(docker ps -q -f name=postgres) \
    psql -U postgres -d dyad -f /tmp/configure-megallm.sql
  
  echo "✅ Configuration MegaLLM appliquée avec succès!"
  
  # Redémarrer le serveur pour prendre en compte les changements
  echo "♻️  Redémarrage du serveur..."
  cd /var/www/dyad
  docker-compose restart server
  
  echo "🎉 Configuration terminée!"
ENDSSH

echo "✨ MegaLLM est maintenant configuré comme fournisseur par défaut avec le modèle openai-gpt-oss-20b"
