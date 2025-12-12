#!/bin/bash
# Script pour mettre à jour le modèle par défaut vers Gemini Flash

echo "🔄 Mise à jour du modèle par défaut vers Gemini Flash..."

# Mettre à jour via l'API
curl -X PUT https://dyad1.ty-dev.site/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "defaultModel": "gemini-2.0-flash-exp"
  }'

echo ""
echo ""
echo "✅ Vérification de la mise à jour..."

# Vérifier le changement
curl https://dyad1.ty-dev.site/api/settings | grep -o '"defaultModel":"[^"]*"'

echo ""
echo "✅ Terminé !"
