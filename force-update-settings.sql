-- Force update Google API key and default model
-- Update Google API key
UPDATE language_model_providers 
SET api_key = 'AIzaSyC6voWSY1XI1fPi_FchncniRiftjznOY-o', 
    updated_at = NOW()
WHERE id = 'google';

-- If google provider doesn't exist, insert it
INSERT INTO language_model_providers (id, name, api_base_url, api_key, created_at, updated_at)
VALUES ('google', 'Google Gemini', 'https://generativelanguage.googleapis.com', 'AIzaSyC6voWSY1XI1fPi_FchncniRiftjznOY-o', NOW(), NOW())
ON CONFLICT (id) DO UPDATE 
SET api_key = EXCLUDED.api_key, updated_at = NOW();

-- Update default model to gemini-flash-latest
INSERT INTO system_settings (key, value, description, created_at, updated_at)
VALUES ('defaultModel', 'gemini-flash-latest', 'Default AI model for chat', NOW(), NOW())
ON CONFLICT (key) DO UPDATE 
SET value = EXCLUDED.value, updated_at = NOW();

-- Verify changes
SELECT 'Google API Key:' as info, api_key FROM language_model_providers WHERE id = 'google';
SELECT 'Default Model:' as info, value FROM system_settings WHERE key = 'defaultModel';
