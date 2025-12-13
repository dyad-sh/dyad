# Script PowerShell pour configurer MegaLLM via Docker
# À exécuter sur le serveur de production

Write-Host "🚀 Configuration de MegaLLM..." -ForegroundColor Green

# Récupérer l'ID du conteneur PostgreSQL
$postgresContainer = docker ps -q -f "name=postgres"

if (-not $postgresContainer) {
    Write-Host "❌ Conteneur PostgreSQL non trouvé!" -ForegroundColor Red
    exit 1
}

Write-Host "📦 Conteneur PostgreSQL trouvé: $postgresContainer" -ForegroundColor Cyan

# Créer le script SQL temporaire
$sqlScript = @"
-- Configuration de MegaLLM
DELETE FROM language_models WHERE custom_provider_id = 'megallm';
DELETE FROM language_model_providers WHERE id = 'megallm';

INSERT INTO language_model_providers (id, name, api_base_url, env_var_name, "apiKey", created_at, updated_at)
VALUES (
  'megallm',
  'MegaLLM',
  'https://ai.megallm.io/v1',
  'MEGALLM_API_KEY',
  'sk-mega-2b5b517612547dff2676985fcfb2b3936d10160688350730a6f451745d210595',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  api_base_url = EXCLUDED.api_base_url,
  env_var_name = EXCLUDED.env_var_name,
  "apiKey" = EXCLUDED."apiKey",
  updated_at = NOW();

INSERT INTO language_models (display_name, api_name, custom_provider_id, description, max_output_tokens, context_window, created_at, updated_at)
VALUES (
  'OpenAI GPT OSS 20B',
  'openai-gpt-oss-20b',
  'megallm',
  'Open source GPT model with 20B parameters from MegaLLM',
  4096,
  8192,
  NOW(),
  NOW()
);

INSERT INTO system_settings (key, value, description, created_at, updated_at)
VALUES (
  'defaultModel',
  'openai-gpt-oss-20b',
  'Default AI model for new chats',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

SELECT 'Configuration appliquée avec succès!' as status;
"@

# Sauvegarder le script SQL
$sqlScript | Out-File -FilePath "configure-megallm-temp.sql" -Encoding UTF8

Write-Host "⚙️  Exécution de la configuration SQL..." -ForegroundColor Yellow

# Copier le fichier dans le conteneur
docker cp configure-megallm-temp.sql ${postgresContainer}:/tmp/configure-megallm.sql

# Exécuter le script SQL
docker exec -i $postgresContainer psql -U postgres -d dyad -f /tmp/configure-megallm.sql

Write-Host "♻️  Redémarrage du serveur Dyad..." -ForegroundColor Yellow
docker-compose restart server

Write-Host "✅ Configuration MegaLLM terminée!" -ForegroundColor Green
Write-Host "🎉 Le modèle openai-gpt-oss-20b est maintenant le modèle par défaut" -ForegroundColor Cyan

# Nettoyer
Remove-Item configure-megallm-temp.sql -ErrorAction SilentlyContinue
