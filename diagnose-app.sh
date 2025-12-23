#!/bin/bash

# Script de diagnostic pour l'app Dyad
# Usage: ./diagnose-app.sh 72

APP_ID=${1:-72}
BASE_URL="https://dyad1.ty-dev.site"

echo "=========================================="
echo "Diagnostic de l'App $APP_ID"
echo "=========================================="
echo ""

echo "1. Test de l'API /api/apps/$APP_ID"
echo "-----------------------------------"
curl -s "$BASE_URL/api/apps/$APP_ID" | jq '.' || echo "❌ Erreur API"
echo ""

echo "2. Test des fichiers de l'app"
echo "-----------------------------------"
curl -s "$BASE_URL/api/apps/$APP_ID/files" | jq '.data | length' || echo "❌ Erreur fichiers"
echo ""

echo "3. Test du lancement de l'app"
echo "-----------------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/apps/$APP_ID/run")
echo "$RESPONSE" | jq '.'
echo ""

if echo "$RESPONSE" | grep -q "previewUrl"; then
    PREVIEW_URL=$(echo "$RESPONSE" | jq -r '.data.previewUrl')
    echo "✅ App lancée avec succès!"
    echo "Preview URL: $PREVIEW_URL"
    echo ""
    
    echo "4. Test de l'accès au preview"
    echo "-----------------------------------"
    # Check headers including SSL verification status
    curl -I -v "$PREVIEW_URL" 2>&1 | head -n 20
    
    echo ""
    echo "⚠️ NOTE SSL: Si vous voyez 'SSL certificate problem' ou 'ERR_WRONG_VERSION_NUMBER',"
    echo "c'est que le certificat wildcard n'est pas valide. Vérifiez le challenge DNS."
else
    echo "❌ Échec du lancement de l'app"
    ERROR=$(echo "$RESPONSE" | jq -r '.error.message')
    echo "Erreur: $ERROR"
fi

echo ""
echo "=========================================="
echo "Fin du diagnostic"
echo "=========================================="
