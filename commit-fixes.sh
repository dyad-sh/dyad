#!/bin/bash
# Script de commit automatique pour toutes les corrections Dyad

echo "🚀 Préparation du commit des corrections Dyad..."

# Ajouter tous les fichiers modifiés
echo "📦 Ajout des fichiers modifiés..."

git add server/src/routes/chatStream.ts
git add server/docker-entrypoint.sh
git add server/migrations/001_add_api_key_column.sql
git add server/migrations/002_configure_openrouter.sql
git add Dockerfile
git add src/components/GitHubIntegration.tsx
git add src/ipc/web_backend.ts
git add src/components/preview_panel/Problems.tsx

echo "✅ Fichiers ajoutés"

# Afficher le statut
echo ""
echo "📊 Statut Git:"
git status

echo ""
echo "📝 Création du commit..."

# Commit avec message détaillé
git commit -m "fix: Complete Dyad fixes - chat persistence, OpenRouter, GitHub UI, Docker deployment

- Add message persistence to chat streaming (save user/assistant messages to DB)
- Integrate OpenRouter with DeepSeek model as alternative to Google Gemini
- Add GitHub connection UI with Personal Access Token input
- Fix Docker deployment (add postgresql-client, correct server entry point)
- Add database migrations for api_key column and OpenRouter configuration
- Fix Problems component crash (null check for problemReport.problems)

Fixes:
- Chat messages now persist in database
- OpenRouter configured with DeepSeek (tngtech/deepseek-r1t2-chimera:free)
- GitHub integration UI with token input
- Docker deployment succeeds (psql client + correct path)
- Database migrations run automatically on startup
- Problems panel no longer crashes on undefined data

Resolves chat message persistence, API quota issues, GitHub integration, and deployment failures."

echo "✅ Commit créé"

echo ""
echo "🔍 Détails du commit:"
git log -1 --stat

echo ""
echo "🎯 Prochaines étapes:"
echo "1. Vérifier le commit: git log -1"
echo "2. Pousser vers le repo: git push origin main"
echo "3. Attendre le déploiement sur Coolify"
echo "4. Activer OpenRouter: curl -X PUT https://dyad1.ty-dev.site/api/settings -H 'Content-Type: application/json' -d '{\"defaultModel\":\"tngtech/deepseek-r1t2-chimera:free\"}'"
