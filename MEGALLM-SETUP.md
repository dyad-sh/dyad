# Instructions pour Configurer MegaLLM

## Option 1: Via l'Interface Web (Recommandé)

Une fois le serveur redéployé avec les nouvelles fonctionnalités:

1. Allez sur https://dyad1.ty-dev.site/
2. Ouvrez les **Settings** (Paramètres)
3. Naviguez vers **Model Providers**
4. Cliquez sur **Add Custom Provider**
5. Remplissez les informations:
   - **ID**: `megallm`
   - **Name**: `MegaLLM`
   - **API Base URL**: `https://ai.megallm.io/v1`
   - **Environment Variable**: `MEGALLM_API_KEY`
   - **API Key**: `sk-mega-2b5b517612547dff2676985fcfb2b3936d10160688350730a6f451745d210595`
6. Cliquez sur **Save**
7. Ajoutez le modèle:
   - **Display Name**: `OpenAI GPT OSS 20B`
   - **API Name**: `openai-gpt-oss-20b`
   - **Max Output Tokens**: `4096`
   - **Context Window**: `8192`
8. Définissez comme modèle par défaut dans Settings > General

## Option 2: Via SQL Direct (Si vous avez accès SSH au serveur)

Sur le serveur de production, exécutez:

```bash
# Se connecter au serveur
ssh amine@ty-dev.site

# Naviguer vers le répertoire du projet
cd /var/www/dyad

# Exécuter le script PowerShell
pwsh configure-megallm.ps1
```

## Option 3: Via Docker Exec (Depuis le serveur)

```bash
# Copier le fichier SQL dans le conteneur PostgreSQL
docker cp configure-megallm.sql $(docker ps -q -f name=postgres):/tmp/configure-megallm.sql

# Exécuter le script SQL
docker exec -i $(docker ps -q -f name=postgres) psql -U postgres -d dyad -f /tmp/configure-megallm.sql

# Redémarrer le serveur
docker-compose restart server
```

## Option 4: Via API (Une fois le serveur déployé)

```bash
# Ajouter le fournisseur
curl -X POST https://dyad1.ty-dev.site/api/providers \
  -H "Content-Type: application/json" \
  -d '{
    "id": "megallm",
    "name": "MegaLLM",
    "apiBaseUrl": "https://ai.megallm.io/v1",
    "envVarName": "MEGALLM_API_KEY",
    "apiKey": "sk-mega-2b5b517612547dff2676985fcfb2b3936d10160688350730a6f451745d210595"
  }'

# Ajouter le modèle
curl -X POST https://dyad1.ty-dev.site/api/providers/megallm/models \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "OpenAI GPT OSS 20B",
    "apiName": "openai-gpt-oss-20b",
    "description": "Open source GPT model with 20B parameters",
    "maxOutputTokens": 4096,
    "contextWindow": 8192
  }'

# Définir comme modèle par défaut
curl -X PUT https://dyad1.ty-dev.site/api/settings \
  -H "Content-Type: application/json" \
  -d '{
    "defaultModel": "openai-gpt-oss-20b"
  }'
```

## Vérification

Pour vérifier que la configuration a été appliquée:

```bash
# Vérifier les fournisseurs
curl https://dyad1.ty-dev.site/api/providers

# Vérifier les modèles de MegaLLM
curl https://dyad1.ty-dev.site/api/providers/megallm/models

# Vérifier les paramètres
curl https://dyad1.ty-dev.site/api/settings
```

## Fichiers Créés

- `configure-megallm.sql` - Script SQL pour configuration directe
- `configure-megallm.ps1` - Script PowerShell pour Docker
- `apply-megallm-config.sh` - Script Bash pour déploiement SSH

## Notes

- Le serveur doit être redéployé avec les nouvelles fonctionnalités avant d'utiliser l'interface web ou l'API
- La clé API est stockée de manière sécurisée dans la base de données
- Le modèle `openai-gpt-oss-20b` sera utilisé par défaut pour tous les nouveaux chats
