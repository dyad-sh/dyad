-- Configuration de MegaLLM comme fournisseur personnalisé
-- Ce script ajoute MegaLLM et configure openai-gpt-oss-20b comme modèle par défaut

-- 1. Supprimer les anciennes entrées si elles existent
DELETE FROM language_models WHERE custom_provider_id = 'megallm';
DELETE FROM language_model_providers WHERE id = 'megallm';

-- 2. Ajouter le fournisseur MegaLLM
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

-- 3. Ajouter le modèle openai-gpt-oss-20b
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

-- 4. Mettre à jour ou créer le paramètre defaultModel
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

-- 5. Vérifier la configuration
SELECT 'MegaLLM Provider:' as info, * FROM language_model_providers WHERE id = 'megallm';
SELECT 'MegaLLM Models:' as info, * FROM language_models WHERE custom_provider_id = 'megallm';
SELECT 'Default Model Setting:' as info, * FROM system_settings WHERE key = 'defaultModel';
